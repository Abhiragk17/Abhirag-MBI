"""Acceptance 1: universe cleaning and nanocap ranking."""
from datetime import date

import pandas as pd

from mbi import store, universe
from tests.conftest import weekdays


def test_seed_cleaning_counts():
    df = universe.load_seed()
    counts = df["bucket"].value_counts().to_dict()
    assert counts == {"LARGECAP": 100, "MIDCAP": 150, "SMALLCAP": 250, "MICROCAP": 250}
    assert not df["symbol"].str.startswith("DUMMY").any()
    assert not df["symbol"].duplicated().any()
    assert universe.count_issues(df) == []


def test_clean_index_csv_drops_dummy_and_duplicates():
    raw = pd.DataFrame({
        "Company Name": ["A Ltd", "Dummy", "A Ltd", "B Ltd"],
        "Industry": ["X", "X", "X", "Y"],
        "Symbol": ["AAA", "DUMMYXYZ1", "AAA", " bbb "],
        "Series": ["EQ"] * 4,
        "ISIN Code": ["INE1", "INE2", "INE1", "INE3"],
    })
    out = universe.clean_index_csv(raw, "MICROCAP")
    assert out["symbol"].tolist() == ["AAA", "BBB"]
    assert set(out.columns) >= {"bucket", "symbol", "company", "isin"}


def _nanocap_archive(n_candidates=300, n_days=210):
    sessions = weekdays(date(2025, 1, 1), n_days)
    syms = [f"N{i:03d}" for i in range(n_candidates)]
    rows = []
    for t, d in enumerate(sessions):
        for k, s in enumerate(syms):
            if k == 5 and t < 150:   # short history -> fails liquidity filter
                continue
            value = 1e5 if k == 7 else 1e7  # illiquid -> fails
            rows.append({"date": d, "symbol": s, "close": 100.0 + k, "traded_value": value,
                         "series": "EQ", "isin": "INE" + str(k), "volume": 1000})
    # an ETF (INF isin) and an SME symbol must be ignored
    for d in sessions:
        rows.append({"date": d, "symbol": "NIFTYBEES", "close": 250.0, "traded_value": 1e9,
                     "series": "EQ", "isin": "INF204KB14I2", "volume": 1})
        rows.append({"date": d, "symbol": "SMEONE", "close": 250.0, "traded_value": 1e9,
                     "series": "SM", "isin": "INE999", "volume": 1})
    return pd.DataFrame(rows), syms


def test_nanocap_ranking_gives_250_and_total_1000():
    prices, syms = _nanocap_archive()
    top = universe.load_seed()
    cands, provisional = universe.nanocap_candidates(prices, set(top["symbol"]), min_days=200,
                                                     min_median_value=5e5)
    assert not provisional
    assert "N005" not in set(cands["symbol"])  # history < 200
    assert "N007" not in set(cands["symbol"])  # median value < 5 lakh
    assert "NIFTYBEES" not in set(cands["symbol"]) and "SMEONE" not in set(cands["symbol"])
    shares = {s: 1e7 * (1 + i % 50) for i, s in enumerate(syms)}
    nano = universe.rank_nanocap(cands, shares)
    assert len(nano) == 250
    mc = nano["mcap_cr"].tolist()
    assert mc == sorted(mc, reverse=True)
    full = pd.concat([top, nano], ignore_index=True)
    assert len(full) == 1000 and not full["symbol"].duplicated().any()


def test_version_in_force_and_diff(data_env):
    a = universe.load_seed()
    universe.save_version(a.assign(source="t"), date(2026, 1, 1))
    b = a.copy()
    b.loc[b["symbol"] == a[a["bucket"] == "MIDCAP"]["symbol"].iloc[0], "bucket"] = "LARGECAP"
    b = b[b["symbol"] != a[a["bucket"] == "MICROCAP"]["symbol"].iloc[0]]
    universe.save_version(b.assign(source="t"), date(2026, 7, 1))
    assert universe.version_for(date(2025, 5, 1)) == date(2026, 1, 1)  # earliest for older dates
    assert universe.version_for(date(2026, 6, 30)) == date(2026, 1, 1)
    assert universe.version_for(date(2026, 7, 1)) == date(2026, 7, 1)
    d = universe.diff(universe.load_version(date(2026, 1, 1)), universe.load_version(date(2026, 7, 1)))
    assert len(d["promoted"]) == 1 and len(d["removed"]) == 1


def test_refresh_due_without_versions(data_env):
    assert universe.refresh_due(date(2026, 10, 10)) is True


def test_refresh_due_with_versions(data_env):
    universe.save_version(universe.load_seed().assign(source="t"), date(2026, 7, 5))
    assert universe.refresh_due(date(2026, 10, 10)) is False
    assert universe.refresh_due(date(2027, 1, 2)) is True
