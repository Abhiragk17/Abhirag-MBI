"""Volume ratio and % above EMA, per bucket (spec section 7.1-7.3).

Design notes
* Everything is computed from the raw archive + the split list (offline).
* EMA(t) is computed over a fixed window of the last ``EMA_WINDOW`` sessions ending at
  t, seeded from the first valid close inside that window. 320 sessions is ~13x the
  EMA50 time constant, so the seed has no practical effect, and the result for a date
  is identical whether it is produced by ``daily`` or by ``recompute`` over any range.
* Days listed as ``short_sessions`` in calendar.json (Muhurat etc.) are skipped.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date
from typing import Any

import numpy as np
import pandas as pd

from . import adjust, ingest, paths, store, universe
from .classifier import EMA_SPANS, load_config, vol_regime
from .status import StatusStore

log = logging.getLogger(__name__)

EMA_WINDOW = 320
LOAD_EXTRA = 330
MIN_HISTORY = 50
AVG_WINDOW = 20
HIGH_RV = 1.5
LOW_RV = 0.5
JUMP_LOW = 0.6
JUMP_HIGH = 1.6

DEFAULT_APP_CONFIG = {
    "include_today_in_avg": False,
    "detail_days": 30,
}


def app_config() -> dict[str, Any]:
    p = paths.app_config()
    if not p.exists():
        store.atomic_write_json(p, DEFAULT_APP_CONFIG)
    return {**DEFAULT_APP_CONFIG, **(store.read_json(p, {}) or {})}


# --------------------------------------------------------------------------- helpers

def _per_symbol(arr: np.ndarray, fn) -> np.ndarray:
    """Apply ``fn`` to each column's non-NaN values (the symbol's own sessions)."""
    out = np.full(arr.shape, np.nan)
    for j in range(arr.shape[1]):
        col = arr[:, j]
        m = ~np.isnan(col)
        if m.any():
            out[m, j] = fn(col[m])
    return out


def _rolling_prev_mean(n: int, include_today: bool):
    def fn(v: np.ndarray) -> np.ndarray:
        res = np.full(len(v), np.nan)
        c = np.concatenate([[0.0], np.cumsum(v)])
        if include_today:
            if len(v) >= n:
                i = np.arange(n - 1, len(v))
                res[i] = (c[i + 1] - c[i + 1 - n]) / n
        else:
            if len(v) > n:
                i = np.arange(n, len(v))
                res[i] = (c[i] - c[i - n]) / n
        return res
    return fn


def _ratio_prev(v: np.ndarray) -> np.ndarray:
    res = np.full(len(v), np.nan)
    if len(v) > 1:
        with np.errstate(divide="ignore", invalid="ignore"):
            res[1:] = v[1:] / v[:-1]
    return res


def ema_last(window: np.ndarray, span: int) -> np.ndarray:
    """EMA (adjust=False, NaNs skipped) of each column, evaluated at the last row,
    seeded from the column's first valid value in the window."""
    a = 2.0 / (span + 1.0)
    valid = ~np.isnan(window)
    after = np.cumsum(valid[::-1], axis=0)[::-1] - 1  # valid rows after this one
    m = valid.sum(axis=0)
    w = np.where(valid, a * (1.0 - a) ** after, 0.0)
    first = valid & (after == (m - 1)[None, :])
    w = np.where(first, (1.0 - a) ** after, w)
    out = (w * np.nan_to_num(window)).sum(axis=0)
    out[m == 0] = np.nan
    return out


@dataclass
class ComputeResult:
    rows: pd.DataFrame
    details: dict[date, pd.DataFrame]
    dates: list[date]


# --------------------------------------------------------------------------- main

