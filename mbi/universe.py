"""Universe construction (spec section 3).

Ranks 1-750 come from the four Nifty index CSVs; ranks 751-1000 (NANOCAP) are
derived from the bhavcopy archive ranked by market cap. Every version is saved to
``data/meta/universe_history/<YYYY-MM-DD>.csv`` and the version in force on a date
is the latest one dated on or before it (the earliest one for older dates).
"""
from __future__ import annotations

import io
import logging
import re
from datetime import date, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Any

import pandas as pd

from . import paths, store
from .nse_client import NSEClient, NSEError
from .status import StatusStore, now_iso

log = logging.getLogger(__name__)

INDEX_BASE = "https://nsearchives.nseindia.com/content/indices/"
INDEX_FILES = {
    "LARGECAP": "ind_nifty100list.csv",
    "MIDCAP": "ind_niftymidcap150list.csv",
    "SMALLCAP": "ind_niftysmallcap250list.csv",
    "MICROCAP": "ind_niftymicrocap250_list.csv",
}
EXPECTED_COUNTS = {"LARGECAP": 100, "MIDCAP": 150, "SMALLCAP": 250, "MICROCAP": 250, "NANOCAP": 250}
BUCKET_ORDER = {b: i for i, b in enumerate(store.BUCKETS)}
UNIVERSE_COLUMNS = ["rank", "bucket", "symbol", "company", "industry", "series", "isin", "mcap_cr", "source"]

NANOCAP_MIN_DAYS = 200
NANOCAP_MIN_MEDIAN_VALUE = 5e5  # Rs 5 lakh
SHARES_TTL_DAYS = 180
NANO_SERIES = {"EQ", "BE"}


# --------------------------------------------------------------------------- 1-750

def clean_index_csv(df: pd.DataFrame, bucket: str) -> pd.DataFrame:
    df = df.rename(columns=lambda c: str(c).strip())
    colmap = {}
    for c in df.columns:
        lc = c.lower()
        if lc.startswith("company"):
            colmap[c] = "company"
        elif lc == "industry":
            colmap[c] = "industry"
        elif lc == "symbol":
            colmap[c] = "symbol"
        elif lc == "series":
            colmap[c] = "series"
        elif lc.startswith("isin"):
            colmap[c] = "isin"
    df = df.rename(columns=colmap)
    if "symbol" not in df.columns:
        raise ValueError(f"{bucket}: no Symbol column")
    for c in ("company", "industry", "series", "isin"):
        if c not in df.columns:
            df[c] = None
    df["symbol"] = df["symbol"].astype(str).str.strip().str.upper()
    df = df[df["symbol"].ne("") & df["symbol"].ne("NAN")]
    df = df[~df["symbol"].str.startswith("DUMMY")]
    df = df.drop_duplicates("symbol")
    df = df.assign(bucket=bucket)
    return df[["bucket", "symbol", "company", "industry", "series", "isin"]].reset_index(drop=True)


