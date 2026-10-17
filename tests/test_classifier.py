"""Acceptance 11, 12: decision table, overrides, boundaries, smoothing."""
import pytest

from mbi.classifier import DEFAULT_CONFIG as C, classify, smooth, vol_regime

# (vr, p, dp, expected_state, expected_rule_prefix)
CASES = [
    # overrides
    (0.1, 85, 0, "EU", "override:euphoria"),
    (5.0, 85, 0, "EU", "override:euphoria"),
    (None, 95, 0, "EU", "override:euphoria"),
    (2.3, 25, 0, "PA", "override:panic"),
    (2.0, 29.99, 0, "PA", "override:panic"),
    (2.0, 30, 0, "BR", "table:Lxhigh"),          # p_max is exclusive
    # VH row
    (0.3, 80, 0, "EU", "override:euphoria"),
    # H row
    (0.3, 70, 0, "LD", "table:Hxlow"),
    (0.6, 70, 0, "BD", "table:Hxmid"),
    (1.5, 70, 0, "BD", "table:Hxhigh"),
    # M row
    (0.3, 50, 1, "LD", "table:Mxlow"),
    (0.6, 50, 5, "LD", "table:Mxmid"),           # VR < 0.7
    (0.75, 50, -1, "LD", "table:Mxmid"),         # P not rising
    (0.75, 50, 0, "LD", "table:Mxmid"),          # dP = 0 is not rising
    (0.75, 50, 2, "BD", "table:Mxmid:alt"),
    (1.2, 50, -3, "BD", "table:Mxhigh"),
    # L row
    (0.3, 30, 0, "LS", "table:Lxlow"),           # dP >= 0
    (0.3, 30, -2, "BR", "table:Lxlow:alt"),      # dP < 0
    (0.7, 30, 0, "BR", "table:Lxmid"),
    (1.5, 30, 0, "BR", "table:Lxhigh"),
    # VL row
    (0.3, 10, -5, "LS", "table:VLxlow"),
    (0.7, 10, 0, "BR", "table:VLxmid"),
    (1.5, 10, 0, "PA", "table:VLxhigh"),
    # VR null is treated as high
    (None, 70, 0, "BD", "table:Hxhigh"),
    (None, 50, 0, "BD", "table:Mxhigh"),
    (None, 10, 0, "PA", "table:VLxhigh"),
]


@pytest.mark.parametrize("vr,p,dp,state,rule", CASES)
def test_table(vr, p, dp, state, rule):
    s, r = classify(vr, p, dp, C)
    assert (s, r) == (state, rule)


@pytest.mark.parametrize("p,zone_state", [(20, "BR"), (40, "LD"), (60, "BD"), (80, "EU")])
def test_p_boundaries_fall_in_upper_zone(p, zone_state):
    # VR mid (0.6): VL->BR, L->BR, M->LD, H->BD, VH->EU
    assert classify(0.6, p, 0, C)[0] == zone_state
    assert classify(0.6, p - 0.01, 0, C)[0] == {20: "BR", 40: "BR", 60: "LD", 80: "BD"}[p]


def test_vr_boundaries_fall_in_upper_zone():
    assert classify(0.5, 70, 0, C) == ("BD", "table:Hxmid")
    assert classify(0.4999, 70, 0, C) == ("LD", "table:Hxlow")
    assert classify(1.0, 10, 0, C) == ("PA", "table:VLxhigh")
    assert classify(0.9999, 10, 0, C) == ("BR", "table:VLxmid")


def test_missing_p_and_missing_dp():
    assert classify(1.0, None, 0, C) == (None, "no_data")
    assert classify(0.3, 30, None, C)[0] == "LS"   # missing dP -> 0 -> dP >= 0
    assert classify(0.75, 50, None, C)[0] == "LD"  # missing dP -> not rising


def test_trend_disabled():
    cfg = {**C, "trend": {"enabled": False, "dp_window": 5, "missing_dp": 0.0}}
    assert classify(0.3, 30, -10, cfg)[0] == "LS"


def test_vol_regimes():
    assert vol_regime(0.1) == "extreme_low"
    assert vol_regime(0.25) == "choppy"
    assert vol_regime(0.6) == "improving"
    assert vol_regime(0.8) == "building"
    assert vol_regime(1.0) == "high_demand"
    assert vol_regime(2.5) == "extreme"
    assert vol_regime(None) == "no_low_volume"


def test_smoothing_one_day_blip():
    raw = ["BD", "BD", "LD", "BD", "BD"]
    conf, days = smooth(raw, 2)
    assert conf == ["BD"] * 5
    assert days == [1, 2, 3, 4, 5]
    conf1, _ = smooth(raw, 1)
    assert conf1 == raw


def test_smoothing_confirms_after_two_days():
    conf, days = smooth(["BD", "LD", "LD", "LD"], 2)
    assert conf == ["BD", "BD", "LD", "LD"]
    assert days == [1, 2, 1, 2]


def test_smoothing_with_gaps():
    conf, days = smooth([None, "BD", None, "BD"], 2)
    assert conf == [None, "BD", "BD", "BD"]
