"""Acceptance 6 and 8: archive written by daily, fallbacks and their data_status values."""
from datetime import date, datetime

import pandas as pd
import pytest

from mbi import cli, ingest, paths, pipeline, store, universe
from mbi.nse_client import NSEError, NSENotFound
from mbi.status import StatusStore
from tests.conftest import make_universe, udiff_zip, weekdays, write_prices

IST = ingest.IST


class ScriptedClient:
    """Stands in for NSEClient: maps URL substrings to bytes / exceptions."""

    def __init__(self, routes=None, default=None):
        self.routes = routes or {}
        self.default = default
        self.events = []
        self.calls = []

    def events_since(self, mark):
        return self.events[mark:]

    def get(self, url, *, params=None, kind="json"):
        self.calls.append((url, params))
        for key, val in self.routes.items():
            if key in url:
                if isinstance(val, Exception):
                    raise val
                if callable(val):
                    return val(url, params)
                return val
        if self.default is not None:
            if isinstance(self.default, Exception):
                raise self.default
            return self.default
        raise NSENotFound(url)


def _day_rows(syms, close=100.0, vol=1e5):
    return [{"symbol": s, "close": close, "volume": vol} for s in syms]


def _cal(trading=True):
    return ingest.TradingCalendar(set(), "nse", set(), set(), {2024, 2025, 2026} if trading else set())


AFTER_CLOSE = datetime(2026, 12, 31, 22, 0, tzinfo=IST)


def test_bhavcopy_parse_filters_etf_and_series(data_env):
    d = date(2026, 10, 9)
    rows = _day_rows(["AAA", "BBB"]) + [
        {"symbol": "NIFTYBEES", "close": 250, "volume": 1, "isin": "INF204KB14I2"},
        {"symbol": "SMEX", "close": 50, "volume": 1, "series": "SM"},
        {"symbol": "AAA", "close": 100, "volume": 5, "series": "BE"},
        {"symbol": "EMBASSY", "close": 400, "volume": 9, "series": "RR"},  # REIT in the Nifty lists
    ]
    df = ingest.parse_udiff(udiff_zip(d, rows), d)
    assert sorted(df["symbol"]) == ["AAA", "BBB", "EMBASSY"]
    assert df.loc[df["symbol"] == "AAA", "series"].iloc[0] == "EQ"
    assert list(df.columns) == store.PRICE_COLUMNS


def test_ingest_writes_raw_archive_and_six_rows(data_env):
    uni = make_universe(4)
    syms = list(uni["symbol"])
    sessions = weekdays(date(2024, 1, 1), 79)
    write_prices(sessions, syms)
    d = weekdays(sessions[-1], 2)[1]
    client = ScriptedClient({"BhavCopy_NSE_CM": udiff_zip(d, _day_rows(syms, close=123.45, vol=1e5))})
    st = StatusStore()
    r = ingest.ingest_date(client, d, _cal(), st, now=AFTER_CLOSE)
    assert r.outcome == "ok"
    raw = pd.read_parquet(paths.prices_daily_file(d))
    assert len(raw) == len(syms) and (raw["close"] == 123.45).all() and (raw["source"] == "nse_bhavcopy").all()
    assert set(raw["bucket"]) == set(store.BUCKETS)
    pipeline.run_compute(d, d, st)
    h = store.read_history()
    assert len(h[h["date"] == d]) == 6
    # re-running the same date: archive is not overwritten, history not duplicated
    r2 = ingest.ingest_date(client, d, _cal(), st, now=AFTER_CLOSE)
    assert r2.outcome == "skipped"
    pipeline.run_compute(d, d, st)
    assert len(store.read_history()) == 6
    with pytest.raises(FileExistsError):
        store.write_daily_prices(d, raw)


def test_404_on_holiday_is_no_session(data_env):
    make_universe(2)
    d = date(2026, 10, 2)
    cal = ingest.TradingCalendar({d}, "nse", set(), set(), {2026})
    st = StatusStore()
    r = ingest.ingest_date(ScriptedClient(), d, cal, st, now=AFTER_CLOSE)
    assert r.outcome == "no_session"
    assert st.day(d) is None and not paths.prices_daily_file(d).exists()


