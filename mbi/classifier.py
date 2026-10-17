"""Six-state market situation classifier + smoothing (spec section 7.4).

``classify(vr, p, dp, config) -> (state, rule_id)`` is pure. All thresholds live in
``data/config/regime_config.json``; editing it and running ``mbi recompute``
reclassifies the whole history without touching VR, P or the archive.
"""
from __future__ import annotations

import copy
import math
from typing import Any

import pandas as pd

from . import paths
from .store import atomic_write_json, read_json

EMA_SPANS = (10, 20, 50)

STATES: dict[str, dict[str, str]] = {
    "BD": {"name": "Bullish Domination", "meaning": "Stocks move upward easily",
           "focus": "Breakouts, gaps, strong-structure reversal setups"},
    "LD": {"name": "Lack of Demand", "meaning": "No strong demand; stocks fail to follow through",
           "focus": "Intraday breakouts, shorting gaps, reversals and pullbacks"},
    "EU": {"name": "Euphoria / Overheated Market", "meaning": "Highly extended market; breakouts may fail",
           "focus": "Parabolic shorts, gap-up shorts, playing the index trend"},
    "BR": {"name": "Bearish Domination", "meaning": "Majority of stocks are falling",
           "focus": "Short setups, stocks entering stage 4"},
    "LS": {"name": "Lack of Supply", "meaning": "Sellers pausing after a strong decline",
           "focus": "Resilient stocks that are not falling further; breakouts from strong structures"},
    "PA": {"name": "Panic / Overheated Decline", "meaning": "Oversold, bottoming situation",
           "focus": "Reversals; parabolic long setups in strong-structure or declining stocks"},
}

DEFAULT_CONFIG: dict[str, Any] = {
    "_comment": "Starting defaults (spec 7.4). Lower edges are inclusive: a value exactly on an edge falls in the upper zone.",
    "p_zones": {"L": 20.0, "M": 40.0, "H": 60.0, "VH": 80.0},
    "vr_zones": {"mid": 0.5, "high": 1.0, "extreme": 2.0},
    "table": {
        "VH": {"low": "EU", "mid": "EU", "high": "EU"},
        "H": {"low": "LD", "mid": "BD", "high": "BD"},
        "M": {"low": "LD",
              "mid": {"state": "LD", "alt_state": "BD", "alt_when": {"vr_min": 0.7, "dp_gt": 0.0}},
              "high": "BD"},
        "L": {"low": {"state": "LS", "alt_state": "BR", "alt_when": {"dp_lt": 0.0}},
              "mid": "BR", "high": "BR"},
        "VL": {"low": "LS", "mid": "BR", "high": "PA"},
    },
    "overrides": {
        "panic": {"enabled": True, "vr_min": 2.0, "p_max": 30.0},
        "euphoria": {"enabled": True, "p_min": 80.0},
    },
    "null_vr_zone": "high",
    "trend": {"enabled": True, "dp_window": 5, "missing_dp": 0.0},
    "confirm_days": 2,
    "vr_regimes": [
        {"min": None, "max": 0.25, "id": "extreme_low", "label": "Extreme low demand / fear"},
        {"min": 0.25, "max": 0.5, "id": "choppy", "label": "Choppy and muted"},
        {"min": 0.5, "max": 0.7, "id": "improving", "label": "Improving, tradable"},
        {"min": 0.7, "max": 1.0, "id": "building", "label": "Building demand"},
        {"min": 1.0, "max": 2.0, "id": "high_demand", "label": "High-demand phase"},
        {"min": 2.0, "max": None, "id": "extreme", "label": "Extreme excess / climax"},
    ],
    "boundary_margin": {"p": 2.0, "vr": 0.05},
}

P_ZONE_ORDER = ["VL", "L", "M", "H", "VH"]


def _deep_merge(base: dict, over: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict) and k != "table":
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def load_config(path=None) -> dict[str, Any]:
    p = path or paths.regime_config()
    if path is None and not p.exists():
        atomic_write_json(p, DEFAULT_CONFIG)
    user = read_json(p, None) or {}
    return _deep_merge(DEFAULT_CONFIG, user)


# --------------------------------------------------------------------------- zones

def _isnull(x) -> bool:
    return x is None or (isinstance(x, float) and math.isnan(x))


def p_zone(p: float, cfg: dict) -> str:
    z = cfg["p_zones"]
    if p >= z["VH"]:
        return "VH"
    if p >= z["H"]:
        return "H"
    if p >= z["M"]:
        return "M"
    if p >= z["L"]:
        return "L"
    return "VL"


def vr_zone(vr: float | None, cfg: dict) -> str:
    if _isnull(vr):
        return cfg.get("null_vr_zone", "high")
    z = cfg["vr_zones"]
    if vr >= z["high"]:
        return "high"
    if vr >= z["mid"]:
        return "mid"
    return "low"


def vol_regime(vr: float | None, cfg: dict | None = None) -> str:
    if _isnull(vr):
        return "no_low_volume"
    regimes = (cfg or DEFAULT_CONFIG)["vr_regimes"]
    for r in regimes:
        lo, hi = r.get("min"), r.get("max")
        if (lo is None or vr >= lo) and (hi is None or vr < hi):
            return r["id"]
    return regimes[-1]["id"]


