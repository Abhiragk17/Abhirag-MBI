"""Filesystem layout (spec section 5.2). Everything is resolved lazily so tests can
point MBI_DATA_DIR at a temporary directory."""
from __future__ import annotations

import os
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def data_dir() -> Path:
    return Path(os.environ.get("MBI_DATA_DIR", ROOT / "data"))


def prices_daily_dir() -> Path:
    return data_dir() / "prices" / "daily"


def prices_daily_file(d: date) -> Path:
    return prices_daily_dir() / f"{d.year:04d}" / f"{d.isoformat()}.parquet"


def prices_all_file() -> Path:
    return data_dir() / "prices" / "prices_all.parquet"


def breadth_dir() -> Path:
    return data_dir() / "breadth"


def history_csv() -> Path:
    return breadth_dir() / "breadth_history.csv"


def history_parquet() -> Path:
    return breadth_dir() / "breadth_history.parquet"


def latest_json() -> Path:
    return breadth_dir() / "breadth_latest.json"


def day_detail_file(d: date) -> Path:
    return breadth_dir() / "days" / f"{d.year:04d}" / f"{d.isoformat()}.csv"


def meta_dir() -> Path:
    return data_dir() / "meta"


def universe_history_dir() -> Path:
    return meta_dir() / "universe_history"


def status_file() -> Path:
    return meta_dir() / "data_status.json"


def holidays_cache() -> Path:
    return meta_dir() / "holidays_cache.json"


def no_session_file() -> Path:
    return meta_dir() / "no_session_dates.json"


def shares_cache() -> Path:
    return meta_dir() / "shares_outstanding.csv"


def split_validation_file() -> Path:
    return meta_dir() / "split_validation.json"


def logs_dir() -> Path:
    return meta_dir() / "logs"


def config_dir() -> Path:
    return data_dir() / "config"


def splits_config() -> Path:
    return config_dir() / "split_adjustments.json"


def regime_config() -> Path:
    return config_dir() / "regime_config.json"


def calendar_config() -> Path:
    return config_dir() / "calendar.json"


def app_config() -> Path:
    return config_dir() / "app_config.json"


def seed_universe_file() -> Path:
    return ROOT / "universe_seed_750.csv"


def seed_splits_file() -> Path:
    return ROOT / "splits_seed.csv"