def test_404_with_unknown_calendar_is_no_session(data_env):
    make_universe(2)
    d = date(2019, 10, 2)
    r = ingest.ingest_date(ScriptedClient(), d, _cal(trading=False), StatusStore(), now=AFTER_CLOSE)
    assert r.outcome == "no_session"


def test_missing_bhavcopy_falls_back_to_api_then_yfinance(data_env, monkeypatch):
    uni = make_universe(2)
    syms = list(uni["symbol"])
    d = date(2026, 10, 9)

    def api(url, params):
        if params["symbol"] == syms[0]:
            raise NSEError("boom")
        return {"data": [{"CH_SERIES": "EQ", "CH_OPENING_PRICE": 10, "CH_TRADE_HIGH_PRICE": 11,
                          "CH_TRADE_LOW_PRICE": 9, "CH_CLOSING_PRICE": 10.5, "CH_PREVIOUS_CLS_PRICE": 10,
                          "CH_TOT_TRADED_QTY": 1000, "CH_TOT_TRADED_VAL": 10500, "CH_TOTAL_TRADES": 5,
                          "CH_ISIN": "INE123"}]}

    client = ScriptedClient({"historical/cm/equity": api})
    yf_calls = []

    def fake_yf(day, symbols):
        yf_calls.append(list(symbols))
        df = pd.DataFrame([{"symbol": s, "series": "EQ", "isin": "INE", "open": 1, "high": 1, "low": 1,
                            "close": 1, "prev_close": 1, "volume": 1, "traded_value": 1, "trades": None}
                           for s in symbols])
        return ingest._finish(df, day, "yfinance"), []

    monkeypatch.setattr(ingest, "fetch_from_yfinance", fake_yf)
    st = StatusStore()
    r = ingest.ingest_date(client, d, _cal(), st, now=AFTER_CLOSE)
    assert yf_calls == [[syms[0]]]
    assert r.outcome == "fallback"  # yfinance covered the one symbol the API missed
    day = st.day(d)
    assert day["status"] == "fallback" and day["source"] == "nse_api"
    assert any("fallback source" in n for n in day["notes"])
    raw = pd.read_parquet(paths.prices_daily_file(d))
    assert set(raw["source"]) == {"nse_api", "yfinance"}


def test_fallback_partial_when_symbols_remain_missing(data_env, monkeypatch):
    make_universe(2)
    d = date(2026, 10, 9)
    client = ScriptedClient({"historical/cm/equity": {"data": []}})
    monkeypatch.setattr(ingest, "fetch_from_yfinance",
                        lambda day, s: (ingest._finish(pd.DataFrame([{"symbol": s[0], "series": "EQ", "isin": "INE",
                                        "open": 1, "high": 1, "low": 1, "close": 1, "prev_close": 1, "volume": 1,
                                        "traded_value": 1, "trades": None}]), day, "yfinance"), s[1:]))
    st = StatusStore()
    r = ingest.ingest_date(client, d, _cal(), st, now=AFTER_CLOSE)
    assert r.outcome == "partial"
    assert st.day(d)["status"] == "partial" and len(st.day(d)["missing_symbols"]) == 9
    # the next run retries and upgrades the day once the bhavcopy appears; old file is kept
    syms = list(universe.load_version(universe.list_versions()[-1])["symbol"])
    client2 = ScriptedClient({"BhavCopy_NSE_CM": udiff_zip(d, _day_rows(syms))})
    r2 = ingest.ingest_date(client2, d, _cal(), st, now=AFTER_CLOSE)
    assert r2.outcome == "ok" and st.day(d)["status"] == "ok"
    assert list(paths.prices_daily_file(d).parent.glob("*.superseded-*.parquet"))


