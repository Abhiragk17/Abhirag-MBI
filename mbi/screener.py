"""Technical screener: one pre-computed row of indicators per stock.

Everything is computed offline from the split-adjusted price archive and written to
``data/screener/screener_latest.json`` (columnar: ``columns`` + ``rows``, with a ``fields``
registry the web UI uses to build its filter list). Filtering happens in the browser.

Conventions (shown in the UI as well)
* Distances are in %. ``*_dist`` for a high is how far the close is *below* it (0 = at the high);
  for a low it is how far the close is *above* it.
* "Last ... change / cross" fields count periods since the event, where 1 = it happened on the
  latest bar (so "= 1" means "just happened"). Weekly / monthly fields count weekly / monthly bars.
* Weekly and monthly indicators are built from the daily bars (weeks end Friday, months end on the
  last session); the current, unfinished week or month is the latest bar.
* The archive is short (about two years), so 3Y / 5Y fields stay empty until enough history exists,
  ATH means "highest since the archive starts", and monthly indicators need their full look-back.
* Nifty 50 / Nifty 500 are not in the archive. The benchmarks are equal-weight proxies built from the
  archive itself: ``lc`` = the Largecap bucket, ``mkt`` = every stock in the screen.
"""
from __future__ import annotations

import json
import logging
from datetime import date
from typing import Any

import numpy as np
import pandas as pd

from . import adjust, ingest, paths, store, themes
from .metrics import JUMP_HIGH, JUMP_LOW
from .status import now_iso

log = logging.getLogger(__name__)

# ----------------------------------------------------------------------------- field registry

FIELDS: list[dict[str, Any]] = []
_KEYS: set[str] = set()


def _f(key: str, label: str, group: str, unit: str, desc: str, *, kind: str = "num", dec: int = 2) -> None:
    if key in _KEYS:
        raise ValueError(f"duplicate screener field {key}")
    _KEYS.add(key)
    FIELDS.append({"key": key, "label": label, "group": group, "unit": unit, "desc": desc, "kind": kind, "dec": dec})


G_PRICE = "Price & volume"
G_HIGHLOW = "Highs, lows & distance"
G_BREAK = "Breakout & gap"
G_MA = "Moving averages"
G_CROSS = "Crossovers & timing"
G_MOM = "Momentum & trend strength"
G_RS = "Relative strength"
G_VSTOP = "Volatility stops"
G_VOL = "Volume technicals"
G_CUSTOM = "Patterns & custom"

HL_WINDOWS: list[tuple[str, str, int | None]] = [   # key, label, sessions (None = whole archive)
    ("13w", "13W", 63), ("26w", "26W", 126), ("52w", "52W", 252), ("3y", "3Y", 756), ("5y", "5Y", 1260), ("ath", "All-time", None),
]
SMA_D, EMA_D = (20, 50, 100, 200), (10, 20, 50, 100, 200)
SMA_W, EMA_W = (10, 21, 26, 30, 40, 52), (10, 21, 26, 30, 52)
MA_M = (6, 12)
RET_WINDOWS = [("1d", "1D", 1), ("1w", "1W", 5), ("1m", "1M", 21), ("3m", "3M", 63), ("6m", "6M", 126), ("12m", "12M", 252)]
ALPHA_WINDOWS = [("1w", "1W", 5), ("1m", "1M", 21), ("3m", "3M", 63), ("6m", "6M", 126), ("1y", "1Y", 252)]
CRS_WINDOWS = [("25d", "25D", 25), ("50d", "50D", 50), ("26w", "26W", 130), ("52w", "52W", 252)]
VSTOPS = [("d", 10, 2.0), ("d", 14, 2.0), ("d", 14, 2.5), ("w", 10, 2.0), ("w", 14, 2.0), ("w", 14, 2.5),
          ("m", 10, 2.0), ("m", 12, 2.0), ("m", 12, 2.5)]
VOL_SMAS = (5, 10, 20, 50, 100, 200)
BENCH = {"mkt": "Market (equal-weight)", "lc": "Largecap (equal-weight)"}


def _vs_key(tf: str, n: int, m: float) -> str:
    return f"{tf}{n}_{str(m).replace('.', 'p')}"


