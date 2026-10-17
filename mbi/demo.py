"""Synthetic data for UI work and tests (``mbi demo``). Never touches real data:
it refuses to run when the archive holds anything not produced by the demo."""
from __future__ import annotations

import logging
from datetime import date, timedelta

import numpy as np
import pandas as pd

from . import adjust, paths, pipeline, store, universe
from .status import StatusStore

log = logging.getLogger(__name__)

# (sessions, daily drift, daily vol, volume multiplier) - cycles through market phases
PHASES = [
    (40, 0.0015, 0.008, 1.0),   # steady uptrend
    (25, 0.0035, 0.010, 1.5),   # strong rally
    (15, 0.0045, 0.012, 1.5),   # euphoric melt-up
    (30, -0.0005, 0.007, 0.75),  # muted chop
    (30, -0.0030, 0.011, 1.1),  # decline
    (6, -0.0150, 0.020, 1.9),   # panic
    (25, 0.0003, 0.008, 0.7),  # sellers pause
    (35, 0.0025, 0.009, 1.2),   # recovery
    (30, 0.0000, 0.006, 0.7),   # range
]


def _sessions(end: date, n: int) -> list[date]:
    out, d = [], end
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d -= timedelta(days=1)
    return out[::-1]


def build_demo(status: StatusStore, *, days: int = 300, seed: int = 7, force: bool = False,
               end: date | None = None) -> str:
    existing = store.archived_dates()
    if existing:
        sample = store.read_daily_prices(existing[-1])
        is_demo = sample is not None and (sample["source"] == "demo").all()
        if not is_demo:
            raise RuntimeError("the archive contains real data; refusing to write demo data "
                               "(point MBI_DATA_DIR at an empty directory)")
        if not force:
            raise RuntimeError("demo data already present (use --force to regenerate)")
    rng = np.random.default_rng(seed)
    end = end or date.today()
    n_total = days + 60
    sessions = _sessions(end, n_total)

    # universe: seed 750 + synthetic nanocaps
    top = universe.load_seed()
    nano = pd.DataFrame({"bucket": "NANOCAP", "symbol": [f"NANO{i:03d}" for i in range(1, 251)],
                         "company": None, "industry": None, "series": "EQ", "isin": None, "mcap_cr": None})
    uni = pd.concat([top, nano], ignore_index=True).assign(source="demo", rank=None)
    v = sessions[0]
    universe.save_version(uni, v)
    status.set_universe(version=v.isoformat(), source="demo", age_days=(end - v).days,
                        nanocap_stale=False, nanocap_note=None, warnings=["synthetic demo universe"])

    syms = uni["symbol"].tolist()
    buckets = uni["bucket"].tolist()
    n = len(syms)
    beta_by_bucket = {"LARGECAP": 0.9, "MIDCAP": 1.05, "SMALLCAP": 1.2, "MICROCAP": 1.35, "NANOCAP": 1.5}
    beta = np.array([beta_by_bucket[b] for b in buckets]) * rng.uniform(0.7, 1.3, n)
    idio = np.array([{"LARGECAP": .012, "MIDCAP": .016, "SMALLCAP": .02, "MICROCAP": .024, "NANOCAP": .028}[b]
                     for b in buckets])
    price = rng.uniform(80, 3000, n)
    base_vol = rng.lognormal(12, 1.2, n)
    listed_from = np.zeros(n, dtype=int)
    late = rng.choice(n, 12, replace=False)  # a few new listings
    listed_from[late] = rng.integers(n_total - 80, n_total - 10, len(late))

    phase_seq = []
    while len(phase_seq) < n_total:
        for length, mu, sd, vm in PHASES:
            phase_seq.extend([(mu, sd, vm)] * length)
    phase_seq = phase_seq[:n_total]

    splits = {s["symbol"]: (date.fromisoformat(s["ex_date"]), s["factor"]) for s in adjust.seed_from_csv()}
    # move the seed split dates inside the demo window so the adjustment is exercised
    for k, sym in enumerate(splits):
        splits[sym] = (sessions[60 + 25 * k], splits[sym][1])
    sym_idx = {s: i for i, s in enumerate(syms)}
    unlisted_jump = {sessions[-40]: "NANO017", sessions[-12]: "MICROCAP_PICK"}

    prev_close = price.copy()
    for t, d in enumerate(sessions):
        mu, sd, vm = phase_seq[t]
        m = rng.normal(mu, sd)
        r = beta * m + rng.normal(0, idio)
        price = np.maximum(price * np.exp(r), 1.0)
        close = price.copy()
        for sym, (ex, fac) in splits.items():
            i = sym_idx.get(sym)
            if i is not None and d < ex:
                close[i] = price[i] * fac  # raw, unadjusted pre-split price
        vf = rng.lognormal(np.log(vm), 0.12)
        vol = base_vol * vf * np.exp(rng.normal(0, 0.5, n) + 3 * np.abs(r - beta * m))
        for sym, (ex, fac) in splits.items():
            i = sym_idx.get(sym)
            if i is not None and d < ex:
                vol[i] = vol[i] / fac
        jump_sym = unlisted_jump.get(d)
        if jump_sym == "MICROCAP_PICK":
            jump_sym = next(s for s, b in zip(syms, buckets) if b == "MICROCAP")
        if jump_sym:
            i = sym_idx[jump_sym]
            close[i] = close[i] / 2.0
            price[i] = price[i] / 2.0
        alive = listed_from <= t
        df = pd.DataFrame({
            "date": d, "symbol": syms, "bucket": buckets,
            "open": prev_close * (1 + rng.normal(0, 0.003, n)), "high": np.maximum(close, prev_close) * 1.01,
            "low": np.minimum(close, prev_close) * 0.99, "close": close, "prev_close": prev_close,
            "volume": np.round(vol), "traded_value": np.round(vol * close), "trades": np.round(vol / 50),
            "source": "demo", "series": "EQ", "isin": "INE000000000",
        })[alive]
        if t == n_total - 7:  # a partial day: a few symbols missing
            df = df.iloc[15:]
        prev_close = close
        p = paths.prices_daily_file(d)
        if p.exists():
            p.unlink()
        store.atomic_write_parquet(p, df[store.PRICE_COLUMNS])

    status.autosave = False
    status.data["days"] = {}
    for t, d in enumerate(sessions):
        st, src, notes, errs, missing = "ok", "demo", ["synthetic demo data"], [], []
        if t == n_total - 3:
            st, notes = "recovered", notes + ["simulated: NSE 403, recovered after re-warm"]
            errs = ["simulated: attempt 1/4: HTTP 403"]
        elif t == n_total - 5:
            st, src = "fallback", "yfinance"
            notes = notes + ["simulated: Day built from fallback source nse_api + yfinance"]
        elif t == n_total - 7:
            st = "partial"
            missing = syms[:15]
            notes = notes + ["simulated: 15 symbols missing"]
        status.set_day(d, status=st, source=src, attempts=1, errors=errs, missing_symbols=missing, notes=notes)
    status.autosave = True
    status.save()

    # split list = demo-shifted seed (KOTAKBANK etc.)
    store.atomic_write_json(paths.splits_config(), [
        {"symbol": s, "ex_date": ex.isoformat(), "factor": f, "type": "split"} for s, (ex, f) in splits.items()
    ])
    pipeline.run_compute(sessions[0], sessions[-1], status)
    return f"demo data: {len(sessions)} sessions {sessions[0]}..{sessions[-1]} in {paths.data_dir()}"
