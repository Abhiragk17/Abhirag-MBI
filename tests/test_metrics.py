"""Acceptance 3, 5, 6, 7, 14: EMA, volume-ratio edge cases, archive, recompute."""
from datetime import date

import numpy as np
import pandas as pd
import pytest

from mbi import paths, pipeline, store
from mbi.classifier import load_config
from mbi.metrics import compute_range, ema_last
from mbi.status import StatusStore
from tests.conftest import make_universe, weekdays, write_prices


def pine_ema(values, span):
    """Independent reference: Pine ta.ema (seeded with the first value), NaNs skipped."""
    a = 2 / (span + 1)
    e = None
    for v in values:
        if np.isnan(v):
            continue
        e = v if e is None else a * v + (1 - a) * e
    return np.nan if e is None else e


@pytest.mark.parametrize("span", [10, 20, 50])
def test_ema_matches_reference(span):
    rng = np.random.default_rng(span)
    X = np.cumsum(rng.normal(0, 1, (320, 5)), axis=0) + 100
    X[rng.random((320, 5)) < 0.05] = np.nan
    X[:40, 2] = np.nan  # late listing
    got = ema_last(X, span)
    for j in range(5):
        ref = pine_ema(X[:, j], span)
        assert abs(got[j] - ref) / ref < 1e-9
        # also matches pandas ewm(adjust=False) on the symbol's own sessions
        pdv = pd.Series(X[:, j]).dropna().ewm(span=span, adjust=False).mean().iloc[-1]
        assert abs(got[j] - pdv) < 1e-9


def _setup(n_sessions=80, per_bucket=4, **kw):
    make_universe(per_bucket)
    sessions = weekdays(date(2024, 1, 1), n_sessions)
    syms = [f"{b[:3]}{i}" for b in store.BUCKETS for i in range(per_bucket)]
    write_prices(sessions, syms, **kw)
    return sessions, syms


def test_volume_ratio_counts_and_null(data_env):
    # last day: LAR* volumes x2 (high), others flat -> N_low = 0 everywhere -> VR null
    sessions, syms = _setup(vol_fn=lambda t, s: 2e5 if (t == 79 and s.startswith("LAR")) else 1e5)
    res = compute_range(sessions[-1], sessions[-1])
    r = res.rows.set_index("bucket")
    assert r.loc["LARGECAP", "n_high"] == 4 and r.loc["LARGECAP", "n_low"] == 0
    assert r.loc["LARGECAP", "vol_ratio"] is None
    assert r.loc["ALL", "n_high"] == 4 and r.loc["ALL", "n_valid"] == 20
    assert r.loc["MIDCAP", "n_high"] == 0


def test_volume_ratio_value_and_aggregate_from_counts(data_env):
    def vol(t, s):
        if t != 79:
            return 1e5
        return {"LAR0": 2e5, "LAR1": 2e5, "LAR2": 0.3e5, "MID0": 0.2e5}.get(s, 1e5)
    sessions, _ = _setup(vol_fn=vol)
    r = compute_range(sessions[-1], sessions[-1]).rows.set_index("bucket")
    assert r.loc["LARGECAP", "vol_ratio"] == 2.0
    assert r.loc["MIDCAP", "vol_ratio"] == 0.0
    assert r.loc["ALL", "n_high"] == 2 and r.loc["ALL", "n_low"] == 2
    assert r.loc["ALL", "vol_ratio"] == 1.0  # from counts, not an average of bucket ratios


def test_new_listing_under_50_days_is_excluded(data_env):
    sessions, _ = _setup(start_idx={"NAN0": 45})
    r = compute_range(sessions[-1], sessions[-1]).rows.set_index("bucket")
    assert r.loc["NANOCAP", "n_universe"] == 4
    assert r.loc["NANOCAP", "n_valid"] == 3
    assert r.loc["NANOCAP", "n_excluded"] == 1


def test_avgvol_excludes_today_by_default(data_env):
    sessions, _ = _setup(vol_fn=lambda t, s: 1e5 if t < 79 else 1.6e5)
    st = StatusStore()
    res = compute_range(sessions[-1], sessions[-1], status=st, detail_dates={sessions[-1]})
    det = res.details[sessions[-1]]
    assert np.allclose(det["avgvol20"], 1e5)
    assert np.allclose(det["rel_vol"], 1.6)
    res2 = compute_range(sessions[-1], sessions[-1], include_today_in_avg=True, detail_dates={sessions[-1]})
    assert np.allclose(res2.details[sessions[-1]]["avgvol20"], (19 * 1e5 + 1.6e5) / 20)