def _register() -> None:
    # --- price & volume
    _f("close", "Close", G_PRICE, "₹", "Last adjusted close.")
    _f("open", "Open", G_PRICE, "₹", "Today's adjusted open.")
    _f("high", "High", G_PRICE, "₹", "Today's adjusted high.")
    _f("low", "Low", G_PRICE, "₹", "Today's adjusted low.")
    _f("volume", "Volume", G_PRICE, "#", "Today's traded shares.", dec=0)
    for k, lab, _ in RET_WINDOWS:
        _f(f"ret_{k}", f"Return {lab}", G_PRICE, "%", f"Price change over {lab} (sessions: 1D=1, 1W=5, 1M=21, 3M=63, 6M=126, 12M=252).")
    _f("tv_20d_cr", "Avg traded value 20D", G_PRICE, "₹ Cr", "Median daily traded value over 20 sessions, in crore rupees. A liquidity filter.")
    _f("atr_pct_14d", "ATR % (14D)", G_PRICE, "%", "14-day Average True Range as % of price: how much the stock typically moves in a day.")
    _f("history_days", "History (sessions)", G_PRICE, "d", "Sessions of price history in the archive for this stock. Low = recent listing.", dec=0)
    _f("traded_today", "Traded on latest session", G_PRICE, "flag", "1 if the stock traded on the latest session; 0 if it is stale (suspended or missing).", kind="flag", dec=0)
    _f("jump_1y", "Unadjusted price jump (1Y)", G_PRICE, "flag",
       "1 if the adjusted close moved more than -40% or +60% in a single day within the last year: usually a split or bonus missing from the split list (see issues/001). Returns, RS and highs for these stocks are unreliable.", kind="flag", dec=0)
    _f("in_breadth", "Counted in breadth", G_PRICE, "flag", "1 if the stock passed the breadth data checks on the latest session.", kind="flag", dec=0)

    # --- highs / lows
    for k, lab, w in HL_WINDOWS:
        span = "since the archive starts" if w is None else f"over {lab}" + ("" if w < 700 else " (needs enough history)")
        _f(f"high_{k}", f"{lab} high", G_HIGHLOW, "₹", f"Highest price {span}. Useful as a breakout trigger level.")
        _f(f"high_{k}_dist", f"{lab} high distance", G_HIGHLOW, "%", f"% the close is below the {lab} high (0 = at the high). Scan '<= 3' for stocks within 3% of it.")
        _f(f"high_{k}_days", f"{lab} high: days since", G_HIGHLOW, "d", f"Sessions since the {lab} high was made (0 = today). '<= 5' finds a fresh high.", dec=0)
        _f(f"low_{k}", f"{lab} low", G_HIGHLOW, "₹", f"Lowest price {span}. Support / drawdown reference.")
        _f(f"low_{k}_dist", f"{lab} low distance", G_HIGHLOW, "%", f"% the close is above the {lab} low. Large = recovered; small = still near the low.")
        _f(f"low_{k}_days", f"{lab} low: days since", G_HIGHLOW, "d", f"Sessions since the {lab} low was made (0 = today).", dec=0)
    _f("range_pos_52w", "Position in 52W range", G_HIGHLOW, "%", "Where the close sits between the 52W low (0) and 52W high (100).")

    # --- breakout & gap
    _f("breakout_window", "Breakout window", G_BREAK, "flag",
       "1 when the stock is within 3% of its 52W high, above EMA20 and SMA50, with RSI(14) >= 55: close to breaking out with momentum aligned.", kind="flag", dec=0)
    _f("gap_open_pct", "Gap at open", G_BREAK, "%", "Today's open vs the previous close. Large positive = strong overnight demand.")
    _f("gap_up", "Gap up (>= 2%)", G_BREAK, "flag", "1 if today opened at least 2% above the previous close.", kind="flag", dec=0)
    _f("gap_down", "Gap down (<= -2%)", G_BREAK, "flag", "1 if today opened at least 2% below the previous close.", kind="flag", dec=0)
    for n in (20, 50):
        _f(f"new_high_{n}d", f"New {n}-day high", G_BREAK, "flag", f"1 if today's high is the highest of the last {n} sessions.", kind="flag", dec=0)
        _f(f"new_low_{n}d", f"New {n}-day low", G_BREAK, "flag", f"1 if today's low is the lowest of the last {n} sessions.", kind="flag", dec=0)

    # --- moving averages
    for kind, name in (("sma", "SMA"), ("ema", "EMA")):
        for n in (SMA_D if kind == "sma" else EMA_D):
            _f(f"{kind}_{n}d", f"{name} {n}D", G_MA, "₹", f"{'Simple' if kind == 'sma' else 'Exponential'} moving average of the close over {n} days.")
            _f(f"{kind}_{n}d_dist", f"Distance from {name} {n}D", G_MA, "%", f"% the close is above (+) or below (-) the {name} {n}D. Large + = extended; near 0 = retest.")
        for n in (SMA_W if kind == "sma" else EMA_W):
            _f(f"{kind}_{n}w", f"{name} {n}W", G_MA, "₹", f"{name} of weekly closes over {n} weeks.")
            _f(f"{kind}_{n}w_dist", f"Distance from {name} {n}W", G_MA, "%", f"% the close is above/below the {name} {n}W.")
        for n in MA_M:
            _f(f"{kind}_{n}m", f"{name} {n}M", G_MA, "₹", f"{name} of month-end closes over {n} months.")
            _f(f"{kind}_{n}m_dist", f"Distance from {name} {n}M", G_MA, "%", f"% the close is above/below the {name} {n}M.")
    _f("ma_stack_bull", "MA alignment: bullish", G_MA, "flag", "1 if close > SMA20 > SMA50 > SMA100 > SMA200: cleanly trending up across timeframes.", kind="flag", dec=0)
    _f("ma_stack_bear", "MA alignment: bearish", G_MA, "flag", "1 if close < SMA20 < SMA50 < SMA100 < SMA200.", kind="flag", dec=0)
    _f("ema_stack_bull", "EMA 10 > 20 > 50", G_MA, "flag", "1 if EMA10 > EMA20 > EMA50 (the three lengths the breadth dashboard uses).", kind="flag", dec=0)
    _f("above_ema10", "Close above EMA 10D", G_MA, "flag", "1 if the close is above EMA10.", kind="flag", dec=0)
    _f("above_ema20", "Close above EMA 20D", G_MA, "flag", "1 if the close is above EMA20.", kind="flag", dec=0)
    _f("above_ema50", "Close above EMA 50D", G_MA, "flag", "1 if the close is above EMA50.", kind="flag", dec=0)
    _f("above_sma200", "Close above SMA 200D", G_MA, "flag", "1 if the close is above the 200-day SMA (long-term uptrend).", kind="flag", dec=0)

    # --- crossovers & timing
    _f("gc_50_200d", "Last golden cross 50D/200D", G_CROSS, "periods", "Periods since the 50D SMA crossed above the 200D SMA. 1 = happened today.", dec=0)
    _f("dc_50_200d", "Last death cross 50D/200D", G_CROSS, "periods", "Periods since the 50D SMA crossed below the 200D SMA. 1 = happened today.", dec=0)
    _f("gc_10_30w", "Last golden cross 10W/30W", G_CROSS, "periods", "Weekly bars since the 10W SMA crossed above the 30W SMA. 1 = this week.", dec=0)
    _f("dc_10_30w", "Last death cross 10W/30W", G_CROSS, "periods", "Weekly bars since the 10W SMA crossed below the 30W SMA. 1 = this week.", dec=0)
    _f("macd_chg", "MACD last change", G_CROSS, "periods", "Sessions since the MACD line last crossed its signal line (either way). 1 = today.", dec=0)
    _f("macd_bull_chg", "MACD bullish cross: periods since", G_CROSS, "periods", "Sessions since MACD last crossed *above* its signal line.", dec=0)
    _f("macd_bear_chg", "MACD bearish cross: periods since", G_CROSS, "periods", "Sessions since MACD last crossed *below* its signal line.", dec=0)
    _f("ema_10_20_bull_chg", "EMA10 over EMA20: periods since", G_CROSS, "periods", "Sessions since EMA10 last crossed above EMA20.", dec=0)

    # --- momentum & trend strength
    _f("rsi_14d", "RSI 14D", G_MOM, "0-100", "Relative Strength Index. > 60 strong momentum, > 70 overbought, < 40 weak, < 30 oversold.")
    _f("rsi_14w", "RSI 14W", G_MOM, "0-100", "14-week RSI: sustained multi-month momentum.")
    _f("rsi_12m", "RSI 12M", G_MOM, "0-100", "12-month RSI on month-end closes. Needs about 14 months of history.")
    _f("macd_line", "MACD line (12,26)", G_MOM, "num", "EMA12 minus EMA26. Above 0 = bullish momentum.", dec=3)
    _f("macd_signal", "MACD signal (9)", G_MOM, "num", "9-day EMA of the MACD line.", dec=3)
    _f("macd_hist", "MACD histogram", G_MOM, "num", "MACD line minus signal. Positive = MACD above its signal.", dec=3)
    _f("macd_bull", "MACD above signal", G_MOM, "flag", "1 if the MACD line is above its signal line.", kind="flag", dec=0)
    _f("adx_14d", "ADX 14D", G_MOM, "0-100", "Trend strength (not direction). > 25 strong trend, < 20 range-bound.")
    _f("adx_14w", "ADX 14W", G_MOM, "0-100", "Weekly trend strength.")
    _f("adx_12m", "ADX 12M", G_MOM, "0-100", "Monthly trend strength. Needs about 25 months of history.")
    _f("plus_di_14d", "+DI 14D", G_MOM, "0-100", "Upward directional movement. +DI above -DI = uptrend.")
    _f("minus_di_14d", "-DI 14D", G_MOM, "0-100", "Downward directional movement.")
    _f("stoch_k_14d", "Stochastic %K (14)", G_MOM, "0-100", "Where the close is within the last 14 sessions' range. > 80 overbought, < 20 oversold.")

    # --- relative strength
    for b, bname in BENCH.items():
        for k, lab, _ in CRS_WINDOWS:
            _f(f"crs_{b}_{k}", f"CRS vs {bname} {lab}", G_RS, "%",
               f"Comparative relative strength: stock's {lab} gain relative to the {bname} index, as (1+stock)/(1+index)-1. Positive = outperforming.")
        for k, lab, _ in ALPHA_WINDOWS:
            _f(f"alpha_{b}_{k}", f"Return vs {bname} {lab}", G_RS, "pp", f"Stock's {lab} return minus the {bname} index's, in percentage points.")
    for k, lab, _ in ALPHA_WINDOWS:
        _f(f"alpha_ind_{k}", f"Return vs industry {lab}", G_RS, "pp", f"Stock's {lab} return minus the average of its theme group. Positive = a leader within its group.")
    _f("rs_rating", "RS rating (1-99)", G_RS, "1-99", "Percentile rank of a weighted 3M/6M/9M/12M return against all stocks in the screen (IBD-style). 80+ = market leader.", dec=0)

    # --- volatility stops
    for tf, n, m in VSTOPS:
        unit = {"d": "D", "w": "W", "m": "M"}[tf]
        base = f"VSTOP {n}{unit} {m:g}x"
        k = _vs_key(tf, n, m)
        _f(f"vstop_{k}", base, G_VSTOP, "₹", f"Volatility stop level: a trailing stop {m:g}x ATR({n}) away on {unit} bars. Close above it = uptrend.")
        _f(f"vstop_{k}_up", f"{base}: uptrend", G_VSTOP, "flag", "1 if the close is above the stop (uptrend), 0 if below (downtrend).", kind="flag", dec=0)
        _f(f"vstop_{k}_chg", f"Last {base} change", G_VSTOP, "periods", "Bars since the stop last flipped direction. 1 = flipped on the latest bar (fresh signal).", dec=0)

    # --- volume technicals
    for n in VOL_SMAS:
        _f(f"vol_sma_{n}d", f"Volume SMA {n}D", G_VOL, "#", f"Average daily shares traded over {n} sessions.", dec=0)
    _f("vol_vs_sma20", "Volume vs SMA 20D", G_VOL, "x", "Today's volume divided by the 20-day average (including today). > 2 = volume confirmation.")
    _f("vol_vs_sma50", "Volume vs SMA 50D", G_VOL, "x", "Today's volume divided by the 50-day average.")
    _f("rel_vol", "Relative volume", G_VOL, "x", "Today's volume divided by the average of the previous 20 sessions (same definition as the Stocks page).")
    _f("vol_dryup", "Volume dry-up", G_VOL, "flag", "1 if the last 5 sessions' average volume is under 60% of the 50-day average: selling interest has dried up.", kind="flag", dec=0)
    _f("vol_surge_up", "Volume surge on up day", G_VOL, "flag", "1 if relative volume >= 2 and the stock closed higher: accumulation.", kind="flag", dec=0)
    _f("updown_vol_50d", "Up/down volume ratio 50D", G_VOL, "x", "Volume on up days / volume on down days over 50 sessions. > 1.5 = accumulation.")

    # --- patterns & custom
    _f("minervini_score", "Trend template score (0-8)", G_CUSTOM, "0-8",
       "Minervini-style checks passed: close > SMA150 & SMA200, SMA150 > SMA200, SMA200 rising, SMA50 > SMA150, close > SMA50, 30%+ above 52W low, within 25% of 52W high.", dec=0)
    _f("minervini_pass", "Trend template (all pass)", G_CUSTOM, "flag", "1 if all eight trend-template checks pass AND the RS rating is 70 or more.", kind="flag", dec=0)
    _f("ext_atr_50", "Extension from SMA50 (ATRs)", G_CUSTOM, "ATR", "Distance from the 50D SMA measured in ATRs. > 7-8 = stretched, a pullback is likely.")
    _f("bb_width", "Bollinger bandwidth", G_CUSTOM, "%", "Width of the 20,2 Bollinger Bands as % of the middle band: how tight the stock is coiling.")
    _f("bb_pctb", "Bollinger %B", G_CUSTOM, "0-1", "Position of the close inside the Bollinger Bands (0 = lower band, 1 = upper).")
    _f("bb_squeeze", "Bollinger squeeze", G_CUSTOM, "flag", "1 if bandwidth is in the lowest 20% of the last 120 sessions: volatility compression before a move.", kind="flag", dec=0)
    _f("nr7", "Narrowest range of 7 (NR7)", G_CUSTOM, "flag", "1 if today's high-low range is the smallest of the last 7 sessions.", kind="flag", dec=0)
    _f("inside_bar", "Inside bar", G_CUSTOM, "flag", "1 if today's range sits inside yesterday's range.", kind="flag", dec=0)
    _f("streak", "Up/down streak", G_CUSTOM, "days", "Consecutive higher closes (positive) or lower closes (negative).", dec=0)
    _f("vcp_tight", "Range contraction (5D / 20D)", G_CUSTOM, "x", "Average daily range of the last 5 sessions over the last 20. Under 0.6 = a tightening, VCP-like base.")
    _f("pullback_ema20", "Pullback to EMA20 in uptrend", G_CUSTOM, "flag", "1 if the stock is in an uptrend (close > SMA50 > SMA200) and today's low touched within 1% of EMA20.", kind="flag", dec=0)


