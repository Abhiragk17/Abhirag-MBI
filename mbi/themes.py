"""Thematic group analytics: which industry / group is leading, rotation, movers.

Input is the raw price archive plus the group list (``Indian_Micro_Sector_Themes.txt``,
``###GROUP NAME,NSE:SYM,NSE:SYM,...``). Everything is computed offline.

Method
* Each group is an equal-weight index of its eligible stocks (chained daily mean return).
  A stock is eligible on a day when it has a clean return, at least ``min_history``
  sessions of history and a 20-day median traded value of at least ``min_traded_value``.
  Daily returns are winsorised at +/-``winsor`` and returns that look like an unadjusted
  corporate action (close/prev outside the jump band) are dropped.
* Relative strength (RS) = group index / benchmark index, the benchmark being the
  equal-weight index of every eligible stock in the file.
* Rotation graph (RRG): RS-Ratio = 100 * RS / SMA(RS, ratio_window);
  RS-Momentum = 100 + (RS-Ratio - RS-Ratio ``momentum_window`` sessions ago).
  Quadrants: Leading (both >= 100), Weakening (ratio >= 100, momentum < 100),
  Lagging (both < 100), Improving (ratio < 100, momentum >= 100).
* Leadership score (0-100) = weighted percentile ranks across groups of RS vs benchmark
  (1M/3M/6M), internal breadth, RS momentum and traded-value expansion.
"""
from __future__ import annotations

import copy
import logging
import math
import re
from datetime import date
from typing import Any

import numpy as np
import pandas as pd

from . import adjust, ingest, paths, store
from .metrics import JUMP_HIGH, JUMP_LOW
from .status import now_iso

log = logging.getLogger(__name__)

QUADRANTS = ["Leading", "Weakening", "Lagging", "Improving"]
WINDOWS = {"1D": 1, "1W": 5, "1M": 21, "3M": 63, "6M": 126}
STOCK_WINDOWS = (1, 5, 21, 63, 126)

DEFAULT_CONFIG: dict[str, Any] = {
    "_comment": "Thematic group analytics. Edit and run `python -m mbi themes` to recompute.",
    "min_traded_value": 2_500_000,   # INR, 20-day median traded value for a stock to count
    "min_history": 20,               # sessions of history before a stock counts (skips IPO noise)
    "new_listing_sessions": 60,      # stocks younger than this are flagged "new"
    "winsor": 0.20,                  # daily return clip
    "min_group_size": 3,             # eligible stocks needed to rank a group
    "min_stocks_per_day": 2,         # eligible stocks needed on a day to move a group's index
    "rrg": {"ratio_window": 50, "momentum_window": 10, "tail_step": 5, "history_sessions": 150},
    "weights": {"rs": 0.40, "breadth": 0.25, "momentum": 0.20, "volume": 0.15},
    "emerging_lookback": 10,         # sessions: entered Leading within this many sessions
    "thrust": {"lookback": 5, "rise": 30.0, "level": 60.0},   # % above EMA20 jumps by `rise` to >= `level`
    "corr_window": 60,
    "top_n": 25,
    "watchlist": {"top_groups": 10, "stocks_per_group": 5},
    "aliases": {},                   # {"FILE_SYMBOL": "NSE_SYMBOL"} on top of the automatic _ -> & / - rules
}