def test_recovered_status_after_403(data_env):
    uni = make_universe(2)
    d = date(2026, 10, 9)

    class Recovering(ScriptedClient):
        def get(self, url, *, params=None, kind="json"):
            self.events.append({"kind": "retry", "detail": "HTTP 403", "url": url})
            self.events.append({"kind": "recovered", "detail": "after 1 failed attempt(s)", "url": url})
            return udiff_zip(d, _day_rows(list(uni["symbol"])))

    st = StatusStore()
    r = ingest.ingest_date(Recovering(), d, _cal(), st, now=AFTER_CLOSE)
    assert r.outcome == "recovered" and st.day(d)["status"] == "recovered"
    assert st.day(d)["recovered_events"]


def test_network_down_marks_failed_and_offline(data_env):
    make_universe(2)
    st = StatusStore()
    client = ScriptedClient(default=NSEError("no route", network_down=True))
    d = date(2026, 10, 9)
    res = pipeline.daily(st, target=d, client=client)
    assert res["network_down"]
    assert st.data["offline"] is True
    failed = [e for e in st.data["days"].values() if e["status"] == "failed"]
    assert len(failed) == 1 and failed[0]["stale"] is True  # stops at the first unreachable day


def test_today_not_published_yet_is_pending(data_env):
    make_universe(2)
    d = date(2026, 10, 9)
    early = datetime(2026, 10, 9, 19, 0, tzinfo=IST)
    r = ingest.ingest_date(ScriptedClient(), d, _cal(), StatusStore(), now=early)
    assert r.outcome == "pending"


def test_universe_falls_back_to_seed_when_download_fails(data_env):
    st = StatusStore()
    client = ScriptedClient(default=NSEError("403"))
    v = universe.build_or_refresh(client, st, today=date(2026, 10, 10))
    df = universe.load_version(v)
    assert df["bucket"].value_counts().to_dict() == {"LARGECAP": 100, "MIDCAP": 150, "SMALLCAP": 250, "MICROCAP": 250}
    u = st.data["universe"]
    assert u["source"].startswith("seed") and u["nanocap_stale"] is True


def test_holiday_calendar_failure_uses_cache_then_weekday_assumption(data_env):
    st = StatusStore()
    cal = ingest.load_calendar(ScriptedClient(default=NSEError("403")), st)
    assert cal.source == "weekday_assumption" and st.data["calendar"]["source"] == "weekday_assumption"
    store.atomic_write_json(paths.holidays_cache(), {"2026": ["2026-10-02"]})
    cal = ingest.load_calendar(ScriptedClient(default=NSEError("403")), st)
    assert cal.source == "cache" and date(2026, 10, 2) in cal.holidays


def test_crash_is_recorded_and_data_kept(data_env, monkeypatch):
    make_universe(2)
    sessions = weekdays(date(2024, 1, 1), 60)
    write_prices(sessions, [f"{b[:3]}{i}" for b in store.BUCKETS for i in range(2)])
    pipeline.run_compute(sessions[0], sessions[-1], StatusStore())
    before = paths.history_csv().read_bytes()

    def explode(*a, **k):
        raise RuntimeError("simulated crash")
    monkeypatch.setattr(pipeline, "compute_range", explode)
    rc = cli.main(["recompute"])
    assert rc == 1
    st = StatusStore()
    assert st.data["last_run"]["ok"] is False
    assert "simulated crash" in st.data["last_run"]["error"]
    assert st.data["last_run"]["traceback"]
    assert paths.history_csv().read_bytes() == before


def test_corrupt_history_csv_falls_back_to_parquet(data_env):
    make_universe(2)
    sessions = weekdays(date(2024, 1, 1), 60)
    write_prices(sessions, [f"{b[:3]}{i}" for b in store.BUCKETS for i in range(2)])
    pipeline.run_compute(sessions[-3], sessions[-1], StatusStore())
    good = store.read_history()
    paths.history_csv().write_bytes(b"\x00\x01garbage")
    pd.testing.assert_frame_equal(store.read_history(), good)
