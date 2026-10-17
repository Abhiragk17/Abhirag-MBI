"""Acceptance 2: split adjustment with the seed list."""
from datetime import date

import numpy as np
import pandas as pd

from mbi import adjust, paths, store
from tests.conftest import weekdays


def seed_splits():
    valid, issues = adjust.validate_splits(adjust.seed_from_csv())
    assert issues == []
    return valid


def kotak_frame():
    sessions = weekdays(date(2025, 12, 15), 40)
    ex = date(2026, 1, 13)
    rows = []
    for d in sessions:
        pre = d < ex
        rows.append({"date": d, "symbol": "KOTAKBANK",
                     "open": 2000.0 if pre else 400.0, "high": 2010.0 if pre else 402.0,
                     "low": 1990.0 if pre else 398.0, "close": 2000.0 if pre else 400.0,
                     "volume": 1_000_000 if pre else 5_000_000})
        rows.append({"date": d, "symbol": "OTHER", "open": 50.0, "high": 50.0, "low": 50.0, "close": 50.0,
                     "volume": 10})
    return pd.DataFrame(rows), ex


def test_seed_has_seven_splits():
    s = seed_splits()
    assert len(s) == 7
    k = next(x for x in s if x["symbol"] == "KOTAKBANK")
    assert k["factor"] == 5.0 and k["ex_date"] == "2026-01-13"


def test_kotak_adjusted_close_is_continuous():
    df, ex = kotak_frame()
    original = df.copy(deep=True)
    out = adjust.adjust_ohlcv(df, seed_splits())
    k = out[out["symbol"] == "KOTAKBANK"].sort_values("date")
    assert np.allclose(k["adj_close"], 400.0)
    assert np.allclose(k["adj_volume"], 5_000_000)
    assert (k.loc[k["date"] < ex, "adj_factor"] == 5.0).all()
    assert (k.loc[k["date"] >= ex, "adj_factor"] == 1.0).all()
    # raw columns unchanged and the input frame untouched
    pd.testing.assert_frame_equal(df, original)
    pd.testing.assert_frame_equal(out[original.columns], original)
    o = out[out["symbol"] == "OTHER"]
    assert (o["adj_factor"] == 1.0).all()


def test_cumulative_factors_and_bonus():
    df = pd.DataFrame({"date": [date(2026, 1, 1), date(2026, 3, 1), date(2026, 6, 1)], "symbol": "X",
                       "open": 1.0, "high": 1.0, "low": 1.0, "close": [100.0, 50.0, 25.0], "volume": 1.0})
    splits, issues = adjust.validate_splits([
        {"symbol": "X", "ex_date": "2026-02-01", "old_fv": 10, "new_fv": 5, "type": "split"},
        {"symbol": "X", "ex_date": "2026-05-01", "type": "bonus", "bonus_x": 1, "bonus_y": 1},
    ])
    assert issues == []
    out = adjust.adjust_ohlcv(df, splits)
    assert out["adj_factor"].tolist() == [4.0, 2.0, 1.0]
    assert out["adj_close"].tolist() == [25.0, 25.0, 25.0]


def test_validation_rejects_bad_rows():
    rows = [
        {"symbol": "A", "ex_date": "2026-01-01", "factor": 2},
        {"symbol": "A", "ex_date": "2026-01-01", "factor": 2},      # duplicate
        {"symbol": "B", "ex_date": "2026-13-01", "factor": 2},      # bad date
        {"symbol": "C", "ex_date": "2026-01-01", "factor": 0},      # factor <= 0
        {"symbol": "D", "ex_date": "2026-01-01", "factor": 2},      # not in archive
    ]
    valid, issues = adjust.validate_splits(rows, archive_symbols={"A", "B", "C"})
    assert [v["symbol"] for v in valid] == ["A"]
    assert len(issues) == 4


def test_archive_file_unchanged_by_adjustment(data_env):
    df, _ = kotak_frame()
    d = df["date"].iloc[0]
    day = df[df["date"] == d].assign(bucket=None, prev_close=None, traded_value=None, trades=None,
                                    source="nse_bhavcopy", series="EQ", isin="INE")
    store.write_daily_prices(d, day)
    before = paths.prices_daily_file(d).read_bytes()
    adjust.adjust_ohlcv(store.load_prices(), seed_splits())
    assert paths.prices_daily_file(d).read_bytes() == before