_register()
META_COLS = ["symbol", "bucket", "group"]
COLUMNS = META_COLS + [f["key"] for f in FIELDS]


# ----------------------------------------------------------------------------- indicator maths (wide frames: sessions x symbols)

def sma(df: pd.DataFrame, n: int) -> pd.DataFrame:
    return df.rolling(n, min_periods=n).mean()


def ema(df: pd.DataFrame, n: int) -> pd.DataFrame:
    return df.ewm(span=n, adjust=False, min_periods=n).mean()


def rma(df: pd.DataFrame, n: int) -> pd.DataFrame:
    """Wilder's smoothing."""
    return df.ewm(alpha=1.0 / n, adjust=False, min_periods=n).mean()


def true_range(h: pd.DataFrame, l: pd.DataFrame, c: pd.DataFrame) -> pd.DataFrame:
    pc = c.shift(1)
    return np.maximum(np.maximum(h - l, (h - pc).abs()), (l - pc).abs())


def rsi(c: pd.DataFrame, n: int = 14) -> pd.DataFrame:
    d = c.diff()
    au, ad = rma(d.clip(lower=0), n), rma((-d).clip(lower=0), n)
    out = 100 - 100 / (1 + au / ad)
    out = out.where(ad != 0, 100.0)            # no losses at all -> 100
    return out.where(au.notna() & ad.notna())