def test_holiday_has_no_row(data_env):
    sessions, _ = _setup()
    holiday = sessions[70]
    paths.prices_daily_file(holiday).unlink()  # a trading holiday: no bhavcopy, nothing archived
    res = compute_range(sessions[60], sessions[-1])
    assert holiday not in set(res.rows["date"])
    assert len(res.rows) == 6 * (len(sessions[60:]) - 1)
    # the 20-day average simply spans the sessions around the holiday
    assert (res.rows[res.rows["bucket"] == "ALL"]["n_valid"] == 20).all()


def test_suspected_unadjusted_event_is_excluded_and_flagged(data_env):
    sessions, syms = _setup(price_fn=lambda t, s: 100.0 if (s != "SMA1" or t < 79) else 50.0)
    st = StatusStore()
    st.set_day(sessions[-1], status="ok", source="nse_bhavcopy")
    r = compute_range(sessions[-1], sessions[-1], status=st).rows.set_index("bucket")
    assert r.loc["SMALLCAP", "n_valid"] == 3
    ev = st.day(sessions[-1])["suspected_events"]
    assert [e["symbol"] for e in ev] == ["SMA1"]
    # once the split is listed the same move is adjusted away and no longer flagged
    split = [{"symbol": "SMA1", "ex_date": sessions[-1].isoformat(), "factor": 2.0, "type": "split"}]
    st2 = StatusStore()
    st2.set_day(sessions[-1], status="ok", source="nse_bhavcopy")
    r2 = compute_range(sessions[-1], sessions[-1], status=st2, splits=split).rows.set_index("bucket")
    assert r2.loc["SMALLCAP", "n_valid"] == 4
    assert st2.day(sessions[-1])["suspected_events"] == []


def test_recompute_reproduces_history_offline(data_env, monkeypatch):
    sessions, _ = _setup(n_sessions=120)
    st = StatusStore()
    # "daily" style: one date at a time
    for d in sessions[60:]:
        pipeline.run_compute(d, d, st)
    first = store.read_history()
    paths.history_csv().unlink()
    paths.history_parquet().unlink()

    import requests
    def boom(*a, **k):
        raise AssertionError("network used during recompute")
    monkeypatch.setattr(requests.Session, "get", boom)
    pipeline.recompute(st, sessions[60], sessions[-1])
    second = store.read_history()
    pd.testing.assert_frame_equal(first.reset_index(drop=True), second.reset_index(drop=True))


def test_rerunning_a_date_does_not_duplicate_rows(data_env):
    sessions, _ = _setup()
    st = StatusStore()
    pipeline.run_compute(sessions[-1], sessions[-1], st)
    pipeline.run_compute(sessions[-1], sessions[-1], st)
    h = store.read_history()
    assert len(h) == 6
    assert not h.duplicated(["date", "bucket"]).any()


def test_config_change_only_changes_state_columns(data_env):
    sessions, _ = _setup(n_sessions=120)
    st = StatusStore()
    pipeline.run_compute(sessions[0], sessions[-1], st)
    before = store.read_history()
    archive_before = {p: p.read_bytes() for p in paths.prices_daily_dir().rglob("*.parquet")}
    cfg = load_config()
    cfg["p_zones"] = {"L": 5.0, "M": 10.0, "H": 15.0, "VH": 99.0}
    cfg["overrides"]["euphoria"]["p_min"] = 99.0
    store.atomic_write_json(paths.regime_config(), cfg)
    pipeline.recompute(st, None, None)
    after = store.read_history()
    state_cols = [c for c in store.STATE_COLUMNS if not c.startswith("dp_")]
    other = [c for c in store.HISTORY_COLUMNS if c not in store.STATE_COLUMNS]
    pd.testing.assert_frame_equal(before[other], after[other])
    assert not before[state_cols].equals(after[state_cols])
    assert archive_before == {p: p.read_bytes() for p in paths.prices_daily_dir().rglob("*.parquet")}
