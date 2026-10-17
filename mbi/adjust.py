"""Split adjustment driven by a user-maintained list (spec section 6).

The app never fetches corporate actions. ``SPLIT_ADJUSTED_STOCKS`` is loaded from
``data/config/split_adjustments.json``; ``adjust_ohlcv`` applies it at calculation
time and never touches the archive.
"""
from __future__ import annotations

import csv
import logging
from datetime import date
from typing import Any, Iterable

import numpy as np
import pandas as pd

from . import paths
from .store import atomic_write_json, read_json

log = logging.getLogger(__name__)

SPLIT_ADJUSTED_STOCKS: list[dict[str, Any]] = []
SPLIT_ISSUES: list[dict[str, Any]] = []


def seed_from_csv() -> list[dict[str, Any]]:
    """Convert splits_seed.csv (spec 14) into the JSON variable format."""
    out = []
    p = paths.seed_splits_file()
    if not p.exists():
        return out
    with open(p, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            out.append({
                "symbol": r["symbol"].strip(),
                "ex_date": r["ex_date"].strip(),
                "old_fv": float(r["old_fv"]),
                "new_fv": float(r["new_fv"]),
                "factor": float(r["factor"]),
                "type": "split",
            })
    return out


def ensure_config() -> None:
    if not paths.splits_config().exists():
        atomic_write_json(paths.splits_config(), seed_from_csv())


def validate_splits(raw: Iterable[Any], archive_symbols: set[str] | None = None
                    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return (valid_rows, issues). Invalid rows are skipped (spec 6.1)."""
    valid: list[dict[str, Any]] = []
    issues: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for i, row in enumerate(raw if isinstance(raw, list) else []):
        def bad(reason: str) -> None:
            issues.append({"index": i, "row": row, "reason": reason})

        if not isinstance(row, dict):
            bad("entry is not an object")
            continue
        sym = str(row.get("symbol", "")).strip().upper()
        if not sym:
            bad("missing symbol")
            continue
        try:
            ex = date.fromisoformat(str(row.get("ex_date", "")).strip())
        except ValueError:
            bad(f"invalid ex_date {row.get('ex_date')!r}")
            continue
        factor = row.get("factor")
        typ = str(row.get("type", "split")).lower()
        if factor is None:
            # derive it when only face values / bonus ratio are given
            try:
                if typ == "bonus" and row.get("bonus_x") and row.get("bonus_y"):
                    factor = (float(row["bonus_x"]) + float(row["bonus_y"])) / float(row["bonus_y"])
                else:
                    factor = float(row["old_fv"]) / float(row["new_fv"])
            except (KeyError, TypeError, ValueError, ZeroDivisionError):
                bad("factor missing and cannot be derived")
                continue
        try:
            factor = float(factor)
        except (TypeError, ValueError):
            bad(f"factor {factor!r} is not a number")
            continue
        if not np.isfinite(factor) or factor <= 0:
            bad(f"factor must be > 0 (got {factor})")
            continue
        key = (sym, ex.isoformat())
        if key in seen:
            bad(f"duplicate entry for {sym} on {ex}")
            continue
        if archive_symbols is not None and len(archive_symbols) and sym not in archive_symbols:
            bad(f"symbol {sym} not present in the price archive")
            continue
        seen.add(key)
        valid.append({**row, "symbol": sym, "ex_date": ex.isoformat(), "factor": factor, "type": typ})
    return valid, issues


def load_splits(archive_symbols: set[str] | None = None, write_report: bool = True
                ) -> list[dict[str, Any]]:
    """Load + validate the user list into the module-level SPLIT_ADJUSTED_STOCKS."""
    global SPLIT_ADJUSTED_STOCKS, SPLIT_ISSUES
    ensure_config()
    raw = read_json(paths.splits_config(), None)
    if raw is None:
        valid, issues = [], [{"index": None, "row": None, "reason": "split_adjustments.json is missing or not valid JSON"}]
    else:
        valid, issues = validate_splits(raw, archive_symbols)
    SPLIT_ADJUSTED_STOCKS = valid
    SPLIT_ISSUES = issues
    for iss in issues:
        log.warning("split list: skipped row %s: %s", iss["index"], iss["reason"])
    if write_report:
        from .status import now_iso
        atomic_write_json(paths.split_validation_file(), {
            "checked_at": now_iso(), "n_valid": len(valid), "valid": valid, "issues": issues,
        })
    return valid


def adjust_ohlcv(df: pd.DataFrame, splits: list[dict[str, Any]] | None = None) -> pd.DataFrame:
    """Back-adjust OHLCV for listed splits/bonuses.

    For each row dated *before* an ex-date, F = product of all factors whose ex-date
    is after the row's date; adj_price = price / F, adj_volume = volume * F.
    Original columns are returned unchanged plus adj_open/high/low/close/volume and
    adj_factor. The input frame is not modified.
    """
    if splits is None:
        splits = SPLIT_ADJUSTED_STOCKS
    out = df.copy()
    factor = np.ones(len(out), dtype="float64")
    if len(out) and splits:
        dates = pd.to_datetime(out["date"]).to_numpy()
        syms = out["symbol"].to_numpy()
        by_sym: dict[str, list[tuple[np.datetime64, float]]] = {}
        for s in splits:
            by_sym.setdefault(str(s["symbol"]).upper(), []).append(
                (np.datetime64(pd.Timestamp(s["ex_date"])), float(s["factor"])))
        for sym, events in by_sym.items():
            idx = np.flatnonzero(syms == sym)
            if not len(idx):
                continue
            d = dates[idx]
            f = np.ones(len(idx))
            for ex, fac in events:
                f = np.where(d < ex, f * fac, f)
            factor[idx] = f
    out["adj_factor"] = factor
    for c in ("open", "high", "low", "close"):
        out[f"adj_{c}"] = pd.to_numeric(out[c], errors="coerce") / factor
    out["adj_volume"] = pd.to_numeric(out["volume"], errors="coerce") * factor
    return out