def dmi(h: pd.DataFrame, l: pd.DataFrame, c: pd.DataFrame, n: int = 14):
    up, dn = h.diff(), -l.diff()
    pdm = up.where((up > dn) & (up > 0), 0.0).where(up.notna() & dn.notna())
    mdm = dn.where((dn > up) & (dn > 0), 0.0).where(up.notna() & dn.notna())
    atr = rma(true_range(h, l, c), n)
    pdi, mdi = 100 * rma(pdm, n) / atr, 100 * rma(mdm, n) / atr
    dx = 100 * (pdi - mdi).abs() / (pdi + mdi)
    return pdi, mdi, rma(dx, n)


def bars_since(event: pd.DataFrame) -> pd.Series:
    """Periods since the last True per column; 1 = it happened on the latest bar, NaN = never."""
    a = event.to_numpy(dtype=bool)
    t = a.shape[0]
    idx = np.where(a, np.arange(t)[:, None], -1).max(axis=0)
    return pd.Series(np.where(idx >= 0, t - idx, np.nan), index=event.columns)


def cross_up(a: pd.DataFrame, b: pd.DataFrame) -> pd.DataFrame:
    return (a > b) & (a.shift(1) <= b.shift(1))


def cross_down(a: pd.DataFrame, b: pd.DataFrame) -> pd.DataFrame:
    return (a < b) & (a.shift(1) >= b.shift(1))


