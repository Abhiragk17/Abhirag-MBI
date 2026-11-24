"""Theme analytics: parser, symbol resolution, group index / RRG / score maths."""
import numpy as np
import pandas as pd

from mbi import themes
from tests.conftest import weekdays
from datetime import date

TEXT = ("###CABLES & WIRES,NSE:POLYCAB,NSE:KEI,###PUMPS, VALVES & COMPRESSORS,NSE:KSB,NSE:M_M,NSE:KEI,"
        "###EMPTY,###TRAILING,NSE:AAA,")


def test_parse_handles_commas_in_names_and_duplicates():
    g = themes.parse_themes(TEXT)
    assert list(g) == ["CABLES & WIRES", "PUMPS, VALVES & COMPRESSORS", "EMPTY", "TRAILING"]
    assert g["CABLES & WIRES"] == ["POLYCAB", "KEI"]
    assert g["PUMPS, VALVES & COMPRESSORS"] == ["KSB", "M_M"]   # KEI stays in the first group
    assert g["EMPTY"] == [] and g["TRAILING"] == ["AAA"]


def test_resolve_symbols_aliases():
    g = themes.parse_themes("###X,NSE:M_M,NSE:NAM_INDIA,NSE:CUSTOM,NSE:GONE")
    out, unmapped, used = themes.resolve_symbols(g, {"M&M", "NAM-INDIA", "REAL"}, {"CUSTOM": "REAL"})
    assert out["X"] == ["M&M", "NAM-INDIA", "REAL"]
    assert unmapped == ["GONE"]
    assert used == {"M_M": "M&M", "NAM_INDIA": "NAM-INDIA", "CUSTOM": "REAL"}


def test_slugify_unique():
    taken = set()
    assert themes.slugify("PUMPS, VALVES & COMPRESSORS", taken) == "pumps-valves-compressors"
    assert themes.slugify("Pumps Valves Compressors", taken) == "pumps-valves-compressors-2"


def _synthetic(n_days=200):
    sessions = weekdays(date(2025, 1, 1), n_days)
    rng = np.random.default_rng(3)
    groups = {"WIN": [f"W{i}" for i in range(5)], "LOSE": [f"L{i}" for i in range(5)], "FLAT": [f"F{i}" for i in range(5)]}
    drift = {"WIN": 0.003, "LOSE": -0.002, "FLAT": 0.0}
    cols = [s for v in groups.values() for s in v]
    px = {}
    for g, ss in groups.items():
        for s in ss:
            px[s] = 100 * np.exp(np.cumsum(rng.normal(drift[g], 0.008, n_days)))
    close = pd.DataFrame(px, index=sessions)[cols]
    vol = pd.DataFrame(1e6, index=sessions, columns=cols)
    tval = close * vol
    return close, vol, tval, groups


def test_analyze_ranks_winner_first_and_loser_last():
    close, vol, tval, groups = _synthetic()
    cfg = themes.DEFAULT_CONFIG
    res = themes.analyze(close, vol, tval, groups, cfg)
    rows = {g["name"]: g for g in res["groups"]}
    assert rows["WIN"]["rank"] == 1 and rows["LOSE"]["rank"] == 3
    assert rows["WIN"]["score"] > rows["FLAT"]["score"] > rows["LOSE"]["score"]
    assert rows["WIN"]["ret_3M"] > rows["LOSE"]["ret_3M"]
    assert rows["WIN"]["pct_ema50"] >= rows["LOSE"]["pct_ema50"]
    assert rows["WIN"]["quadrant"] in themes.QUADRANTS
    assert not rows["WIN"]["low_n"] and rows["WIN"]["n_eligible"] == 5