def combine_750(parts: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Concatenate buckets in rank order; a symbol listed twice keeps the higher bucket."""
    frames = [parts[b] for b in ("LARGECAP", "MIDCAP", "SMALLCAP", "MICROCAP") if b in parts]
    df = pd.concat(frames, ignore_index=True).drop_duplicates("symbol", keep="first")
    return df.reset_index(drop=True)


def download_750(client: NSEClient) -> pd.DataFrame:
    parts = {}
    for bucket, fname in INDEX_FILES.items():
        text = client.get(INDEX_BASE + fname, kind="text")
        parts[bucket] = clean_index_csv(pd.read_csv(io.StringIO(text)), bucket)
    return combine_750(parts)


def load_seed() -> pd.DataFrame:
    df = pd.read_csv(paths.seed_universe_file())
    parts = {b: clean_index_csv(g.drop(columns="bucket"), b) for b, g in df.groupby("bucket")}
    return combine_750(parts)


def count_issues(df: pd.DataFrame) -> list[str]:
    out = []
    counts = df["bucket"].value_counts().to_dict()
    for b, n in EXPECTED_COUNTS.items():
        if b == "NANOCAP" and b not in counts:
            continue
        if counts.get(b, 0) != n:
            out.append(f"{b}: expected {n}, got {counts.get(b, 0)}")
    if df["symbol"].duplicated().any():
        out.append("duplicate symbols present")
    if df["symbol"].str.startswith("DUMMY").any():
        out.append("DUMMY placeholder rows present")
    return out


# --------------------------------------------------------------------------- versions

def list_versions() -> list[date]:
    d = paths.universe_history_dir()
    if not d.exists():
        return []
    out = []
    for p in d.glob("*.csv"):
        try:
            out.append(date.fromisoformat(p.stem))
        except ValueError:
            pass
    return sorted(out)


@lru_cache(maxsize=32)
def _load_version_cached(v: date, mtime: float) -> pd.DataFrame:
    df = pd.read_csv(paths.universe_history_dir() / f"{v.isoformat()}.csv", dtype={"symbol": str})
    return df


def load_version(v: date) -> pd.DataFrame:
    p = paths.universe_history_dir() / f"{v.isoformat()}.csv"
    return _load_version_cached(v, p.stat().st_mtime).copy()


def version_for(d: date, versions: list[date] | None = None) -> date | None:
    versions = versions if versions is not None else list_versions()
    if not versions:
        return None
    eligible = [v for v in versions if v <= d]
    return eligible[-1] if eligible else versions[0]


def universe_for(d: date) -> tuple[date | None, pd.DataFrame]:
    v = version_for(d)
    if v is None:
        return None, pd.DataFrame(columns=UNIVERSE_COLUMNS)
    return v, load_version(v)


def save_version(df: pd.DataFrame, v: date) -> Path:
    df = df.copy()
    if "rank" not in df.columns:
        df["rank"] = None
    df["_o"] = df["bucket"].map(BUCKET_ORDER)
    df = df.sort_values(["_o", "rank"], na_position="last").drop(columns="_o").reset_index(drop=True)
    df["rank"] = range(1, len(df) + 1)
    for c in UNIVERSE_COLUMNS:
        if c not in df.columns:
            df[c] = None
    p = paths.universe_history_dir() / f"{v.isoformat()}.csv"
    store.atomic_write_csv(p, df[UNIVERSE_COLUMNS])
    _load_version_cached.cache_clear()
    return p


# --------------------------------------------------------------------------- nanocap

def _read_shares_cache() -> pd.DataFrame:
    p = paths.shares_cache()
    if p.exists():
        try:
            return pd.read_csv(p)
        except Exception:  # noqa: BLE001
            pass
    return pd.DataFrame(columns=["symbol", "issued_size", "fetched_at"])


def _yf_shares(sym: str) -> float | None:
    try:
        import yfinance as yf  # type: ignore
        v = yf.Ticker(f"{sym}.NS").fast_info.get("shares")
        return float(v) if v else None
    except Exception:  # noqa: BLE001 - any yfinance failure means "unavailable"
        return None


def fetch_share_counts(client: NSEClient, symbols: list[str], *, ttl_days: int = SHARES_TTL_DAYS,
                       probe: int = 3) -> dict[str, float]:
    """Shares outstanding, cached for ``ttl_days``.

    Source chain: NSE quote-equity (securityInfo.issuedSize) -> yfinance fast_info.shares.
    If the first ``probe`` NSE calls all fail (NSE's bot protection often blocks this
    endpoint for non-browser clients) the rest go straight to yfinance."""
    cache = _read_shares_cache()
    cutoff = (datetime.now() - timedelta(days=ttl_days)).isoformat()
    fresh = cache[cache["fetched_at"].astype(str) >= cutoff]
    have = dict(zip(fresh["symbol"], fresh["issued_size"]))
    todo = [s for s in symbols if s not in have]
    log.info("share counts: %d cached, %d to fetch", len(symbols) - len(todo), len(todo))
    new_rows = []
    nse_ok = True
    nse_tried = nse_failed = 0
    for i, sym in enumerate(todo, 1):
        size, src = None, None
        if nse_ok:
            nse_tried += 1
            try:
                js = client.get(f"{NSEClient.BASE_URL}/api/quote-equity", params={"symbol": sym})
                size, src = float(js["securityInfo"]["issuedSize"]), "nse"
            except (NSEError, KeyError, TypeError, ValueError) as e:
                nse_failed += 1
                log.warning("issuedSize for %s unavailable from NSE: %s", sym, e)
                if nse_tried >= probe and nse_failed == nse_tried:
                    log.warning("NSE quote-equity is blocked; using yfinance for share counts")
                    nse_ok = False
        if size is None:
            size, src = _yf_shares(sym), "yfinance"
        if size:
            have[sym] = size
            new_rows.append({"symbol": sym, "issued_size": size, "source": src,
                             "fetched_at": datetime.now().isoformat()})
        if i % 100 == 0:
            log.info("share counts: %d/%d", i, len(todo))
            _write_shares_cache(cache, new_rows)
    _write_shares_cache(cache, new_rows)
    return {s: have[s] for s in symbols if s in have}


def _write_shares_cache(cache: pd.DataFrame, new_rows: list[dict]) -> None:
    if not new_rows:
        return
    df = pd.concat([cache, pd.DataFrame(new_rows)], ignore_index=True)
    df = df.drop_duplicates("symbol", keep="last")
    store.atomic_write_csv(paths.shares_cache(), df)


def read_amfi_mcap(path: str | Path) -> dict[str, float]:
    """Optional: AMFI 'Average Market Capitalization' xlsx -> {NSE symbol: mcap (Rs cr)}."""
    df = pd.read_excel(path, header=None)
    header_row = None
    for i in range(min(15, len(df))):
        row = " ".join(str(x) for x in df.iloc[i].tolist()).lower()
        if "nse" in row and "symbol" in row:
            header_row = i
            break
    if header_row is None:
        raise ValueError("could not find the NSE Symbol header row in the AMFI file")
    df.columns = [str(c).strip() for c in df.iloc[header_row]]
    df = df.iloc[header_row + 1:]
    sym_col = next(c for c in df.columns if re.search(r"nse.*symbol", c, re.I))
    cap_cols = [c for c in df.columns if re.search(r"average.*market.*cap", c, re.I)]
    if not cap_cols:
        raise ValueError("no 'Average Market Capitalization' column")
    cap_col = cap_cols[0]
    out = {}
    for s, v in zip(df[sym_col], df[cap_col]):
        try:
            if isinstance(s, str) and s.strip():
                out[s.strip().upper()] = float(v)
        except (TypeError, ValueError):
            continue
    return out


def nanocap_candidates(prices: pd.DataFrame, exclude: set[str], *, min_days: int,
                       min_median_value: float) -> tuple[pd.DataFrame, bool]:
    """Liquidity-filtered candidates from the archive. Returns (candidates, provisional).

    provisional=True when the archive is shorter than ``min_days`` sessions so the
    history test had to be relaxed to "present on 90% of archived sessions"."""
    if not len(prices):
        return pd.DataFrame(columns=["symbol", "close", "median_value", "n_days", "isin", "series"]), True
    p = prices[prices["series"].isin(NANO_SERIES) & ~prices["symbol"].isin(exclude)]
    p = p[p["isin"].astype(str).str.startswith("INE")]  # drops ETFs / MF units (INF...)
    n_sessions = prices["date"].nunique()
    provisional = n_sessions < min_days
    need = min_days if not provisional else max(1, int(n_sessions * 0.9))
    p = p.sort_values("date")
    tail = p.groupby("symbol").tail(min_days)
    g = tail.groupby("symbol")
    stats = pd.DataFrame({
        "n_days": p.groupby("symbol").size(),
        "median_value": g["traded_value"].median(),
        "close": p.groupby("symbol")["close"].last(),
        "isin": p.groupby("symbol")["isin"].last(),
        "series": p.groupby("symbol")["series"].last(),
    }).reset_index()
    ok = (stats["n_days"] >= need) & (stats["median_value"] > min_median_value)
    return stats[ok].reset_index(drop=True), provisional


def rank_nanocap(candidates: pd.DataFrame, shares: dict[str, float], amfi: dict[str, float] | None = None,
                 n: int = 250) -> pd.DataFrame:
    c = candidates.copy()
    if amfi:
        c["mcap_cr"] = c["symbol"].map(amfi)
    else:
        c["mcap_cr"] = None
    missing = c["mcap_cr"].isna()
    c.loc[missing, "mcap_cr"] = c.loc[missing, "symbol"].map(shares) * c.loc[missing, "close"] / 1e7
    c = c.dropna(subset=["mcap_cr"]).sort_values("mcap_cr", ascending=False).head(n)
    return pd.DataFrame({
        "bucket": "NANOCAP", "symbol": c["symbol"], "company": None, "industry": None,
        "series": c["series"], "isin": c["isin"], "mcap_cr": c["mcap_cr"].round(2),
    }).reset_index(drop=True)


# --------------------------------------------------------------------------- refresh

def refresh_due(today: date) -> bool:
    """True when the latest version predates the most recent reconstitution
    (end of June / end of December)."""
    versions = list_versions()
    if not versions:
        return True
    last_boundary = date(today.year, 7, 1) if today >= date(today.year, 7, 1) else date(today.year, 1, 1)
    return versions[-1] < last_boundary


def _universe_status(status: StatusStore, v: date, source: str, today: date, **extra: Any) -> None:
    status.set_universe(version=v.isoformat(), source=source, age_days=(today - v).days,
                        checked_at=now_iso(), **extra)


def build_or_refresh(client: NSEClient, status: StatusStore, *, today: date | None = None,
                     amfi_file: str | None = None, nanocap_only: bool = False,
                     offline: bool = False) -> date:
    """Build a new universe version dated ``today``. Falls back as per spec 9."""
    today = today or date.today()
    versions = list_versions()
    last = load_version(versions[-1]) if versions else None
    warnings: list[str] = []

    # ---- ranks 1-750
    source = "nse_index_csv"
    top = None
    if nanocap_only and last is not None:
        top = last[last["bucket"] != "NANOCAP"].copy()
        source = "previous_version"
    elif not offline:
        try:
            top = download_750(client)
            issues = count_issues(top)
            if issues:
                warnings.extend(f"index CSV: {x}" for x in issues)
        except NSEError as e:
            warnings.append(f"index CSV download failed: {e}")
            status.event("universe_fallback", f"index CSV download failed: {e}")
    if top is None:
        if last is not None:
            top = last[last["bucket"] != "NANOCAP"].copy()
            source = f"universe_history:{versions[-1].isoformat()}"
        else:
            top = load_seed()
            source = "seed:universe_seed_750.csv"
        warnings.append(f"using {source} for ranks 1-750")
    top = top[[c for c in top.columns if c != "rank"]]

    # ---- ranks 751-1000
    nano_stale = False
    nano_note = None
    exclude = set(top["symbol"])
    prices = store.load_prices()
    cands, provisional = nanocap_candidates(prices, exclude, min_days=NANOCAP_MIN_DAYS,
                                            min_median_value=NANOCAP_MIN_MEDIAN_VALUE)
    nano = None
    if len(cands):
        amfi = None
        if amfi_file:
            try:
                amfi = read_amfi_mcap(amfi_file)
            except Exception as e:  # noqa: BLE001
                warnings.append(f"AMFI file unreadable: {e}")
        shares: dict[str, float] = {}
        if not offline:
            need = [s for s in cands["symbol"] if not amfi or s not in amfi]
            try:
                shares = fetch_share_counts(client, need)
            except NSEError as e:
                warnings.append(f"share counts unavailable: {e}")
        ranked = rank_nanocap(cands, shares, amfi)
        if len(ranked) >= EXPECTED_COUNTS["NANOCAP"]:
            nano = ranked
            if provisional:
                nano_note = (f"provisional: archive has fewer than {NANOCAP_MIN_DAYS} sessions, "
                             "history filter relaxed. Re-run `mbi universe --refresh` after backfill.")
        else:
            warnings.append(f"only {len(ranked)} nanocap names could be ranked (shares or history missing)")
    else:
        warnings.append("no nanocap candidates: the price archive is empty (run `mbi backfill` first)")

    if nano is None:
        if last is not None and (last["bucket"] == "NANOCAP").any():
            nano = last[last["bucket"] == "NANOCAP"].drop(columns=["rank"], errors="ignore")
            nano = nano[~nano["symbol"].isin(exclude)]
            nano_stale = True
            nano_note = "Nanocap list is stale: reused the previous ranking"
        else:
            nano_stale = True
            nano_note = "Nanocap list not built yet (needs archive history and share counts)"
    if nano_note:
        warnings.append(nano_note)

    parts = [top.assign(source=source)]
    if nano is not None and len(nano):
        parts.append(nano.assign(source="ranked" if not nano_stale else "previous_version"))
    df = pd.concat(parts, ignore_index=True)
    df["rank"] = None
    save_version(df, today)
    for w in warnings:
        log.warning("universe: %s", w)
    _universe_status(status, today, source, today, nanocap_stale=nano_stale, nanocap_note=nano_note,
                     warnings=warnings, counts=df["bucket"].value_counts().to_dict())
    status.event("universe", f"universe version {today} saved ({len(df)} symbols, 1-750 from {source})")
    return today


def ensure_universe(client: NSEClient, status: StatusStore, today: date, *, offline: bool = False) -> date:
    versions = list_versions()
    if not versions:
        return build_or_refresh(client, status, today=today, offline=offline)
    if refresh_due(today) and not offline:
        log.info("universe refresh due (half-yearly reconstitution)")
        return build_or_refresh(client, status, today=today)
    v = versions[-1]
    u = status.data.get("universe") or {}
    if u.get("version") != v.isoformat():
        _universe_status(status, v, "universe_history", today, nanocap_stale=False, nanocap_note=None, warnings=[])
    else:
        status.set_universe(age_days=(today - v).days)
    return v


# --------------------------------------------------------------------------- diff

def diff(old: pd.DataFrame, new: pd.DataFrame) -> dict[str, list[dict[str, str]]]:
    o = dict(zip(old["symbol"], old["bucket"]))
    n = dict(zip(new["symbol"], new["bucket"]))
    out: dict[str, list[dict[str, str]]] = {"added": [], "removed": [], "promoted": [], "demoted": []}
    for s, b in sorted(n.items()):
        if s not in o:
            out["added"].append({"symbol": s, "to": b})
        elif o[s] != b:
            key = "promoted" if BUCKET_ORDER[b] < BUCKET_ORDER[o[s]] else "demoted"
            out[key].append({"symbol": s, "from": o[s], "to": b})
    for s, b in sorted(o.items()):
        if s not in n:
            out["removed"].append({"symbol": s, "from": b})
    return out