def compute_range(start: date, end: date, *, status: StatusStore | None = None,
                  splits: list[dict] | None = None, include_today_in_avg: bool | None = None,
                  detail_dates: set[date] | None = None) -> ComputeResult:
    cfg_app = app_config()
    if include_today_in_avg is None:
        include_today_in_avg = bool(cfg_app["include_today_in_avg"])
    regime_cfg = load_config()
    short = {date.fromisoformat(x) for x in ingest.load_calendar_config().get("short_sessions", [])}
    sessions = [d for d in store.archived_dates() if d not in short]
    targets = [d for d in sessions if start <= d <= end]
    if not targets:
        return ComputeResult(store.empty_history(), {}, [])

    first_idx = sessions.index(targets[0])
    load_dates = sessions[max(0, first_idx - LOAD_EXTRA): sessions.index(targets[-1]) + 1]

    versions = universe.list_versions()
    ver_for = {d: universe.version_for(d, versions) for d in targets}
    uni_by_ver = {v: universe.load_version(v) for v in set(ver_for.values()) if v is not None}
    symbols = sorted(set().union(*[set(u["symbol"]) for u in uni_by_ver.values()])) if uni_by_ver else []

    prices = store.load_prices(dates=load_dates)
    prices = prices[prices["symbol"].isin(symbols)]
    if splits is None:
        splits = adjust.SPLIT_ADJUSTED_STOCKS
    adj = adjust.adjust_ohlcv(prices, splits)

    date_index = pd.Index(load_dates, name="date")
    col_index = pd.Index(symbols, name="symbol")

    def wide(col: str) -> np.ndarray:
        if not len(adj):
            return np.full((len(date_index), len(col_index)), np.nan)
        w = adj.pivot(index="date", columns="symbol", values=col)
        return w.reindex(index=date_index, columns=col_index).to_numpy(dtype="float64")

    close = wide("adj_close")
    vol = wide("adj_volume")
    raw_close = wide("close")
    raw_vol = wide("volume")
    factor = wide("adj_factor")

    avgvol = _per_symbol(vol, _rolling_prev_mean(AVG_WINDOW, include_today_in_avg))
    jump = _per_symbol(close, _ratio_prev)
    present = (~np.isnan(close)).astype("float64")
    hist_count = pd.DataFrame(present).rolling(EMA_WINDOW, min_periods=1).sum().to_numpy()

    col_pos = {s: i for i, s in enumerate(symbols)}
    row_pos = {d: i for i, d in enumerate(load_dates)}
    split_dates = {(s["symbol"], s["ex_date"]) for s in splits}

    out_rows: list[dict[str, Any]] = []
    details: dict[date, pd.DataFrame] = {}
    day_status = status.data["days"] if status is not None else {}

    for d in targets:
        v = ver_for[d]
        u = uni_by_ver.get(v) if v is not None else None
        i = row_pos[d]
        lo = max(0, i - EMA_WINDOW + 1)
        if u is None or not len(u):
            u = pd.DataFrame(columns=["symbol", "bucket"])
        cols = np.array([col_pos[s] for s in u["symbol"]], dtype=int)
        buckets = u["bucket"].to_numpy()
        win = close[lo:i + 1][:, cols] if len(cols) else np.empty((i + 1 - lo, 0))
        emas = {span: ema_last(win, span) for span in EMA_SPANS}

        c_t = close[i, cols] if len(cols) else np.array([])
        rv_t = raw_vol[i, cols] if len(cols) else np.array([])
        v_t = vol[i, cols] if len(cols) else np.array([])
        avg_t = avgvol[i, cols] if len(cols) else np.array([])
        hc_t = hist_count[i, cols] if len(cols) else np.array([])
        j_t = jump[i, cols] if len(cols) else np.array([])

        traded = ~np.isnan(c_t) & (np.nan_to_num(rv_t) > 0)
        hist_ok = hc_t >= MIN_HISTORY
        jump_flag = ~np.isnan(j_t) & ((j_t < JUMP_LOW) | (j_t > JUMP_HIGH))
        avg_ok = ~np.isnan(avg_t) & (avg_t > 0)
        valid = traded & hist_ok & ~jump_flag & avg_ok
        with np.errstate(divide="ignore", invalid="ignore"):
            rel = np.where(avg_ok, v_t / avg_t, np.nan)

        reasons = np.where(~traded, "not traded",
                  np.where(~hist_ok, f"history < {MIN_HISTORY} sessions",
                  np.where(jump_flag, "suspected unadjusted event",
                  np.where(~avg_ok, "no volume average", ""))))

        above = {span: valid & (c_t > emas[span]) for span in EMA_SPANS}
        high = valid & (rel >= HIGH_RV)
        low = valid & (rel < LOW_RV)

        ds = day_status.get(d.isoformat(), {}) if isinstance(day_status, dict) else {}
        for b in store.ALL_BUCKETS:
            m = np.ones(len(cols), dtype=bool) if b == "ALL" else (buckets == b)
            n_u = int(m.sum())
            n_v = int((valid & m).sum())
            nh = int((high & m).sum())
            nl = int((low & m).sum())
            vr = round(nh / nl, 4) if nl > 0 else None
            row = {
                "date": d, "bucket": b, "universe_version": v.isoformat() if v else None,
                "n_universe": n_u, "n_valid": n_v, "n_excluded": n_u - n_v,
                "n_high": nh, "n_low": nl, "vol_ratio": vr, "vol_regime": vol_regime(vr, regime_cfg) if n_v else None,
                "data_source": ds.get("source") or ("unknown" if not ds else None),
                "data_quality": ds.get("status", "unknown"),
            }
            for span in EMA_SPANS:
                na = int((above[span] & m).sum())
                row[f"n_above_ema{span}"] = na
                row[f"pct_ema{span}"] = round(100.0 * na / n_v, 4) if n_v else None
            out_rows.append(row)

        # ---- per-day status: exclusions and suspected events
        if status is not None and len(cols):
            syms = u["symbol"].to_numpy()
            suspected = []
            for k in np.flatnonzero(jump_flag & traded):
                sym = str(syms[k])
                if (sym, d.isoformat()) in split_dates:
                    continue
                suspected.append({"symbol": sym, "bucket": str(buckets[k]), "ratio": round(float(j_t[k]), 4),
                                  "hint": f"close/prev_close = {j_t[k]:.2f}: add {sym} to the split list?"})
            excl = [{"symbol": str(syms[k]), "reason": str(reasons[k])}
                    for k in np.flatnonzero(~valid) if reasons[k] not in ("", f"history < {MIN_HISTORY} sessions")]
            summary = pd.Series(reasons[~valid]).value_counts().to_dict() if (~valid).any() else {}
            if d.isoformat() in status.data["days"] or suspected:
                status.set_day(d, excluded_symbols=excl, suspected_events=suspected,
                               excluded_summary={str(k): int(v2) for k, v2 in summary.items()})

        if detail_dates is not None and d in detail_dates:
            details[d] = pd.DataFrame({
                "symbol": u["symbol"].to_numpy(), "bucket": buckets,
                "close": raw_close[i, cols] if len(cols) else [], "adj_close": c_t,
                "volume": raw_vol[i, cols] if len(cols) else [], "adj_volume": v_t,
                "adj_factor": factor[i, cols] if len(cols) else [],
                "avgvol20": avg_t, "rel_vol": rel,
                "ema10": emas[10], "ema20": emas[20], "ema50": emas[50],
                "above_ema10": above[10], "above_ema20": above[20], "above_ema50": above[50],
                "valid": valid, "reason": reasons,
                "jump_ratio": j_t, "history_days": hc_t,
            })

    rows = pd.DataFrame(out_rows)
    return ComputeResult(rows, details, targets)