def test_analyze_equal_weight_index_matches_mean_return():
    close, vol, tval, groups = _synthetic(60)
    cfg = themes.DEFAULT_CONFIG
    res = themes.analyze(close, vol, tval, groups, cfg)
    det = res["details"]["win"]
    r = close[groups["WIN"]].pct_change().mean(axis=1)
    expected = 100 * (1 + r.iloc[cfg["min_history"]:]).prod() / (1 + 0)  # index starts when stocks become eligible
    # first eligible day is index cfg["min_history"]-1 (0-based) -> chain from there
    start = det["index"].index(next(v for v in det["index"] if v is not None))
    chained = 100 * (1 + r.iloc[start + 1:]).prod()
    assert abs(det["index"][-1] - chained) < 0.05
    assert expected > 0


def test_illiquid_and_new_stocks_are_excluded():
    close, vol, tval, groups = _synthetic(120)
    tval["L0"] = 1000.0                     # far below min_traded_value
    close.loc[close.index[:100], "F0"] = np.nan   # listed 20 sessions ago
    res = themes.analyze(close, vol, tval, groups, themes.DEFAULT_CONFIG)
    rows = {g["name"]: g for g in res["groups"]}
    assert rows["LOSE"]["n_eligible"] == 4
    st = {s["symbol"]: s for s in res["stocks"]}
    assert st["L0"]["liquid"] is False and st["F0"]["new"] is True
    top = [s["symbol"] for lab in res["top_stocks"]["gainers"].values() for s in lab]
    assert "L0" not in top and "F0" not in top


def test_jump_is_dropped_not_chained():
    close, vol, tval, groups = _synthetic(120)
    close.loc[close.index[80:], "W0"] *= 2.0          # unadjusted 2:1 style jump on day 80
    res = themes.analyze(close, vol, tval, groups, themes.DEFAULT_CONFIG)
    suspects = [s for s in res["stocks"] if s["symbol"] == "W0"]
    assert suspects  # still reported, but the group index did not absorb a +100% day
    idx = res["details"]["win"]["index"]
    steps = np.diff([v for v in idx if v is not None]) / np.array([v for v in idx if v is not None][:-1])
    assert steps.max() < 0.25


def test_cluster_order_groups_similar_items():
    c = np.array([[1, .9, 0, 0], [.9, 1, 0, .1], [0, 0, 1, .8], [0, .1, .8, 1]])
    order = themes._cluster_order(c)
    assert sorted(order) == [0, 1, 2, 3]
    pos = {v: i for i, v in enumerate(order)}
    assert abs(pos[0] - pos[1]) == 1 and abs(pos[2] - pos[3]) == 1


def test_regime_link_and_digest_present():
    close, vol, tval, groups = _synthetic()
    states = pd.Series(["BD" if i % 2 else "LD" for i in range(len(close))], index=close.index)
    res = themes.analyze(close, vol, tval, groups, themes.DEFAULT_CONFIG, states)
    assert set(res["regime"]["states"]) == {"BD", "LD"}
    assert res["digest"]["leaders"][0]["name"] == "WIN"
    assert res["watchlist"].startswith("###")
    assert res["corr"]["order"] and len(res["corr"]["matrix"]) == 3


def test_parse_accepts_one_group_per_line_and_missing_commas():
    g = themes.parse_themes("###A, B\nNSE:X,NSE:Y\n\n###C,\nNSE:Z\n")
    assert g == {"A, B": ["X", "Y"], "C": ["Z"]}


def test_sanitise_clamps_bad_values():
    cfg = themes._merge(themes.DEFAULT_CONFIG, {"winsor": 5, "min_history": "x", "weights": {"rs": 0, "breadth": 0, "momentum": 0, "volume": 0},
                                                 "rrg": {"ratio_window": 0}, "aliases": {" a ": " b "}})
    out = themes.sanitise(cfg)
    assert out["winsor"] == 0.9 and out["min_history"] == themes.DEFAULT_CONFIG["min_history"]
    assert out["weights"] == themes.DEFAULT_CONFIG["weights"] and out["rrg"]["ratio_window"] == 5
    assert out["aliases"] == {"A": "B"}