# --------------------------------------------------------------------------- classify

def _cond_holds(when: dict, vr: float | None, dp: float) -> bool:
    vr_eff = math.inf if _isnull(vr) else vr
    if "vr_min" in when and not vr_eff >= when["vr_min"]:
        return False
    if "dp_gt" in when and not dp > when["dp_gt"]:
        return False
    if "dp_lt" in when and not dp < when["dp_lt"]:
        return False
    if "dp_gte" in when and not dp >= when["dp_gte"]:
        return False
    return True


def classify(vr: float | None, p: float | None, dp: float | None, config: dict | None = None
             ) -> tuple[str | None, str]:
    """Return (state_code, rule_id). ``rule_id`` names the override or table cell."""
    cfg = config or DEFAULT_CONFIG
    if _isnull(p):
        return None, "no_data"
    trend = cfg.get("trend", {})
    if not trend.get("enabled", True) or _isnull(dp):
        dp = float(trend.get("missing_dp", 0.0))

    ov = cfg.get("overrides", {})
    pan = ov.get("panic", {})
    if pan.get("enabled", True) and not _isnull(vr) and vr >= pan["vr_min"] and p < pan["p_max"]:
        return "PA", "override:panic"
    eu = ov.get("euphoria", {})
    if eu.get("enabled", True) and p >= eu["p_min"]:
        return "EU", "override:euphoria"

    pz = p_zone(p, cfg)
    vz = vr_zone(vr, cfg)
    cell = cfg["table"][pz][vz]
    rule = f"table:{pz}x{vz}"
    if isinstance(cell, dict):
        if _cond_holds(cell.get("alt_when", {}), vr, dp):
            return cell["alt_state"], rule + ":alt"
        return cell["state"], rule
    return cell, rule


def explain(vr: float | None, p: float | None, dp: float | None, ema: int, state: str | None,
            rule: str) -> str:
    vr_s = "null (no low-volume stocks, treated as high)" if _isnull(vr) else f"{vr:.2f}"
    p_s = "n/a" if _isnull(p) else f"{p:.1f}%"
    dp_s = "" if _isnull(dp) else f", dP = {dp:+.1f}"
    name = STATES.get(state or "", {}).get("name", "no data")
    return f"P(EMA{ema}) = {p_s}, VR = {vr_s}{dp_s}, rule: {rule} -> {name}"


# --------------------------------------------------------------------------- smoothing

def smooth(raw_states: list[str | None], confirm_days: int = 2) -> tuple[list[str | None], list[int]]:
    """Confirmed state changes only after the new raw state holds ``confirm_days``
    consecutive sessions. Returns (confirmed, days_in_state)."""
    confirm_days = max(1, int(confirm_days))
    confirmed: list[str | None] = []
    days: list[int] = []
    cur: str | None = None
    cand: str | None = None
    streak = 0
    run = 0
    for raw in raw_states:
        if raw is None:
            confirmed.append(cur)
            run = run + 1 if cur is not None else 0
            days.append(run)
            continue
        if cur is None:
            cur, cand, streak, run = raw, None, 0, 0
        elif raw == cur:
            cand, streak = None, 0
        else:
            if raw == cand:
                streak += 1
            else:
                cand, streak = raw, 1
            if streak >= confirm_days:
                cur, cand, streak, run = raw, None, 0, 0
        run += 1
        confirmed.append(cur)
        days.append(run)
    return confirmed, days


def classify_history(hist: pd.DataFrame, cfg: dict | None = None) -> pd.DataFrame:
    """Fill every state_* / rule_* / dp_* / days_in_state_* column, per bucket, in date order."""
    cfg = cfg or load_config()
    if not len(hist):
        return hist
    hist = hist.sort_values(["bucket", "date"]).reset_index(drop=True).copy()
    window = int(cfg.get("trend", {}).get("dp_window", 5))
    for span in EMA_SPANS:
        for c in (f"state_ema{span}", f"state_raw_ema{span}", f"rule_ema{span}"):
            hist[c] = pd.Series([None] * len(hist), dtype="object")
        hist[f"dp_ema{span}"] = float("nan")
        hist[f"days_in_state_ema{span}"] = pd.Series([None] * len(hist), dtype="object")

    for bucket, idx in hist.groupby("bucket", sort=False).groups.items():
        sub = hist.loc[idx]
        vr = pd.to_numeric(sub["vol_ratio"], errors="coerce").to_list()
        for span in EMA_SPANS:
            p = pd.to_numeric(sub[f"pct_ema{span}"], errors="coerce")
            dp = (p - p.shift(window)).to_list()
            raws, rules = [], []
            for v, pv, d in zip(vr, p.to_list(), dp):
                s, r = classify(None if _isnull(v) else v, pv, d, cfg)
                raws.append(s)
                rules.append(r)
            conf, days = smooth(raws, cfg.get("confirm_days", 2))
            hist.loc[idx, f"state_raw_ema{span}"] = raws
            hist.loc[idx, f"rule_ema{span}"] = rules
            hist.loc[idx, f"dp_ema{span}"] = [float("nan") if _isnull(x) else round(x, 4) for x in dp]
            hist.loc[idx, f"state_ema{span}"] = conf
            hist.loc[idx, f"days_in_state_ema{span}"] = days
    return hist