def vstop(close: pd.DataFrame, atr: pd.DataFrame, mult: float) -> tuple[pd.Series, pd.Series, pd.Series]:
    """TradingView-style Volatility Stop on closes. Returns (stop level, uptrend flag, bars since last flip)."""
    c, a = close.to_numpy(float), atr.to_numpy(float) * mult
    t, s = c.shape
    mx, mn, st = np.full(s, np.nan), np.full(s, np.nan), np.full(s, np.nan)
    up = np.ones(s, dtype=bool)
    started = np.zeros(s, dtype=bool)
    last_flip = np.full(s, -1)
    for i in range(t):
        ok = ~np.isnan(c[i]) & ~np.isnan(a[i])
        first = ok & ~started
        mx[first], mn[first], st[first] = c[i][first], c[i][first], c[i][first]
        started |= first
        run = ok & ~first
        if not run.any():
            continue
        mx = np.where(run, np.fmax(mx, c[i]), mx)
        mn = np.where(run, np.fmin(mn, c[i]), mn)
        st_new = np.where(up, np.fmax(st, mx - a[i]), np.fmin(st, mn + a[i]))
        up_new = c[i] - st_new >= 0
        flip = run & (up_new != up)
        mx, mn = np.where(flip, c[i], mx), np.where(flip, c[i], mn)
        st_new = np.where(flip, np.where(up_new, c[i] - a[i], c[i] + a[i]), st_new)
        st = np.where(run, st_new, st)
        up = np.where(run, up_new, up)
        last_flip[flip] = i
    cols = close.columns
    since = np.where(last_flip >= 0, t - last_flip, np.nan)
    return pd.Series(st, index=cols), pd.Series(np.where(started, up.astype(float), np.nan), index=cols), pd.Series(since, index=cols)


def _tail_stats(h: pd.DataFrame, l: pd.DataFrame, w: int | None, min_bars: int = 20):
    """Highest high / lowest low over the last ``w`` sessions plus sessions since each (0 = today)."""
    hv, lv = h.to_numpy(float), l.to_numpy(float)
    if w is not None:
        hv, lv = hv[-w:], lv[-w:]
    cnt = (~np.isnan(hv)).sum(axis=0)
    ok = cnt >= min_bars
    if w is not None and h.shape[0] < 0.75 * w:     # not enough history for a long window: leave empty
        ok = np.zeros_like(ok)
    hi = np.where(ok, np.nanmax(np.where(np.isnan(hv), -np.inf, hv), axis=0), np.nan)
    lo = np.where(ok, np.nanmin(np.where(np.isnan(lv), np.inf, lv), axis=0), np.nan)
    hi_days = np.argmax(np.where(np.isnan(hv), -np.inf, hv)[::-1], axis=0).astype(float)
    lo_days = np.argmin(np.where(np.isnan(lv), np.inf, lv)[::-1], axis=0).astype(float)
    return (pd.Series(hi, index=h.columns), pd.Series(lo, index=h.columns),
            pd.Series(np.where(ok, hi_days, np.nan), index=h.columns), pd.Series(np.where(ok, lo_days, np.nan), index=h.columns))


def _resample(o, h, l, c, v, rule: str):
    r = lambda df, how: getattr(df.resample(rule), how)()
    out = (r(o, "first"), r(h, "max"), r(l, "min"), r(c, "last"), r(v, "sum"))
    keep = out[3].notna().any(axis=1)
    return tuple(x[keep] for x in out)


def _flag(s: pd.Series) -> pd.Series:
    return s.astype(float)


def _index_returns(c: pd.DataFrame, members: pd.Series) -> pd.Series:
    """Equal-weight index level of ``members`` (daily mean return, jump-guarded and winsorised)."""
    cm = c.loc[:, members[members].index]
    ratio = cm / cm.shift(1)
    r = (ratio - 1).where((ratio > JUMP_LOW) & (ratio < JUMP_HIGH)).clip(-0.2, 0.2)
    return (1 + r.mean(axis=1).fillna(0.0)).cumprod()


def _win_ret(idx: pd.Series, w: int) -> float:
    return float(idx.iloc[-1] / idx.iloc[-1 - w] - 1) if len(idx) > w else np.nan


