"""Technical screener: indicator maths, conventions and field registry."""
import numpy as np
import pandas as pd

from mbi import screener as sc


def frame(cols: dict[str, list[float]]) -> pd.DataFrame:
    n = len(next(iter(cols.values())))
    return pd.DataFrame(cols, index=pd.bdate_range("2025-01-01", periods=n))


def test_registry_unique_and_complete():
    keys = [f["key"] for f in sc.FIELDS]
    assert len(keys) == len(set(keys))
    assert all(f["label"] and f["desc"] and f["group"] for f in sc.FIELDS)
    assert sc.COLUMNS[:3] == ["symbol", "bucket", "group"]


def test_rsi_all_up_is_100_and_all_down_is_0():
    up = frame({"A": list(np.arange(1, 60, dtype=float))})
    dn = frame({"A": list(np.arange(60, 1, -1, dtype=float))})
    assert sc.rsi(up, 14).iloc[-1, 0] == 100.0
    assert sc.rsi(dn, 14).iloc[-1, 0] < 1e-9


def test_bars_since_counts_latest_bar_as_one():
    ev = frame({"A": [0] * 10, "B": [0] * 10, "C": [0] * 10}).astype(bool)
    ev.iloc[-1, 0] = True       # today
    ev.iloc[-4, 1] = True       # three bars before the latest
    out = sc.bars_since(ev)
    assert out["A"] == 1 and out["B"] == 4 and np.isnan(out["C"])


def test_cross_up_detects_single_crossover():
    a = frame({"X": [1, 2, 3, 4, 5, 6]}).astype(float)
    b = frame({"X": [3.5] * 6})
    assert sc.cross_up(a, b)["X"].tolist() == [False, False, False, True, False, False]
    assert sc.bars_since(sc.cross_up(a, b))["X"] == 3


def test_vstop_flips_down_on_a_reversal_and_reports_it():
    price = np.concatenate([np.linspace(100, 160, 40), np.linspace(160, 110, 25)])
    c = frame({"A": list(price)})
    atr = frame({"A": [3.0] * len(price)})
    lvl, up, since = sc.vstop(c, atr, 2.0)
    assert up["A"] == 0.0                       # ended in a downtrend
    assert 1 <= since["A"] <= 25                # flipped during the decline
    c2 = frame({"A": list(np.linspace(100, 160, 60))})
    _, up2, since2 = sc.vstop(c2, frame({"A": [3.0] * 60}), 2.0)
    assert up2["A"] == 1.0 and np.isnan(since2["A"])   # steady rise: uptrend, never flipped


def test_tail_stats_distance_and_days_since():
    h = frame({"A": [10, 12, 15, 11, 11, 12, 13, 12, 11, 12, 11, 12, 11, 12, 11, 12, 11, 12, 11, 12, 11, 12, 11, 12, 11]})
    l = h - 1
    hi, lo, hd, ld = sc._tail_stats(h, l, 25)
    assert hi["A"] == 15 and hd["A"] == 22 and lo["A"] == 9 and ld["A"] == 24
    # a window longer than the history (3Y on a short archive) stays empty rather than misleading
    hi3, *_ = sc._tail_stats(h, l, 756)
    assert np.isnan(hi3["A"])


def _universe(n=320):
    rng = np.random.default_rng(5)
    idx = pd.bdate_range("2025-01-01", periods=n)
    syms = ["UP", "DOWN", "FLAT", "BIG"]
    drift = {"UP": 0.004, "DOWN": -0.003, "FLAT": 0.0, "BIG": 0.001}
    c = pd.DataFrame({s: 100 * np.cumprod(1 + drift[s] + rng.normal(0, 0.01, n)) for s in syms}, index=idx)
    o, h, l = c.shift(1).fillna(c), c * 1.01, c * 0.99
    v = pd.DataFrame(rng.integers(100_000, 200_000, (n, len(syms))).astype(float), index=idx, columns=syms)
    bucket = pd.Series({"UP": "SMALLCAP", "DOWN": "SMALLCAP", "FLAT": "MIDCAP", "BIG": "LARGECAP"})
    group = pd.Series({"UP": "G1", "DOWN": "G1", "FLAT": "G2", "BIG": "G2"})
    return o, h, l, c, v, bucket, group, pd.Series(True, index=syms)


