"""Atomic writers, the raw price archive and the breadth history file (spec 5.2, 7.3)."""
from __future__ import annotations

import io
import json
import logging
import os
import tempfile
import time
from datetime import date, datetime
from pathlib import Path
from typing import Iterable

import pandas as pd

from . import paths

log = logging.getLogger(__name__)

BUCKETS = ["LARGECAP", "MIDCAP", "SMALLCAP", "MICROCAP", "NANOCAP"]
ALL_BUCKETS = BUCKETS + ["ALL"]

PRICE_COLUMNS = [
    "date", "symbol", "bucket", "open", "high", "low", "close", "prev_close",
    "volume", "traded_value", "trades", "source", "series", "isin",
]

HISTORY_COLUMNS = [
    "date", "bucket", "universe_version", "n_universe", "n_valid", "n_excluded",
    "n_high", "n_low", "vol_ratio", "vol_regime",
    "n_above_ema10", "n_above_ema20", "n_above_ema50",
    "pct_ema10", "pct_ema20", "pct_ema50",
    "state_ema10", "state_ema20", "state_ema50", "state_raw_ema20",
    "data_source", "data_quality",
    # Extra columns (after the spec's list so the file stays compatible):
    "state_raw_ema10", "state_raw_ema50",
    "rule_ema10", "rule_ema20", "rule_ema50",
    "dp_ema10", "dp_ema20", "dp_ema50",
    "days_in_state_ema10", "days_in_state_ema20", "days_in_state_ema50",
]

STATE_COLUMNS = [c for c in HISTORY_COLUMNS if c.startswith(("state_", "rule_", "dp_", "days_in_state_"))]


# --------------------------------------------------------------------------- atomic IO

def atomic_write_bytes(path: Path, data: bytes) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        # On Windows a reader (the Next.js server) can briefly hold the target open.
        for attempt in range(10):
            try:
                os.replace(tmp, path)
                break
            except PermissionError:
                if attempt == 9:
                    raise
                time.sleep(0.2)
    except BaseException:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise


def atomic_write_text(path: Path, text: str) -> None:
    atomic_write_bytes(path, text.encode("utf-8"))


def _json_default(o):
    if isinstance(o, (date, datetime)):
        return o.isoformat()
    if hasattr(o, "item"):  # numpy scalars
        return o.item()
    raise TypeError(f"not JSON serialisable: {type(o)}")


def atomic_write_json(path: Path, obj) -> None:
    atomic_write_text(path, json.dumps(obj, indent=2, default=_json_default, allow_nan=False))


def read_json(path: Path, default=None):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default
    except (json.JSONDecodeError, OSError) as e:
        log.warning("could not read %s: %s", path, e)
        return default


def atomic_write_parquet(path: Path, df: pd.DataFrame) -> None:
    buf = io.BytesIO()
    df.to_parquet(buf, index=False)
    atomic_write_bytes(path, buf.getvalue())


def atomic_write_csv(path: Path, df: pd.DataFrame) -> None:
    atomic_write_text(path, df.to_csv(index=False, lineterminator="\n"))


# --------------------------------------------------------------------------- price archive

def archived_dates() -> list[date]:
    root = paths.prices_daily_dir()
    if not root.exists():
        return []
    out = []
    for p in root.glob("*/*.parquet"):
        try:
            out.append(date.fromisoformat(p.stem))
        except ValueError:
            continue  # superseded copies etc.
    return sorted(out)


def read_daily_prices(d: date) -> pd.DataFrame | None:
    p = paths.prices_daily_file(d)
    if not p.exists():
        return None
    return pd.read_parquet(p)


def write_daily_prices(d: date, df: pd.DataFrame, *, rebuild: bool = False) -> Path:
    """Write one session's raw OHLCV. Never overwrites a primary-source file unless
    rebuild=True; a fallback-built day may be upgraded and the old file is kept."""
    p = paths.prices_daily_file(d)
    if p.exists() and not rebuild:
        existing = pd.read_parquet(p, columns=["source"])
        primary = (existing["source"] == "nse_bhavcopy").all() and len(existing) > 0
        if primary:
            raise FileExistsError(f"{p} already archived (use --rebuild to replace)")
    if p.exists():
        stamp = datetime.now().strftime("%Y%m%d%H%M%S")
        keep = p.with_name(f"{p.stem}.superseded-{stamp}.parquet")
        os.replace(p, keep)
        log.info("kept previous archive copy as %s", keep.name)
    df = df.copy()
    for c in PRICE_COLUMNS:
        if c not in df.columns:
            df[c] = None
    df = df[PRICE_COLUMNS]
    atomic_write_parquet(p, df)
    return p