def compute(o: pd.DataFrame, h: pd.DataFrame, l: pd.DataFrame, c: pd.DataFrame, v: pd.DataFrame,
            bucket: pd.Series, group: pd.Series, in_breadth: pd.Series) -> tuple[pd.DataFrame, dict[str, Any]]:
    """All fields for every column (symbol) of the wide frames, as of the last row."""
    cols = list(c.columns)
    out: dict[str, pd.Series] = {}
    last = lambda df: df.iloc[-1]               # noqa: E731
    pct = lambda a, b: (a / b - 1) * 100        # noqa: E731
    T = c.shape[0]

    close, opn, high, low, vol = last(c), last(o), last(h), last(l), last(v)
    prev_c = c.iloc[-2] if T > 1 else close * np.nan
    out.update(close=close, open=opn, high=high, low=low, volume=vol)
    for k, _, w in RET_WINDOWS:
        out[f"ret_{k}"] = pct(close, c.iloc[-1 - w]) if T > w else close * np.nan
    out["tv_20d_cr"] = (c * v).tail(20).median() / 1e7
    atr14 = rma(true_range(h, l, c), 14)
    out["atr_pct_14d"] = last(atr14) / close * 100
    out["history_days"] = c.notna().sum().astype(float)
    out["traded_today"] = _flag(v.iloc[-1] > 0)
    step = c / c.shift(1)
    out["jump_1y"] = _flag(((step < JUMP_LOW) | (step > JUMP_HIGH)).tail(252).any())
    out["in_breadth"] = _flag(in_breadth.reindex(cols).fillna(False))

    # highs / lows
    for k, _, w in HL_WINDOWS:
        hi, lo, hd, ld = _tail_stats(h, l, w)
        out[f"high_{k}"], out[f"low_{k}"] = hi, lo
        out[f"high_{k}_dist"], out[f"low_{k}_dist"] = (hi - close) / hi * 100, (close - lo) / lo * 100
        out[f"high_{k}_days"], out[f"low_{k}_days"] = hd, ld
    rng = out["high_52w"] - out["low_52w"]
    out["range_pos_52w"] = (close - out["low_52w"]) / rng.where(rng > 0) * 100

    # moving averages
    s = {n: sma(c, n) for n in sorted(set(SMA_D) | {150, 20, 50})}
    e = {n: ema(c, n) for n in EMA_D}
    for n in SMA_D:
        out[f"sma_{n}d"], out[f"sma_{n}d_dist"] = last(s[n]), pct(close, last(s[n]))
    for n in EMA_D:
        out[f"ema_{n}d"], out[f"ema_{n}d_dist"] = last(e[n]), pct(close, last(e[n]))
    ow, hw, lw, cw, vw = _resample(o, h, l, c, v, "W-FRI")
    om, hm, lm, cm, vm = _resample(o, h, l, c, v, "ME")
    sw = {n: sma(cw, n) for n in SMA_W}
    for n in SMA_W:
        out[f"sma_{n}w"], out[f"sma_{n}w_dist"] = last(sw[n]), pct(close, last(sw[n]))
    for n in EMA_W:
        m = ema(cw, n)
        out[f"ema_{n}w"], out[f"ema_{n}w_dist"] = last(m), pct(close, last(m))
    for n in MA_M:
        a, b = sma(cm, n), ema(cm, n)
        out[f"sma_{n}m"], out[f"sma_{n}m_dist"] = last(a), pct(close, last(a))
        out[f"ema_{n}m"], out[f"ema_{n}m_dist"] = last(b), pct(close, last(b))
    out["ma_stack_bull"] = _flag((close > out["sma_20d"]) & (out["sma_20d"] > out["sma_50d"]) & (out["sma_50d"] > out["sma_100d"]) & (out["sma_100d"] > out["sma_200d"]))
    out["ma_stack_bear"] = _flag((close < out["sma_20d"]) & (out["sma_20d"] < out["sma_50d"]) & (out["sma_50d"] < out["sma_100d"]) & (out["sma_100d"] < out["sma_200d"]))
    out["ema_stack_bull"] = _flag((out["ema_10d"] > out["ema_20d"]) & (out["ema_20d"] > out["ema_50d"]))
    for n in (10, 20, 50):
        out[f"above_ema{n}"] = _flag(close > out[f"ema_{n}d"])
    out["above_sma200"] = _flag(close > out["sma_200d"])

    # momentum
    out["rsi_14d"] = last(rsi(c, 14))
    out["rsi_14w"] = last(rsi(cw, 14))
    out["rsi_12m"] = last(rsi(cm, 12))
    macd = ema(c, 12) - ema(c, 26)
    sig = ema(macd, 9)
    out["macd_line"], out["macd_signal"], out["macd_hist"] = last(macd), last(sig), last(macd - sig)
    out["macd_bull"] = _flag(last(macd) > last(sig))
    pdi, mdi, adx = dmi(h, l, c, 14)
    out["adx_14d"], out["plus_di_14d"], out["minus_di_14d"] = last(adx), last(pdi), last(mdi)
    out["adx_14w"] = last(dmi(hw, lw, cw, 14)[2])
    out["adx_12m"] = last(dmi(hm, lm, cm, 14)[2]) if len(cm) >= 14 else close * np.nan
    hh14, ll14 = h.rolling(14, min_periods=14).max(), l.rolling(14, min_periods=14).min()
    out["stoch_k_14d"] = last((c - ll14) / (hh14 - ll14).where(hh14 > ll14) * 100)

    # crossovers
    out["gc_50_200d"] = bars_since(cross_up(s[50], sma(c, 200)))
    out["dc_50_200d"] = bars_since(cross_down(s[50], sma(c, 200)))
    out["gc_10_30w"] = bars_since(cross_up(sw[10], sw[30]))
    out["dc_10_30w"] = bars_since(cross_down(sw[10], sw[30]))
    out["macd_bull_chg"] = bars_since(cross_up(macd, sig))
    out["macd_bear_chg"] = bars_since(cross_down(macd, sig))
    out["macd_chg"] = pd.concat([out["macd_bull_chg"], out["macd_bear_chg"]], axis=1).min(axis=1)
    out["ema_10_20_bull_chg"] = bars_since(cross_up(e[10], e[20]))

    # relative strength vs benchmarks (equal-weight proxies built from this very screen)
    traded = last(v) > 0
    idx = {"mkt": _index_returns(c, traded & in_breadth.reindex(cols).fillna(False)),
           "lc": _index_returns(c, traded & (bucket.reindex(cols) == "LARGECAP"))}
    bench_info: dict[str, Any] = {}
    for b, ix in idx.items():
        bench_info[b] = {"label": BENCH[b], "members": int(((traded & in_breadth.reindex(cols).fillna(False)) if b == "mkt" else (traded & (bucket.reindex(cols) == "LARGECAP"))).sum()),
                         "returns": {k: (None if np.isnan(_win_ret(ix, w)) else round(_win_ret(ix, w) * 100, 2)) for k, _, w in ALPHA_WINDOWS}}
        for k, _, w in CRS_WINDOWS:
            sr = (c.iloc[-1] / c.iloc[-1 - w] - 1) if T > w else close * np.nan
            br = _win_ret(ix, w)
            out[f"crs_{b}_{k}"] = ((1 + sr) / (1 + br) - 1) * 100
        for k, _, w in ALPHA_WINDOWS:
            sr = (c.iloc[-1] / c.iloc[-1 - w] - 1) if T > w else close * np.nan
            out[f"alpha_{b}_{k}"] = (sr - _win_ret(ix, w)) * 100
    grp = group.reindex(cols)
    for k, _, w in ALPHA_WINDOWS:
        sr = (c.iloc[-1] / c.iloc[-1 - w] - 1) * 100 if T > w else close * np.nan
        gmean = sr.groupby(grp).transform("mean")
        out[f"alpha_ind_{k}"] = (sr - gmean).where(grp.notna())
    comp, wsum = pd.Series(0.0, index=cols), pd.Series(0.0, index=cols)
    for w, wt in ((63, 0.4), (126, 0.2), (189, 0.2), (252, 0.2)):
        if T > w:
            r = c.iloc[-1] / c.iloc[-1 - w] - 1
            comp, wsum = comp + r.fillna(0) * wt, wsum + r.notna() * wt
    comp = (comp / wsum.where(wsum > 0))
    elig = traded & (out["history_days"] >= 63)
    rank = comp.where(elig).rank(pct=True)
    out["rs_rating"] = (rank * 98 + 1).round()

    # volatility stops
    frames = {"d": (h, l, c), "w": (hw, lw, cw), "m": (hm, lm, cm)}
    for tf, n, m in VSTOPS:
        fh, fl, fc = frames[tf]
        if len(fc) <= n + 2:
            lvl = up = chg = close * np.nan
        else:
            lvl, up, chg = vstop(fc, rma(true_range(fh, fl, fc), n), m)
        k = _vs_key(tf, n, m)
        out[f"vstop_{k}"], out[f"vstop_{k}_up"], out[f"vstop_{k}_chg"] = lvl, up, chg

    # volume
    for n in VOL_SMAS:
        out[f"vol_sma_{n}d"] = last(sma(v, n))
    out["vol_vs_sma20"] = vol / out["vol_sma_20d"].where(out["vol_sma_20d"] > 0)
    out["vol_vs_sma50"] = vol / out["vol_sma_50d"].where(out["vol_sma_50d"] > 0)
    prior20 = v.shift(1).rolling(20, min_periods=10).mean()
    out["rel_vol"] = vol / last(prior20).where(last(prior20) > 0)
    out["vol_dryup"] = _flag(last(sma(v, 5)) < 0.6 * out["vol_sma_50d"])
    out["vol_surge_up"] = _flag((out["rel_vol"] >= 2) & (close > prev_c))
    d = c.diff()
    upv, dnv = v.where(d > 0, 0.0).tail(50).sum(), v.where(d < 0, 0.0).tail(50).sum()
    out["updown_vol_50d"] = upv / dnv.where(dnv > 0)

    # gap / breakout / new highs
    out["gap_open_pct"] = pct(opn, prev_c)
    out["gap_up"], out["gap_down"] = _flag(out["gap_open_pct"] >= 2), _flag(out["gap_open_pct"] <= -2)
    for n in (20, 50):
        out[f"new_high_{n}d"] = _flag(high >= h.tail(n).max())
        out[f"new_low_{n}d"] = _flag(low <= l.tail(n).min())
    out["breakout_window"] = _flag((out["high_52w_dist"] <= 3) & (close > out["ema_20d"]) & (close > out["sma_50d"]) & (out["rsi_14d"] >= 55))

    # custom
    s150, s200 = last(s[150]), out["sma_200d"]
    s200_prev = sma(c, 200).iloc[-22] if T > 221 else close * np.nan
    checks = [close > s150, close > s200, s150 > s200, s200 > s200_prev, out["sma_50d"] > s150, close > out["sma_50d"],
              close >= 1.3 * out["low_52w"], close >= 0.75 * out["high_52w"]]
    out["minervini_score"] = sum(ck.fillna(False).astype(float) for ck in checks)
    out["minervini_pass"] = _flag((out["minervini_score"] == 8) & (out["rs_rating"] >= 70))
    out["ext_atr_50"] = (close - out["sma_50d"]) / last(atr14).where(last(atr14) > 0)
    mid, sd = s[20], c.rolling(20, min_periods=20).std(ddof=0)
    bw = (4 * sd / mid * 100)
    out["bb_width"] = last(bw)
    out["bb_pctb"] = (close - (last(mid) - 2 * last(sd))) / (4 * last(sd)).where(last(sd) > 0)
    bw120 = bw.tail(120)
    out["bb_squeeze"] = _flag((bw120.rank(pct=True).iloc[-1] <= 0.2) & (bw120.count() >= 60))
    rng_d = h - l
    out["nr7"] = _flag(rng_d.iloc[-1] <= rng_d.tail(7).min()) if T >= 7 else close * np.nan
    out["inside_bar"] = _flag((high <= h.iloc[-2]) & (low >= l.iloc[-2])) if T > 1 else close * np.nan
    sign = np.sign(d.tail(260).to_numpy())
    streak = np.zeros(sign.shape[1])
    alive = np.ones(sign.shape[1], dtype=bool)
    cur = sign[-1]
    for i in range(sign.shape[0] - 1, -1, -1):
        alive &= (sign[i] == cur) & (cur != 0)
        streak += alive
    out["streak"] = pd.Series(streak * cur, index=cols)
    out["vcp_tight"] = rng_d.tail(5).mean() / rng_d.tail(20).mean().where(rng_d.tail(20).mean() > 0)
    out["pullback_ema20"] = _flag((close > out["sma_50d"]) & (out["sma_50d"] > s200) & (low <= out["ema_20d"] * 1.01) & (high >= out["ema_20d"] * 0.99))

    df = pd.DataFrame({k: out[k].reindex(cols) if k in out else np.nan for k in [f["key"] for f in FIELDS]})
    df.index = cols
    missing = [f["key"] for f in FIELDS if f["key"] not in out]
    if missing:
        log.warning("screener: %d field(s) not computed: %s", len(missing), missing[:8])
    return df, bench_info