def test_compute_fills_every_registered_field_and_matches_manual_values():
    o, h, l, c, v, bucket, group, valid = _universe()
    df, bench = sc.compute(o, h, l, c, v, bucket, group, valid)
    assert list(df.columns) == [f["key"] for f in sc.FIELDS]
    # manual cross-checks
    assert np.isclose(df.loc["UP", "sma_50d"], c["UP"].tail(50).mean())
    assert np.isclose(df.loc["UP", "high_52w"], h["UP"].tail(252).max())
    assert np.isclose(df.loc["UP", "high_52w_dist"], (h["UP"].tail(252).max() - c["UP"].iloc[-1]) / h["UP"].tail(252).max() * 100)
    assert np.isclose(df.loc["UP", "ret_1m"], (c["UP"].iloc[-1] / c["UP"].iloc[-22] - 1) * 100)
    # direction and ranking make sense
    assert df.loc["UP", "rs_rating"] > df.loc["DOWN", "rs_rating"]
    assert df.loc["UP", "ret_6m"] > df.loc["DOWN", "ret_6m"]
    # industry alpha is relative to the group's own average, so the pair sums to ~0
    assert np.isclose(df.loc["UP", "alpha_ind_3m"] + df.loc["DOWN", "alpha_ind_3m"], 0, atol=1e-6)
    # long-history fields stay empty rather than inventing data
    assert df["high_5y"].isna().all()
    assert bench["lc"]["members"] == 1 and bench["mkt"]["members"] == 4


def test_flags_are_binary_and_streak_sign_follows_direction():
    o, h, l, c, v, bucket, group, valid = _universe()
    df, _ = sc.compute(o, h, l, c, v, bucket, group, valid)
    for f in sc.FIELDS:
        if f["kind"] == "flag":
            assert set(df[f["key"]].dropna().unique()) <= {0.0, 1.0}, f["key"]
    for s in c.columns:
        last = np.sign(c[s].iloc[-1] - c[s].iloc[-2])
        assert np.sign(df.loc[s, "streak"]) == last


def test_ma_alignment_flags_on_clean_trends():
    n = 260
    idx = pd.bdate_range("2025-01-01", periods=n)
    c = pd.DataFrame({"UP": np.linspace(50, 200, n), "DOWN": np.linspace(200, 50, n)}, index=idx)
    ones = pd.DataFrame(1000.0, index=idx, columns=c.columns)
    df, _ = sc.compute(c, c * 1.002, c * 0.998, c, ones, pd.Series("MIDCAP", index=c.columns),
                       pd.Series("G", index=c.columns), pd.Series(True, index=c.columns))
    assert df.loc["UP", "ma_stack_bull"] == 1 and df.loc["UP", "ma_stack_bear"] == 0
    assert df.loc["DOWN", "ma_stack_bear"] == 1 and df.loc["DOWN", "ma_stack_bull"] == 0
    assert df.loc["UP", "above_sma200"] == 1 and df.loc["DOWN", "above_sma200"] == 0
    assert df.loc["UP", "minervini_score"] == 8 and df.loc["DOWN", "minervini_score"] <= 1


def test_unadjusted_price_jump_is_flagged():
    n = 120
    idx = pd.bdate_range("2025-01-01", periods=n)
    base = np.linspace(100, 110, n)
    jumpy = base.copy()
    jumpy[80:] = jumpy[80:] * 9                      # a 9x step with no split entry
    c = pd.DataFrame({"OK": base, "JUMPY": jumpy}, index=idx)
    ones = pd.DataFrame(1000.0, index=idx, columns=c.columns)
    df, _ = sc.compute(c, c * 1.002, c * 0.998, c, ones, pd.Series("MIDCAP", index=c.columns),
                       pd.Series("G", index=c.columns), pd.Series(True, index=c.columns))
    assert df.loc["JUMPY", "jump_1y"] == 1 and df.loc["OK", "jump_1y"] == 0
