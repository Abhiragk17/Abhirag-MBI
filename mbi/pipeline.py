"""Job orchestration used by the CLI: daily, backfill, recompute, day detail."""
from __future__ import annotations

import logging
import math
import time
from datetime import date, timedelta
from typing import Any

import pandas as pd

from . import adjust, ingest, paths, store, universe
from .classifier import EMA_SPANS, STATES, classify_history, load_config
from .metrics import app_config, compute_range
from .nse_client import NSEClient, NSEError
from .status import StatusStore, now_iso

log = logging.getLogger(__name__)

RETRY_LOOKBACK_DAYS = 10


def _clean(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    if isinstance(v, date):
        return v.isoformat()
    if hasattr(v, "item"):
        v = v.item()
        if isinstance(v, float) and math.isnan(v):
            return None
    return v


def records(df: pd.DataFrame) -> list[dict[str, Any]]:
    return [{k: _clean(v) for k, v in r.items()} for r in df.to_dict(orient="records")]


# --------------------------------------------------------------------------- outputs

def write_latest(hist: pd.DataFrame) -> None:
    if not len(hist):
        store.atomic_write_json(paths.latest_json(), {"generated_at": now_iso(), "date": None, "rows": {}})
        return
    dates = sorted(hist["date"].unique())
    last = dates[-1]
    prev = dates[-2] if len(dates) > 1 else None
    cur = hist[hist["date"] == last]
    prv = hist[hist["date"] == prev] if prev else hist.iloc[0:0]
    out = {
        "generated_at": now_iso(),
        "date": last.isoformat(),
        "prev_date": prev.isoformat() if prev else None,
        "universe_version": _clean(cur["universe_version"].iloc[0]),
        "rows": {r["bucket"]: r for r in records(cur)},
        "prev_rows": {r["bucket"]: r for r in records(prv)},
        "states": STATES,
    }
    store.atomic_write_json(paths.latest_json(), out)


def write_details(details: dict[date, pd.DataFrame]) -> None:
    for d, df in details.items():
        df = df.copy()
        for c in ("adj_close", "avgvol20", "rel_vol", "ema10", "ema20", "ema50", "adj_volume", "jump_ratio"):
            df[c] = pd.to_numeric(df[c], errors="coerce").round(4)
        store.atomic_write_csv(paths.day_detail_file(d), df)


def reclassify(write: bool = True) -> pd.DataFrame:
    hist = store.read_history()
    if not len(hist):
        return hist
    hist = classify_history(hist, load_config())
    if write:
        store.write_history(hist)
        write_latest(store.read_history())
    return hist


def run_compute(start: date, end: date, status: StatusStore, *, details_for_last: int | None = None) -> int:
    """Recompute VR + P for [start, end] from the archive, upsert, reclassify everything."""
    archive_syms: set[str] = set()
    dates = store.archived_dates()
    if dates:
        last = store.read_daily_prices(dates[-1])
        if last is not None:
            archive_syms = set(last["symbol"])
    splits = adjust.load_splits(archive_syms)
    n_detail = app_config()["detail_days"] if details_for_last is None else details_for_last
    in_range = [d for d in dates if start <= d <= end]
    detail_dates = set(in_range[-n_detail:]) if n_detail else set()

    status.autosave = False
    try:
        t0 = time.time()
        res = compute_range(start, end, status=status, splits=splits, detail_dates=detail_dates)
        log.info("computed %d session(s) in %.1fs", len(res.dates), time.time() - t0)
    finally:
        status.autosave = True
        status.save()
    if len(res.rows):
        store.upsert_history(res.rows)
    write_details(res.details)
    reclassify()
    return len(res.dates)


# --------------------------------------------------------------------------- jobs

def make_client(**kw: Any) -> NSEClient:
    return NSEClient(**kw)


def _merge_client_events(client: NSEClient, status: StatusStore, mark: int = 0) -> None:
    for e in client.events_since(mark):
        if e["kind"] in ("recovered", "failure", "playwright_failed"):
            status.event(f"nse_{e['kind']}", e["detail"], url=e.get("url"))


def daily(status: StatusStore, *, target: date | None = None, client: NSEClient | None = None,
          offline: bool = False) -> dict[str, Any]:
    client = client or make_client()
    today = target or ingest.latest_expected_session()
    v = universe.ensure_universe(client, status, today, offline=offline)
    log.info("universe version in use: %s", v)
    cal = ingest.load_calendar(client, status, offline=offline)

    archived = store.archived_dates()
    if archived:
        start = archived[-1] + timedelta(days=1)
    else:
        start = today - timedelta(days=7)
    # retry recent days that failed or came from a fallback source
    retry = [date.fromisoformat(k) for k, e in status.data["days"].items()
             if e.get("status") in ("failed", "fallback", "partial")
             and date.fromisoformat(k) >= today - timedelta(days=RETRY_LOOKBACK_DAYS)]
    todo = sorted(set(ingest.candidate_dates(cal, start, today)) | set(retry))
    results = []
    network_down = False
    if not offline:
        for d in todo:
            r = ingest.ingest_date(client, d, cal, status)
            results.append(r)
            log.info("%s -> %s (%s rows, source=%s)", d, r.outcome, r.rows, r.source)
            if r.network_down:
                network_down = True
                break
    _merge_client_events(client, status)
    status.set_offline(network_down or offline)
    if network_down or offline:
        for k in status.data["days"]:
            status.data["days"][k]["stale"] = True
        status.save()

    new = [r.date for r in results if r.outcome in ("ok", "recovered", "fallback", "partial")]
    archived = store.archived_dates()
    if not archived:
        return {"ingested": [], "computed": 0, "network_down": network_down}
    hist = store.read_history()
    have = set(hist["date"]) if len(hist) else set()
    missing_hist = [d for d in archived if d not in have]
    to_compute = sorted(set(new) | set(missing_hist[-RETRY_LOOKBACK_DAYS:] if have else missing_hist))
    n = 0
    if to_compute:
        n = run_compute(to_compute[0], to_compute[-1], status)
    else:
        reclassify()
    return {"ingested": [r.__dict__ for r in results], "computed": n, "network_down": network_down}


def backfill(status: StatusStore, start: date, end: date | None = None, *, client: NSEClient | None = None,
             fallback: bool = False, rebuild: bool = False, build_nanocap: bool = True) -> dict[str, Any]:
    client = client or make_client()
    end = end or ingest.latest_expected_session()
    universe.ensure_universe(client, status, end)
    cal = ingest.load_calendar(client, status)
    todo = ingest.candidate_dates(cal, start, end)
    done = set(store.archived_dates())
    counts: dict[str, int] = {}
    t0 = time.time()
    for k, d in enumerate(todo, 1):
        if d in done and not rebuild:
            counts["skipped"] = counts.get("skipped", 0) + 1
            continue
        try:
            r = ingest.ingest_date(client, d, cal, status, allow_fallback=fallback, rebuild=rebuild)
        except Exception as e:  # noqa: BLE001 - keep going, record it
            log.exception("ingest %s failed", d)
            status.set_day(d, status="failed", errors=[f"{type(e).__name__}: {e}"])
            counts["failed"] = counts.get("failed", 0) + 1
            continue
        counts[r.outcome] = counts.get(r.outcome, 0) + 1
        if k % 20 == 0:
            log.info("backfill %d/%d (%s) %.0fs elapsed", k, len(todo), d, time.time() - t0)
        if r.network_down:
            log.error("network down; stopping backfill (re-run to resume)")
            status.set_offline(True)
            break
    _merge_client_events(client, status)

    if build_nanocap:
        u = status.data.get("universe") or {}
        if u.get("nanocap_stale") or (u.get("nanocap_note") or "").startswith("provisional"):
            log.info("building nanocap ranking from the archive")
            try:
                universe.build_or_refresh(client, status, today=end, nanocap_only=True)
            except NSEError as e:
                log.error("nanocap build failed: %s", e)
    archived = store.archived_dates()
    if archived:
        run_compute(archived[0], archived[-1], status, details_for_last=None)
    return counts


def recompute(status: StatusStore, start: date | None, end: date | None, *, states_only: bool = False) -> int:
    if states_only:
        reclassify()
        return len(store.read_history())
    dates = store.archived_dates()
    if not dates:
        return 0
    start = start or dates[0]
    end = end or dates[-1]
    return run_compute(start, end, status)


def day_detail(status: StatusStore, d: date) -> bool:
    adjust.load_splits(write_report=False)
    res = compute_range(d, d, status=None, splits=adjust.SPLIT_ADJUSTED_STOCKS, detail_dates={d})
    write_details(res.details)
    return d in res.details


def classify_preview(config_path: str) -> dict[str, Any]:
    """How many stored day x bucket states would change under a candidate config."""
    from .classifier import load_config as _load
    hist = store.read_history()
    if not len(hist):
        return {"rows": 0, "changed": {}, "changed_dates": {}}
    cand = classify_history(hist.copy(), _load(config_path))
    cur = classify_history(hist.copy(), load_config())
    out: dict[str, Any] = {"rows": int(len(hist)), "changed": {}, "changed_dates": {}, "by_bucket": {}}
    for span in EMA_SPANS:
        col = f"state_ema{span}"
        diff = cand[col].fillna("") != cur[col].fillna("")
        out["changed"][str(span)] = int(diff.sum())
        out["changed_dates"][str(span)] = int(cand.loc[diff, "date"].nunique())
        out["by_bucket"][str(span)] = {str(k): int(v) for k, v in cand.loc[diff, "bucket"].value_counts().items()}
        out.setdefault("distribution", {})[str(span)] = {
            str(k): int(v) for k, v in cand[col].value_counts().items()}
    return out