# ----------------------------------------------------------------------------- run

def _wide(df: pd.DataFrame, col: str, dates: list[date], symbols: list[str]) -> pd.DataFrame:
    w = df.pivot(index="date", columns="symbol", values=col).reindex(index=dates, columns=symbols).astype("float64")
    w.index = pd.DatetimeIndex(pd.to_datetime(w.index))
    return w


def _clean(v: Any, dec: int) -> Any:
    if v is None or (isinstance(v, float) and not np.isfinite(v)):
        return None
    return int(round(v)) if dec == 0 else round(float(v), dec)


def run(status=None) -> dict[str, Any]:
    short = {date.fromisoformat(x) for x in ingest.load_calendar_config().get("short_sessions", [])}
    sessions = [d for d in store.archived_dates() if d not in short]
    out_dir = paths.screener_dir()
    if not sessions:
        store.atomic_write_text(out_dir / "screener_latest.json", json.dumps({"generated_at": now_iso(), "date": None, "rows": [], "columns": COLUMNS,
                                                                                 "fields": FIELDS, "note": "no price data yet"}))
        return {"stocks": 0, "date": None}
    latest = sessions[-1]

    # universe = the breadth table for the latest session (bucket + validity)
    day_file = paths.day_detail_file(latest)
    if not day_file.exists():
        try:
            from . import pipeline
            from .status import StatusStore
            pipeline.day_detail(StatusStore(autosave=False), latest)
        except Exception:  # noqa: BLE001
            log.warning("screener: could not build the %s breadth table; using every traded symbol", latest)
    prices = store.load_prices(dates=sessions)
    if day_file.exists():
        day = pd.read_csv(day_file)
        bucket = pd.Series(day["bucket"].to_numpy(), index=day["symbol"])
        valid = pd.Series(day["valid"].astype(str).str.lower().isin(["true", "1"]).to_numpy(), index=day["symbol"])
    else:
        syms = sorted(prices.loc[prices["date"] == latest, "symbol"].unique())
        bucket, valid = pd.Series(None, index=syms, dtype=object), pd.Series(True, index=syms)
    symbols = sorted(set(bucket.index) & set(prices["symbol"].unique()))

    avail = set(prices["symbol"].unique())
    cfg = themes.load_config()
    tf = paths.themes_file()
    grp_map: dict[str, str] = {}
    if tf.exists():
        groups, _, _ = themes.resolve_symbols(themes.parse_themes(tf.read_text(encoding="utf-8")), avail, cfg.get("aliases"))
        for name, members in groups.items():
            for s in members:
                grp_map.setdefault(s, name)
    prices = prices[prices["symbol"].isin(symbols)].drop_duplicates(["date", "symbol"], keep="last")
    adj = adjust.adjust_ohlcv(prices, adjust.load_splits(avail, write_report=False))
    adj = adj[pd.to_numeric(adj["volume"], errors="coerce") > 0]
    o, h, l, c, v = (_wide(adj, f"adj_{k}", sessions, symbols) for k in ("open", "high", "low", "close", "volume"))
    c = c.ffill()
    o, h, l = o.fillna(c).where(c.notna()), h.fillna(c).where(c.notna()), l.fillna(c).where(c.notna())
    traded_last = v.iloc[-1] > 0
    v = v.fillna(0.0).where(c.notna())

    df, bench = compute(o, h, l, c, v, bucket.reindex(symbols), pd.Series(grp_map).reindex(symbols), valid.reindex(symbols))
    df["traded_today"] = traded_last.reindex(symbols).astype(float)

    decs = {f["key"]: f["dec"] for f in FIELDS}
    rows = []
    for sym in symbols:
        r = df.loc[sym]
        rows.append([sym, bucket.get(sym), grp_map.get(sym)] + [_clean(r[k], decs[k]) for k in df.columns])
    for f in FIELDS:
        if f["key"].startswith("high_ath") or f["key"].startswith("low_ath"):
            f["desc"] = f["desc"].replace("since the archive starts", f"since the archive starts ({sessions[0].isoformat()})")
    payload = {"generated_at": now_iso(), "date": latest.isoformat(), "archive_start": sessions[0].isoformat(), "n_sessions": len(sessions),
               "n_stocks": len(rows), "bench": bench, "fields": FIELDS, "columns": COLUMNS, "rows": rows}
    store.atomic_write_text(out_dir / "screener_latest.json", json.dumps(payload, separators=(",", ":"), allow_nan=False, default=store._json_default))
    log.info("screener: %d stocks x %d fields as of %s", len(rows), len(FIELDS), latest)
    return {"stocks": len(rows), "fields": len(FIELDS), "date": latest.isoformat()}