def _merge(base: dict, over: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def _num(v: Any, default: float, lo: float, hi: float, integer: bool = False) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(f):
        return default
    f = min(max(f, lo), hi)
    return int(round(f)) if integer else f


def sanitise(cfg: dict[str, Any]) -> dict[str, Any]:
    """Clamp hand-edited values so a typo cannot break the run."""
    d = DEFAULT_CONFIG
    c = cfg
    c["min_traded_value"] = _num(c.get("min_traded_value"), d["min_traded_value"], 0, 1e10)
    c["min_history"] = _num(c.get("min_history"), d["min_history"], 2, 250, True)
    c["new_listing_sessions"] = _num(c.get("new_listing_sessions"), d["new_listing_sessions"], 1, 500, True)
    c["winsor"] = _num(c.get("winsor"), d["winsor"], 0.01, 0.9)
    c["min_group_size"] = _num(c.get("min_group_size"), d["min_group_size"], 1, 50, True)
    c["min_stocks_per_day"] = _num(c.get("min_stocks_per_day"), d["min_stocks_per_day"], 1, 50, True)
    r = c.setdefault("rrg", {})
    r["ratio_window"] = _num(r.get("ratio_window"), d["rrg"]["ratio_window"], 5, 250, True)
    r["momentum_window"] = _num(r.get("momentum_window"), d["rrg"]["momentum_window"], 1, 120, True)
    r["tail_step"] = _num(r.get("tail_step"), d["rrg"]["tail_step"], 1, 20, True)
    r["history_sessions"] = _num(r.get("history_sessions"), d["rrg"]["history_sessions"], 20, 1000, True)
    w = c.setdefault("weights", {})
    for k, v in d["weights"].items():
        w[k] = _num(w.get(k), v, 0, 100)
    if sum(w[k] for k in d["weights"]) <= 0:
        c["weights"] = dict(d["weights"])
    c["emerging_lookback"] = _num(c.get("emerging_lookback"), d["emerging_lookback"], 1, 60, True)
    t = c.setdefault("thrust", {})
    t["lookback"] = _num(t.get("lookback"), d["thrust"]["lookback"], 1, 60, True)
    t["rise"] = _num(t.get("rise"), d["thrust"]["rise"], 1, 100)
    t["level"] = _num(t.get("level"), d["thrust"]["level"], 1, 100)
    c["corr_window"] = _num(c.get("corr_window"), d["corr_window"], 10, 500, True)
    c["top_n"] = _num(c.get("top_n"), d["top_n"], 5, 100, True)
    wl = c.setdefault("watchlist", {})
    wl["top_groups"] = _num(wl.get("top_groups"), d["watchlist"]["top_groups"], 1, 112, True)
    wl["stocks_per_group"] = _num(wl.get("stocks_per_group"), d["watchlist"]["stocks_per_group"], 1, 30, True)
    al = c.get("aliases")
    c["aliases"] = {str(k).strip().upper(): str(v).strip().upper() for k, v in al.items() if str(k).strip() and str(v).strip()} \
        if isinstance(al, dict) else {}
    return c


def load_config() -> dict[str, Any]:
    p = paths.theme_config()
    if not p.exists():
        store.atomic_write_json(p, DEFAULT_CONFIG)
        return copy.deepcopy(DEFAULT_CONFIG)
    return sanitise(_merge(DEFAULT_CONFIG, store.read_json(p, {}) or {}))


# --------------------------------------------------------------------------- parsing

def parse_themes(text: str) -> dict[str, list[str]]:
    """``###NAME,NSE:A,NSE:B,###NAME2,...`` -> {name: [symbols]}.

    Group names may contain commas ("PUMPS, VALVES & COMPRESSORS"), so the name ends at
    the first ``,NSE:``. A symbol listed in two groups stays in the first one.
    """
    groups: dict[str, list[str]] = {}
    seen: set[str] = set()
    for blk in text.split("###"):
        blk = blk.strip().strip(",").strip()
        if not blk:
            continue
        m = re.search(r"[,\n]\s*NSE:", blk)
        name, body = (blk[:m.start()], blk[m.start() + 1:]) if m else (blk, "")
        name = name.strip()
        if not name:
            continue
        syms: list[str] = []
        for tok in body.split(","):
            tok = tok.strip()
            if not tok.upper().startswith("NSE:"):
                continue
            s = tok[4:].strip().upper()
            if s and s not in seen:
                seen.add(s)
                syms.append(s)
        if name in groups:
            groups[name].extend(s for s in syms if s not in groups[name])
        else:
            groups[name] = syms
    return groups


def _candidates(sym: str, aliases: dict[str, str]) -> list[str]:
    out = [aliases.get(sym, sym), sym, sym.replace("_", "&"), sym.replace("_", "-")]
    return list(dict.fromkeys(out))


def resolve_symbols(groups: dict[str, list[str]], available: set[str], aliases: dict[str, str] | None = None
                    ) -> tuple[dict[str, list[str]], list[str], dict[str, str]]:
    """Map file symbols to archive symbols. Returns (groups, unmapped, aliases_used)."""
    aliases = {k.upper(): v.upper() for k, v in (aliases or {}).items()}
    out: dict[str, list[str]] = {}
    unmapped: list[str] = []
    used: dict[str, str] = {}
    for name, syms in groups.items():
        res = []
        for s in syms:
            hit = next((c for c in _candidates(s, aliases) if c in available), None)
            if hit is None:
                unmapped.append(s)
                continue
            if hit != s:
                used[s] = hit
            res.append(hit)
        out[name] = res
    return out, unmapped, used


def slugify(name: str, taken: set[str] | None = None) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "group"
    if taken is not None:
        base, k = s, 2
        while s in taken:
            s = f"{base}-{k}"
            k += 1
        taken.add(s)
    return s


# --------------------------------------------------------------------------- json helpers

def _n(v: Any, nd: int = 2) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return round(f, nd) if math.isfinite(f) else None


def _arr(s: pd.Series | np.ndarray, nd: int = 2) -> list[float | None]:
    return [_n(v, nd) for v in np.asarray(s, dtype="float64")]


def _spark(s: pd.Series) -> list[float | None]:
    ok = s.dropna()
    return _arr(s / ok.iloc[0] * 100.0 if len(ok) else s, 1)


def _pct(v: Any, nd: int = 2) -> float | None:
    f = _n(v, 10)
    return None if f is None else round(f * 100.0, nd)


# --------------------------------------------------------------------------- analysis

def _quadrant(ratio: float, mom: float) -> str | None:
    if not (math.isfinite(ratio) and math.isfinite(mom)):
        return None
    if ratio >= 100:
        return "Leading" if mom >= 100 else "Weakening"
    return "Improving" if mom >= 100 else "Lagging"


def _quad_frame(ratio: pd.DataFrame, mom: pd.DataFrame) -> pd.DataFrame:
    code = np.full(ratio.shape, np.nan)
    r, m = ratio.to_numpy(float), mom.to_numpy(float)
    ok = np.isfinite(r) & np.isfinite(m)
    code[ok & (r >= 100) & (m >= 100)] = 0
    code[ok & (r >= 100) & (m < 100)] = 1
    code[ok & (r < 100) & (m < 100)] = 2
    code[ok & (r < 100) & (m >= 100)] = 3
    return pd.DataFrame(code, index=ratio.index, columns=ratio.columns)


def _cluster_order(corr: np.ndarray) -> list[int]:
    """Average-linkage agglomerative ordering (no scipy): keeps similar groups adjacent."""
    n = corr.shape[0]
    if n <= 2:
        return list(range(n))
    dist = 1.0 - np.nan_to_num(corr, nan=0.0)
    clusters: dict[int, list[int]] = {i: [i] for i in range(n)}
    d = {(i, j): dist[i, j] for i in range(n) for j in range(i + 1, n)}
    nxt = n
    while len(clusters) > 1:
        (a, b), _ = min(d.items(), key=lambda kv: kv[1])
        ca, cb = clusters.pop(a), clusters.pop(b)
        for k in list(clusters):
            da = d.pop((min(a, k), max(a, k)))
            db = d.pop((min(b, k), max(b, k)))
            d[(k, nxt)] = (da * len(ca) + db * len(cb)) / (len(ca) + len(cb))
        d.pop((a, b), None)
        clusters[nxt] = ca + cb
        nxt += 1
    return next(iter(clusters.values()))


def _streak(q: np.ndarray, code: int) -> int:
    """Length of the trailing run of ``code`` in q."""
    k = 0
    for v in q[::-1]:
        if v == code:
            k += 1
        else:
            break
    return k


def analyze(close: pd.DataFrame, adj_vol: pd.DataFrame, tval: pd.DataFrame,
            groups: dict[str, list[str]], cfg: dict[str, Any],
            states: pd.Series | None = None) -> dict[str, Any]:
    """All metrics from wide matrices (index = dates, columns = symbols).

    ``close`` and ``adj_vol`` are split-adjusted; ``tval`` is raw close*volume (INR).
    ``groups`` maps names to symbols that are columns of ``close``.
    """
    dates = [d.isoformat() if hasattr(d, "isoformat") else str(d) for d in close.index]
    syms = list(close.columns)
    names = [g for g, s in groups.items() if s]
    pos = {s: i for i, s in enumerate(syms)}
    M = np.zeros((len(syms), len(names)))
    for j, g in enumerate(names):
        for s in groups[g]:
            M[pos[s], j] = 1.0

    def gsum(x: pd.DataFrame) -> pd.DataFrame:
        return pd.DataFrame(x.to_numpy(float) @ M, index=x.index, columns=names)

    # ---- stock level building blocks
    ratio = close / close.shift(1)
    bad = (ratio < JUMP_LOW) | (ratio > JUMP_HIGH)
    r = (ratio - 1.0).where(~bad).clip(-cfg["winsor"], cfg["winsor"])
    hist = close.notna().cumsum()
    medtv = tval.rolling(20, min_periods=10).median()
    elig = r.notna() & (hist >= cfg["min_history"]) & (medtv >= cfg["min_traded_value"])
    r_el = r.where(elig)

    n = gsum(elig.astype(float))
    gret = (gsum(r_el.fillna(0.0)) / n.where(n > 0)).where(n >= cfg["min_stocks_per_day"])
    started = gret.notna().cummax()
    idx = (100.0 * (1.0 + gret.fillna(0.0)).cumprod()).where(started)

    bn = elig.sum(axis=1)
    bench_r = r_el.mean(axis=1).where(bn >= 5)
    bidx = 100.0 * (1.0 + bench_r.fillna(0.0)).cumprod()

    rs = idx.div(bidx, axis=0) * 100.0
    rrg_cfg = cfg["rrg"]
    ratio_rs = 100.0 * rs / rs.rolling(rrg_cfg["ratio_window"], min_periods=rrg_cfg["ratio_window"]).mean()
    mom = 100.0 + (ratio_rs - ratio_rs.shift(rrg_cfg["momentum_window"]))
    quad = _quad_frame(ratio_rs, mom)

    # ---- breadth inside each group
    ema = {s: close.ewm(span=s, adjust=False, ignore_na=True).mean() for s in (20, 50)}
    valid = {s: elig & (hist >= s) for s in (20, 50)}
    pct = {}
    for s in (20, 50):
        den = gsum(valid[s].astype(float))
        pct[s] = (gsum(((close > ema[s]) & valid[s]).astype(float)) / den.where(den > 0)) * 100.0
    hi = close.rolling(252, min_periods=60).max()
    near = (close >= 0.95 * hi) & elig
    pct_near = gsum(near.astype(float)) / n.where(n > 0) * 100.0

    tv_per = gsum(tval.where(elig).fillna(0.0)) / n.where(n > 0)
    vol_exp = tv_per.rolling(10, min_periods=5).mean() / tv_per.rolling(60, min_periods=30).mean()

    # ---- window returns vs benchmark
    gk = {lab: idx / idx.shift(k) - 1.0 for lab, k in WINDOWS.items()}
    bk = {lab: bidx / bidx.shift(k) - 1.0 for lab, k in WINDOWS.items()}
    rel = {lab: gk[lab].sub(bk[lab], axis=0) for lab in WINDOWS}

    # ---- leadership score (percentile ranks across rankable groups, per date)
    mask = n >= cfg["min_group_size"]

    def rk(df: pd.DataFrame) -> pd.DataFrame:
        return df.where(mask).rank(axis=1, pct=True)

    parts = [rk(rel[w]) for w in ("1M", "3M", "6M")]
    rs_c = sum(p.fillna(0.0) for p in parts) / sum(p.notna().astype(float) for p in parts).replace(0, np.nan)
    br_parts = [rk(pct[20]), rk(pct[50])]
    br_c = sum(p.fillna(0.0) for p in br_parts) / sum(p.notna().astype(float) for p in br_parts).replace(0, np.nan)
    comps = {"rs": rs_c, "breadth": br_c, "momentum": rk(mom), "volume": rk(vol_exp)}
    wsum = sum(cfg["weights"][k] * comps[k].notna().astype(float) for k in comps)
    score = (100.0 * sum(cfg["weights"][k] * comps[k].fillna(0.0) for k in comps) / wsum.replace(0, np.nan)
             ).where(rs_c.notna())
    rank = score.rank(axis=1, ascending=False, method="min")

    T = len(close) - 1
    if T < 1:
        return {"empty": True}
    P = max(0, T - 5)
    names_idx = {g: j for j, g in enumerate(names)}

    # ---- stock metrics at T
    cf = close.ffill(limit=5)
    last = cf.iloc[-1]
    traded_today = close.iloc[-1].notna()
    stock_ret = {k: (last / cf.shift(k).iloc[-1] - 1.0) * 100.0 for k in STOCK_WINDOWS}
    stock_ret[1] = (close.iloc[-1] / close.iloc[-2] - 1.0) * 100.0 if T >= 1 else pd.Series(np.nan, index=syms)
    suspect = bad.iloc[-1]
    liquid = medtv.iloc[-1] >= cfg["min_traded_value"]
    n_hist = hist.iloc[-1]
    is_new = n_hist < cfg["new_listing_sessions"]
    rankable = liquid & ~is_new & traded_today & ~suspect
    rs_parts = [stock_ret[k].where(rankable).rank(pct=True) * 100.0 for k in (21, 63, 126)]
    stock_rs = pd.concat(rs_parts, axis=1).mean(axis=1)
    tail = adj_vol.iloc[max(0, T - 20):T]
    avgv = tail.mean()
    rel_vol = (adj_vol.iloc[-1] / avgv.where((tail.notna().sum() >= 10) & (avgv > 0)))
    from_high = (last / hi.iloc[-1] - 1.0) * 100.0
    above20 = close.iloc[-1] > ema[20].iloc[-1]
    above50 = close.iloc[-1] > ema[50].iloc[-1]
    sym_group = {s: g for g in names for s in groups[g]}
    g_ret21 = (gk["1M"].iloc[-1] * 100.0)
    g_ret63 = (gk["3M"].iloc[-1] * 100.0)

    stocks: list[dict[str, Any]] = []
    for s in syms:
        g = sym_group.get(s)
        if g is None:
            continue
        rg21 = stock_ret[21][s] - g_ret21.get(g, np.nan)
        rg63 = stock_ret[63][s] - g_ret63.get(g, np.nan)
        rsv = stock_rs[s]
        role = ""
        if bool(is_new[s]):
            role = "new"
        elif math.isfinite(rsv) and bool(rankable[s]):
            if rsv >= 70 and rg63 > 0:
                role = "leader"
            elif rsv < 30 and rg63 < 0:
                role = "laggard"
        stocks.append({
            "symbol": s, "group": g, "close": _n(last[s], 2),
            "ret_1d": _n(stock_ret[1][s]), "ret_5d": _n(stock_ret[5][s]), "ret_21d": _n(stock_ret[21][s]),
            "ret_63d": _n(stock_ret[63][s]), "ret_126d": _n(stock_ret[126][s]),
            "rs": _n(rsv, 1), "rel_group_21d": _n(rg21), "rel_group_63d": _n(rg63),
            "rel_vol": _n(rel_vol[s]), "from_high": _n(from_high[s]),
            "above_ema20": bool(above20[s]), "above_ema50": bool(above50[s]),
            "tv_cr": _n(medtv.iloc[-1][s] / 1e7, 2), "liquid": bool(liquid[s]), "new": bool(is_new[s]),
            "traded": bool(traded_today[s]), "suspect": bool(suspect[s]), "role": role,
        })
    stocks_by_group: dict[str, list[dict[str, Any]]] = {}
    for st in stocks:
        stocks_by_group.setdefault(st["group"], []).append(st)

    # ---- group records
    group_rows: list[dict[str, Any]] = []
    for g in names:
        j = names_idx[g]
        q = quad.iloc[:, j].to_numpy()
        qn = q[-1]
        quadrant = QUADRANTS[int(qn)] if np.isfinite(qn) else None
        row = {
            "name": g, "slug": "", "n_total": len(groups[g]), "n_eligible": int(n.iloc[-1, j]),
            "low_n": bool(n.iloc[-1, j] < cfg["min_group_size"]),
            "score": _n(score.iloc[-1, j], 1), "score_5d": _n(score.iloc[P, j], 1),
            "rank": _n(rank.iloc[-1, j], 0), "rank_5d": _n(rank.iloc[P, j], 0),
            "rs_ratio": _n(ratio_rs.iloc[-1, j]), "rs_momentum": _n(mom.iloc[-1, j]), "quadrant": quadrant,
            "pct_ema20": _n(pct[20].iloc[-1, j], 1), "pct_ema50": _n(pct[50].iloc[-1, j], 1),
            "pct_ema20_5d": _n(pct[20].iloc[P, j], 1),
            "pct_near_high": _n(pct_near.iloc[-1, j], 1), "vol_exp": _n(vol_exp.iloc[-1, j]),
            "spark": _spark(idx.iloc[-60:, j]),
        }
        for lab in WINDOWS:
            row[f"ret_{lab}"] = _pct(gk[lab].iloc[-1, j])
            row[f"rel_{lab}"] = _pct(rel[lab].iloc[-1, j])
        sts = stocks_by_group.get(g, [])
        row["leaders"] = [s["symbol"] for s in sorted(
            (s for s in sts if s["role"] == "leader"), key=lambda x: -(x["rs"] or 0))[:5]]
        group_rows.append(row)
    taken: set[str] = set()
    for row in group_rows:
        row["slug"] = slugify(row["name"], taken)
    row_by_name = {r_["name"]: r_ for r_ in group_rows}

    # ---- alerts
    lb = cfg["emerging_lookback"]
    emerging, deteriorating, thrusts = [], [], []
    th = cfg["thrust"]
    for g in names:
        j = names_idx[g]
        row = row_by_name[g]
        if row["low_n"]:
            continue
        q = quad.iloc[:, j].to_numpy()
        lead = _streak(q, 0)
        if 0 < lead <= lb and len(q) > lead and q[-1 - lead] in (2, 3):
            emerging.append({"name": g, "slug": row["slug"], "days_in_leading": lead,
                             "from": QUADRANTS[int(q[-1 - lead])], "score": row["score"],
                             "ret_1M": row["ret_1M"], "pct_ema20": row["pct_ema20"]})
        window = q[-(lb + 1):]
        if q[-1] in (1, 2) and (window == 0).any():
            ago = int(len(window) - 1 - np.flatnonzero(window == 0).max())
            deteriorating.append({"name": g, "slug": row["slug"], "now": QUADRANTS[int(q[-1])],
                                  "left_leading_days_ago": ago, "score": row["score"], "ret_1M": row["ret_1M"]})
        p_now, p_then = pct[20].iloc[-1, j], pct[20].iloc[max(0, T - th["lookback"]), j]
        if math.isfinite(p_now) and math.isfinite(p_then) and p_now >= th["level"] and p_now - p_then >= th["rise"]:
            thrusts.append({"name": g, "slug": row["slug"], "pct_ema20": _n(p_now, 1), "from": _n(p_then, 1),
                            "rise": _n(p_now - p_then, 1), "n_eligible": row["n_eligible"]})
    emerging.sort(key=lambda x: (x["days_in_leading"], -(x["score"] or 0)))
    deteriorating.sort(key=lambda x: x["left_leading_days_ago"])
    thrusts.sort(key=lambda x: -x["rise"])

    # ---- top stocks
    top_n = cfg["top_n"]
    pool = [s for s in stocks if s["liquid"] and not s["new"] and s["traded"] and not s["suspect"]]
    top_stocks: dict[str, dict[str, list]] = {"gainers": {}, "losers": {}}
    keep = ("symbol", "group", "close", "ret_1d", "ret_5d", "ret_21d", "ret_63d", "rs", "rel_vol", "role", "tv_cr")
    for lab, key in (("1D", "ret_1d"), ("1W", "ret_5d"), ("1M", "ret_21d"), ("3M", "ret_63d")):
        have = [s for s in pool if s[key] is not None]
        srt = sorted(have, key=lambda x: x[key], reverse=True)
        top_stocks["gainers"][lab] = [{k: s[k] for k in keep} for s in srt[:top_n]]
        top_stocks["losers"][lab] = [{k: s[k] for k in keep} for s in srt[::-1][:top_n]]

    # ---- regime link
    regime = None
    if states is not None and len(states):
        st_map = {(d.isoformat() if hasattr(d, "isoformat") else str(d)): v for d, v in states.items()}
        st_series = pd.Series([st_map.get(d) for d in dates], index=close.index)
        excess = gret.sub(bench_r, axis=0)
        rows = []
        present = [s for s in st_series.dropna().unique()]
        days = {s: int((st_series == s).sum()) for s in present}
        for g in names:
            if row_by_name[g]["low_n"]:
                continue
            rr: dict[str, Any] = {"name": g, "slug": row_by_name[g]["slug"]}
            for s in present:
                x = excess[g][st_series == s].dropna()
                rr[s] = {"avg_bps": _n(x.mean() * 1e4, 1) if len(x) >= 5 else None,
                         "hit": _n((x > 0).mean() * 100, 0) if len(x) >= 5 else None, "n": int(len(x))}
            rows.append(rr)
        cur = st_series.dropna()
        regime = {"states": sorted(present), "days": days, "rows": rows,
                  "current": cur.iloc[-1] if len(cur) else None}

    # ---- correlation
    cw = cfg["corr_window"]
    rank_names = [g for g in names if not row_by_name[g]["low_n"]]
    corr_out = None
    if len(rank_names) >= 3 and T >= 20:
        sub = gret[rank_names].iloc[-cw:].fillna(0.0)
        c = np.corrcoef(sub.to_numpy().T)
        order = _cluster_order(c)
        onames = [rank_names[i] for i in order]
        oc = c[np.ix_(order, order)]
        pairs = []
        k = len(rank_names)
        for a in range(k):
            for b in range(a + 1, k):
                if math.isfinite(c[a, b]):
                    pairs.append((c[a, b], rank_names[a], rank_names[b]))
        pairs.sort()
        corr_out = {
            "window": min(cw, len(sub)), "order": onames,
            "slugs": [row_by_name[g]["slug"] for g in onames],
            "matrix": [[_n(v, 2) for v in row] for row in oc],
            "most_correlated": [{"a": a, "b": b, "corr": _n(v, 2)} for v, a, b in pairs[::-1][:15]],
            "diversifiers": [{"a": a, "b": b, "corr": _n(v, 2)} for v, a, b in pairs[:10]],
        }

    # ---- rotation graph data
    hs = min(rrg_cfg["history_sessions"], len(dates))
    rrg = {
        "dates": dates[-hs:], "tail_step": rrg_cfg["tail_step"],
        "groups": {g: {"slug": row_by_name[g]["slug"], "low_n": row_by_name[g]["low_n"],
                       "ratio": _arr(ratio_rs[g].iloc[-hs:]), "momentum": _arr(mom[g].iloc[-hs:]),
                       "score": _arr(score[g].iloc[-hs:], 1)} for g in names},
    }

    # ---- group detail files
    details: dict[str, dict[str, Any]] = {}
    for g in names:
        row = row_by_name[g]
        sts = sorted(stocks_by_group.get(g, []), key=lambda x: -(x["rs"] if x["rs"] is not None else -1))
        details[row["slug"]] = {
            "summary": {k: v for k, v in row.items() if k != "spark"}, "dates": dates,
            "index": _arr(idx[g], 2), "rs": _arr(rs[g], 2), "ratio": _arr(ratio_rs[g]), "momentum": _arr(mom[g]),
            "pct_ema20": _arr(pct[20][g], 1), "pct_ema50": _arr(pct[50][g], 1), "pct_near_high": _arr(pct_near[g], 1),
            "score": _arr(score[g], 1), "n": [int(v) for v in n[g].to_numpy()],
            "bench": _arr(bidx, 2), "stocks": sts,
        }

    # ---- digest + watchlist
    ranked = sorted((r_ for r_ in group_rows if not r_["low_n"] and r_["score"] is not None),
                    key=lambda x: -x["score"])
    leaders_g = ranked[:5]
    lead_syms = []
    for gr in leaders_g:
        lead_syms += [s for s in stocks_by_group.get(gr["name"], []) if s["role"] == "leader" and s["liquid"]]
    lead_syms.sort(key=lambda x: -(x["rs"] or 0))
    digest = {
        "date": dates[-1],
        "market_state": regime["current"] if regime else None,
        "leaders": [{k: g_[k] for k in ("name", "slug", "score", "quadrant", "ret_1M", "rel_3M", "pct_ema20")} for g_ in leaders_g],
        "emerging": emerging[:5], "deteriorating": deteriorating[:5], "thrusts": thrusts[:5],
        "top_stocks": [{k: s[k] for k in ("symbol", "group", "ret_1d", "ret_21d", "rs")} for s in lead_syms[:10]],
        "worst_groups": [{k: g_[k] for k in ("name", "slug", "score", "quadrant", "ret_1M")} for g_ in ranked[-3:][::-1]],
    }
    wl = cfg["watchlist"]
    lead_first = [g_ for g_ in ranked if g_["quadrant"] == "Leading"] + [g_ for g_ in ranked if g_["quadrant"] != "Leading"]
    lines = []
    for g_ in lead_first[: wl["top_groups"]]:
        picks = [s for s in sorted(stocks_by_group.get(g_["name"], []), key=lambda x: -(x["rs"] or 0))
                 if s["liquid"] and not s["new"] and s["traded"] and s["above_ema50"]][: wl["stocks_per_group"]]
        if picks:
            lines.append("###" + g_["name"] + "," + ",".join(f"NSE:{s['symbol']}" for s in picks))
    watchlist = ",".join(lines)

    md = [f"# Theme digest - {dates[-1]}", ""]
    if digest["market_state"]:
        md.append(f"Market state (EMA20, ALL): **{digest['market_state']}**")
        md.append("")
    md.append("## Leading groups")
    for g_ in digest["leaders"]:
        md.append(f"- {g_['name']}: score {g_['score']}, {g_['quadrant']}, 1M {g_['ret_1M']}%, "
                  f"3M vs market {g_['rel_3M']}%, {g_['pct_ema20']}% above EMA20")
    for title, key, fmt in (
        ("Newly leading", "emerging", lambda e: f"{e['name']} (in Leading {e['days_in_leading']}d, from {e['from']})"),
        ("Losing leadership", "deteriorating", lambda e: f"{e['name']} (now {e['now']}, left Leading {e['left_leading_days_ago']}d ago)"),
        ("Breadth thrusts", "thrusts", lambda e: f"{e['name']} ({e['from']}% -> {e['pct_ema20']}% above EMA20)"),
    ):
        if digest[key]:
            md += ["", f"## {title}"] + [f"- {fmt(e)}" for e in digest[key]]
    if digest["top_stocks"]:
        md += ["", "## Leader stocks in leading groups"] + [
            f"- {s['symbol']} ({s['group']}): 1M {s['ret_21d']}%, RS {s['rs']}" for s in digest["top_stocks"]]
    md_text = "\n".join(md) + "\n"

    bench = {"date": dates[-1], "n_eligible": int(bn.iloc[-1])}
    for lab in WINDOWS:
        bench[f"ret_{lab}"] = _pct(bidx.iloc[-1] / bidx.iloc[-1 - WINDOWS[lab]] - 1.0) if T >= WINDOWS[lab] else None

    return {
        "empty": False, "dates": dates, "groups": group_rows, "bench": bench, "top_stocks": top_stocks,
        "emerging": emerging, "deteriorating": deteriorating, "thrusts": thrusts, "regime": regime,
        "corr": corr_out, "rrg": rrg, "details": details, "stocks": stocks, "digest": digest,
        "digest_md": md_text, "watchlist": watchlist,
        "coverage": {"stocks": len(stocks), "liquid": int(sum(1 for s in stocks if s["liquid"])),
                     "new": int(sum(1 for s in stocks if s["new"])), "eligible_today": int(bn.iloc[-1])},
    }


# --------------------------------------------------------------------------- IO + orchestration

def _wide(df: pd.DataFrame, col: str, dates: list[date], symbols: list[str]) -> pd.DataFrame:
    w = df.pivot(index="date", columns="symbol", values=col)
    return w.reindex(index=dates, columns=symbols).astype("float64")


def run(status=None) -> dict[str, Any]:
    """Load the archive, analyse, write ``data/themes/*``. Returns a short summary."""
    cfg = load_config()
    tf = paths.themes_file()
    if not tf.exists():
        raise FileNotFoundError(f"theme list not found: {tf}")
    groups_raw = parse_themes(tf.read_text(encoding="utf-8"))

    short = {date.fromisoformat(x) for x in ingest.load_calendar_config().get("short_sessions", [])}
    sessions = [d for d in store.archived_dates() if d not in short]
    out_dir = paths.themes_dir()
    if not sessions:
        store.atomic_write_json(out_dir / "themes_latest.json",
                                {"generated_at": now_iso(), "date": None, "groups": [], "note": "no price data yet"})
        return {"groups": 0, "date": None}

    prices = store.load_prices(dates=sessions)
    avail = set(prices["symbol"].unique())
    groups, unmapped, used = resolve_symbols(groups_raw, avail, cfg.get("aliases"))
    wanted = sorted({s for v in groups.values() for s in v})
    if not wanted:
        store.atomic_write_json(out_dir / "themes_latest.json", {
            "generated_at": now_iso(), "date": sessions[-1].isoformat(), "groups": [], "unmapped": unmapped,
            "note": "none of the theme symbols are in the price archive"})
        return {"groups": 0, "date": sessions[-1].isoformat()}
    prices = prices[prices["symbol"].isin(wanted)].drop_duplicates(["date", "symbol"], keep="last")
    adj = adjust.adjust_ohlcv(prices, adjust.load_splits(avail, write_report=False))
    adj["tv"] = pd.to_numeric(adj["close"], errors="coerce") * pd.to_numeric(adj["volume"], errors="coerce")
    # a stock that did not trade has no row; zero volume rows count as not traded
    adj = adj[pd.to_numeric(adj["volume"], errors="coerce") > 0]
    close = _wide(adj, "adj_close", sessions, wanted)
    vol = _wide(adj, "adj_volume", sessions, wanted)
    tv = _wide(adj, "tv", sessions, wanted)

    states = None
    hist = store.read_history()
    if len(hist):
        h = hist[hist["bucket"] == "ALL"]
        if "state_ema20" in h.columns:
            states = pd.Series(h["state_ema20"].to_numpy(), index=h["date"]).dropna()

    res = analyze(close, vol, tv, groups, cfg, states)
    if res.get("empty"):
        return {"groups": 0, "date": sessions[-1].isoformat()}

    latest = {
        "generated_at": now_iso(), "date": res["dates"][-1], "prev_date": res["dates"][-2] if len(res["dates"]) > 1 else None,
        "n_sessions": len(res["dates"]), "config": {k: cfg[k] for k in
                                                     ("min_traded_value", "min_group_size", "weights", "rrg", "emerging_lookback", "thrust")},
        "coverage": {**res["coverage"], "groups": len(res["groups"]), "symbols_in_file": sum(len(v) for v in groups_raw.values()),
                     "unmapped": unmapped, "aliased": used},
        "bench": res["bench"], "groups": res["groups"], "top_stocks": res["top_stocks"],
        "emerging": res["emerging"], "deteriorating": res["deteriorating"], "thrusts": res["thrusts"],
        "digest": res["digest"],
    }
    store.atomic_write_json(out_dir / "themes_latest.json", latest)
    store.atomic_write_json(out_dir / "themes_rrg.json", res["rrg"])
    store.atomic_write_json(out_dir / "themes_stocks.json", {"date": res["dates"][-1], "stocks": res["stocks"]})
    store.atomic_write_json(out_dir / "themes_regime.json", res["regime"] or {"states": [], "rows": [], "days": {}})
    store.atomic_write_json(out_dir / "themes_corr.json", res["corr"] or {})
    store.atomic_write_json(out_dir / "themes_digest.json", res["digest"])
    store.atomic_write_text(out_dir / "themes_digest.md", res["digest_md"])
    store.atomic_write_text(out_dir / "watchlist_leaders.txt", res["watchlist"])
    for slug, d in res["details"].items():
        store.atomic_write_json(out_dir / "groups" / f"{slug}.json", d)
    # drop detail files for groups that no longer exist
    keep = {f"{s}.json" for s in res["details"]}
    gdir = out_dir / "groups"
    if gdir.exists():
        for p in gdir.glob("*.json"):
            if p.name not in keep:
                p.unlink()
    log.info("themes: %d groups, %d stocks, %d unmapped symbols (%s)", len(res["groups"]), len(res["stocks"]),
             len(unmapped), res["dates"][-1])
    return {"groups": len(res["groups"]), "stocks": len(res["stocks"]), "date": res["dates"][-1],
            "unmapped": unmapped, "aliased": used}