def load_prices(start: date | None = None, end: date | None = None,
                dates: Iterable[date] | None = None) -> pd.DataFrame:
    wanted = list(dates) if dates is not None else [
        d for d in archived_dates()
        if (start is None or d >= start) and (end is None or d <= end)
    ]
    frames = []
    for d in wanted:
        df = read_daily_prices(d)
        if df is not None and len(df):
            frames.append(df)
    if not frames:
        return pd.DataFrame(columns=PRICE_COLUMNS)
    out = pd.concat(frames, ignore_index=True)
    out["date"] = pd.to_datetime(out["date"]).dt.date
    return out


def consolidate() -> Path:
    df = load_prices()
    if len(df):
        df = df.sort_values(["date", "symbol"]).reset_index(drop=True)
    atomic_write_parquet(paths.prices_all_file(), df)
    return paths.prices_all_file()


# --------------------------------------------------------------------------- history

def empty_history() -> pd.DataFrame:
    return pd.DataFrame({c: pd.Series(dtype="object") for c in HISTORY_COLUMNS})


def _normalise_history(df: pd.DataFrame) -> pd.DataFrame:
    for c in HISTORY_COLUMNS:
        if c not in df.columns:
            df[c] = None
    df = df[HISTORY_COLUMNS].copy()
    df["date"] = pd.to_datetime(df["date"]).dt.date
    for c in df.columns:
        # parquet round-trips strings as pd.NA-backed; match what read_csv returns
        if isinstance(df[c].dtype, pd.StringDtype) and df[c].dtype.na_value is pd.NA:
            df[c] = df[c].astype(pd.StringDtype(na_value=float("nan")))
    return df


def read_history() -> pd.DataFrame:
    """CSV is the primary copy; fall back to parquet if it is missing or corrupt (spec 9)."""
    csv = paths.history_csv()
    if csv.exists():
        try:
            df = pd.read_csv(csv, dtype={"universe_version": str})
            if "date" in df.columns and "bucket" in df.columns:
                return _normalise_history(df)
            raise ValueError("missing date/bucket columns")
        except Exception as e:  # noqa: BLE001 - any parse problem means fall back
            log.warning("breadth_history.csv unreadable (%s); falling back to parquet", e)
    pq = paths.history_parquet()
    if pq.exists():
        try:
            return _normalise_history(pd.read_parquet(pq))
        except Exception as e:  # noqa: BLE001
            log.warning("breadth_history.parquet unreadable (%s)", e)
    return empty_history()


def _sort_history(df: pd.DataFrame) -> pd.DataFrame:
    order = {b: i for i, b in enumerate(ALL_BUCKETS)}
    df = df.assign(_o=df["bucket"].map(order).fillna(99))
    return df.sort_values(["date", "_o"]).drop(columns="_o").reset_index(drop=True)


def write_history(df: pd.DataFrame) -> None:
    df = _sort_history(_normalise_history(df))
    atomic_write_csv(paths.history_csv(), df)
    pq = df.copy()
    for c in pq.columns:
        if pq[c].dtype == object and c != "date":
            # mixed None/str/float columns: let pyarrow infer cleanly
            if c.startswith(("state_", "rule_", "vol_regime", "data_", "universe_", "bucket")):
                pq[c] = pq[c].astype("string")
    atomic_write_parquet(paths.history_parquet(), pq)


def upsert_history(rows: pd.DataFrame) -> pd.DataFrame:
    """Replace any existing (date, bucket) rows with the new ones."""
    hist = read_history()
    rows = _normalise_history(rows.copy())
    if len(hist):
        keys = set(zip(rows["date"], rows["bucket"]))
        mask = [(d, b) not in keys for d, b in zip(hist["date"], hist["bucket"])]
        hist = hist[mask]
        merged = pd.concat([hist, rows], ignore_index=True) if len(hist) else rows
    else:
        merged = rows
    write_history(merged)
    return read_history()
