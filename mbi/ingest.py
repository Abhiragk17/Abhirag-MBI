"""Bhavcopy download/parse/archive with the fallback chain from spec section 9.

Primary   : CM-UDiFF bhavcopy (from 2024-07-08) or the legacy cmDDMONYYYYbhav file.
Fallback 1: NSE historical/cm/equity API, per symbol in the universe.
Fallback 2: yfinance (SYMBOL.NS) for whatever is still missing.
Otherwise : day marked failed/partial and retried on the next scheduled run.
"""
from __future__ import annotations

import io
import logging
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any

import pandas as pd

from . import paths, store, universe
from .nse_client import NSEClient, NSEError, NSENotFound
from .status import StatusStore

log = logging.getLogger(__name__)

IST = timezone(timedelta(hours=5, minutes=30))
UDIFF_URL = "https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{ymd}_F_0000.csv.zip"
LEGACY_URL = "https://nsearchives.nseindia.com/content/historical/EQUITIES/{yyyy}/{mon}/cm{dd}{mon}{yyyy}bhav.csv.zip"
UDIFF_START = date(2024, 7, 8)
KEEP_SERIES = {"EQ", "BE", "BZ", "RR", "IV"}  # RR/IV: REITs / InvITs that sit inside the Nifty index lists
PUBLISH_CUTOFF_IST = (21, 0)  # before this, a 404 for *today* means "not published yet"

DEFAULT_CALENDAR = {
    "_comment": ("extra_sessions: weekend dates that were full trading sessions. "
                 "short_sessions: archived but skipped in the indicator maths (e.g. Muhurat). Verify before relying on them."),
    "extra_sessions": ["2024-01-20", "2025-02-01"],
    "short_sessions": ["2021-11-04", "2022-10-24", "2023-11-12", "2024-11-01", "2025-10-21"],
}


def now_ist() -> datetime:
    return datetime.now(IST)


# --------------------------------------------------------------------------- parsing

def _read_zip_csv(content: bytes) -> pd.DataFrame:
    with zipfile.ZipFile(io.BytesIO(content)) as z:
        name = next(n for n in z.namelist() if n.lower().endswith(".csv"))
        with z.open(name) as f:
            return pd.read_csv(f)


def _finish(df: pd.DataFrame, d: date, source: str) -> pd.DataFrame:
    df = df.copy()
    df["symbol"] = df["symbol"].astype(str).str.strip().str.upper()
    df["series"] = df["series"].astype(str).str.strip().str.upper()
    df["isin"] = df["isin"].astype(str).str.strip().str.upper()
    for c in ("open", "high", "low", "close", "prev_close", "volume", "traded_value", "trades"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df[df["series"].isin(KEEP_SERIES) & df["isin"].str.startswith("INE")]
    # prefer EQ when a symbol trades in two series
    df = df.assign(_o=(df["series"] != "EQ").astype(int)).sort_values(["symbol", "_o"])
    df = df.drop_duplicates("symbol").drop(columns="_o")
    df["date"] = d
    df["source"] = source
    df["bucket"] = None
    return df[store.PRICE_COLUMNS].reset_index(drop=True)


def parse_udiff(content: bytes, d: date) -> pd.DataFrame:
    raw = _read_zip_csv(content)
    raw.columns = [c.strip() for c in raw.columns]
    df = pd.DataFrame({
        "symbol": raw["TckrSymb"], "series": raw["SctySrs"], "isin": raw["ISIN"],
        "open": raw["OpnPric"], "high": raw["HghPric"], "low": raw["LwPric"],
        "close": raw["ClsPric"], "prev_close": raw["PrvsClsgPric"],
        "volume": raw["TtlTradgVol"], "traded_value": raw["TtlTrfVal"],
        "trades": raw.get("TtlNbOfTxsExctd"),
    })
    return _finish(df, d, "nse_bhavcopy")


def parse_legacy(content: bytes, d: date) -> pd.DataFrame:
    raw = _read_zip_csv(content)
    raw.columns = [c.strip().upper() for c in raw.columns]
    df = pd.DataFrame({
        "symbol": raw["SYMBOL"], "series": raw["SERIES"], "isin": raw["ISIN"],
        "open": raw["OPEN"], "high": raw["HIGH"], "low": raw["LOW"], "close": raw["CLOSE"],
        "prev_close": raw["PREVCLOSE"], "volume": raw["TOTTRDQTY"], "traded_value": raw["TOTTRDVAL"],
        "trades": raw.get("TOTALTRADES"),
    })
    return _finish(df, d, "nse_bhavcopy")


def fetch_bhavcopy(client: NSEClient, d: date) -> pd.DataFrame | None:
    """Return the parsed day, or None when every URL answered 404 (no session / not published)."""
    udiff = (UDIFF_URL.format(ymd=d.strftime("%Y%m%d")), parse_udiff)
    mon = d.strftime("%b").upper()
    legacy = (LEGACY_URL.format(yyyy=d.year, mon=mon, dd=d.strftime("%d")), parse_legacy)
    order = [udiff, legacy] if d >= UDIFF_START else [legacy, udiff]
    for url, parser in order:
        try:
            content = client.get(url, kind="bytes")
        except NSENotFound:
            continue
        return parser(content, d)
    return None


# --------------------------------------------------------------------------- fallbacks

def fetch_from_nse_api(client: NSEClient, d: date, symbols: list[str]) -> tuple[pd.DataFrame, list[str]]:
    rows, missing = [], []
    ds = d.strftime("%d-%m-%Y")
    for i, sym in enumerate(symbols, 1):
        try:
            js = client.get(f"{NSEClient.BASE_URL}/api/historical/cm/equity",
                            params={"symbol": sym, "series": '["EQ","BE"]', "from": ds, "to": ds})
            data = [r for r in js.get("data", []) if r.get("CH_SERIES") in KEEP_SERIES]
            if not data:
                missing.append(sym)
                continue
            r = data[0]
            rows.append({
                "symbol": sym, "series": r.get("CH_SERIES"), "isin": r.get("CH_ISIN", "INE"),
                "open": r.get("CH_OPENING_PRICE"), "high": r.get("CH_TRADE_HIGH_PRICE"),
                "low": r.get("CH_TRADE_LOW_PRICE"), "close": r.get("CH_CLOSING_PRICE"),
                "prev_close": r.get("CH_PREVIOUS_CLS_PRICE"), "volume": r.get("CH_TOT_TRADED_QTY"),
                "traded_value": r.get("CH_TOT_TRADED_VAL"), "trades": r.get("CH_TOTAL_TRADES"),
            })
        except (NSEError, AttributeError, KeyError) as e:
            missing.append(sym)
            if isinstance(e, NSEError) and e.network_down:
                missing.extend(symbols[i:])
                break
        if i % 100 == 0:
            log.info("nse_api fallback: %d/%d symbols", i, len(symbols))
    df = pd.DataFrame(rows)
    if len(df):
        df["isin"] = df["isin"].fillna("INE").replace("", "INE")
        df = _finish(df, d, "nse_api")
    return df, missing


def fetch_from_yfinance(d: date, symbols: list[str]) -> tuple[pd.DataFrame, list[str]]:
    if not symbols:
        return pd.DataFrame(columns=store.PRICE_COLUMNS), []
    try:
        import yfinance as yf  # type: ignore
    except ImportError:
        return pd.DataFrame(columns=store.PRICE_COLUMNS), list(symbols)
    tickers = [f"{s}.NS" for s in symbols]
    try:
        data = yf.download(tickers, start=(d - timedelta(days=7)).isoformat(),
                           end=(d + timedelta(days=1)).isoformat(), group_by="ticker",
                           auto_adjust=False, progress=False, threads=True)
    except Exception as e:  # noqa: BLE001
        log.warning("yfinance download failed: %s", e)
        return pd.DataFrame(columns=store.PRICE_COLUMNS), list(symbols)
    rows, missing = [], []
    for sym, t in zip(symbols, tickers):
        try:
            sub = data[t] if len(tickers) > 1 else data
            sub = sub.dropna(how="all")
            sub.index = pd.to_datetime(sub.index).date
            if d not in sub.index:
                missing.append(sym)
                continue
            prev = sub[sub.index < d]
            r = sub.loc[d]
            close = float(r["Close"])
            rows.append({
                "symbol": sym, "series": "EQ", "isin": "INE", "open": r["Open"], "high": r["High"],
                "low": r["Low"], "close": close,
                "prev_close": float(prev["Close"].iloc[-1]) if len(prev) else None,
                "volume": r["Volume"], "traded_value": close * float(r["Volume"]), "trades": None,
            })
        except (KeyError, TypeError, ValueError):
            missing.append(sym)
    df = _finish(pd.DataFrame(rows), d, "yfinance") if rows else pd.DataFrame(columns=store.PRICE_COLUMNS)
    return df, missing


# --------------------------------------------------------------------------- calendar

class TradingCalendar:
    def __init__(self, holidays: set[date], source: str, extra: set[date], short: set[date],
                 years_known: set[int]):
        self.holidays = holidays
        self.source = source
        self.extra = extra
        self.short = short
        self.years_known = years_known
        self.no_session = {date.fromisoformat(x) for x in (store.read_json(paths.no_session_file(), []) or [])}

    def knows(self, d: date) -> bool:
        return d.year in self.years_known

    def is_candidate(self, d: date) -> bool:
        if d in self.extra:
            return True
        if d.weekday() >= 5 or d in self.holidays or d in self.no_session:
            return False
        return True

    def says_trading(self, d: date) -> bool | None:
        """True/False when the official calendar covers ``d``; None when unknown."""
        if not self.knows(d):
            return None
        return self.is_candidate(d)

    def mark_no_session(self, d: date) -> None:
        self.no_session.add(d)
        store.atomic_write_json(paths.no_session_file(), sorted(x.isoformat() for x in self.no_session))


def load_calendar_config() -> dict[str, Any]:
    p = paths.calendar_config()
    if not p.exists():
        store.atomic_write_json(p, DEFAULT_CALENDAR)
    cfg = store.read_json(p, DEFAULT_CALENDAR) or DEFAULT_CALENDAR
    return cfg


def load_calendar(client: NSEClient | None, status: StatusStore | None, *, offline: bool = False) -> TradingCalendar:
    cfg = load_calendar_config()
    extra = {date.fromisoformat(x) for x in cfg.get("extra_sessions", [])}
    short = {date.fromisoformat(x) for x in cfg.get("short_sessions", [])}
    cache = store.read_json(paths.holidays_cache(), {}) or {}
    source, note = "cache", None
    if client is not None and not offline:
        try:
            js = client.get(f"{NSEClient.BASE_URL}/api/holiday-master", params={"type": "trading"})
            hol = []
            for r in js.get("CM", []):
                try:
                    hol.append(datetime.strptime(r["tradingDate"], "%d-%b-%Y").date())
                except (KeyError, ValueError):
                    continue
            if hol:
                years: dict[str, list[str]] = {}
                for h in hol:
                    years.setdefault(str(h.year), []).append(h.isoformat())
                cache.update({y: sorted(v) for y, v in years.items()})
                cache["_fetched_at"] = datetime.now().isoformat(timespec="seconds")
                store.atomic_write_json(paths.holidays_cache(), cache)
                source = "nse"
        except NSEError as e:
            note = f"holiday calendar fetch failed ({e}); using cached calendar"
    if source != "nse":
        if not any(k.isdigit() for k in cache):
            source = "weekday_assumption"
            note = (note or "no holiday calendar") + "; assuming weekday sessions, a 404 means no session"
        elif note is None:
            note = "using cached holiday calendar (offline)"
    holidays = {date.fromisoformat(x) for k, v in cache.items() if k.isdigit() for x in v}
    years_known = {int(k) for k in cache if k.isdigit()}
    if status is not None:
        status.set_calendar(source, note)
    return TradingCalendar(holidays, source, extra, short, years_known)


def candidate_dates(cal: TradingCalendar, start: date, end: date) -> list[date]:
    out, d = [], start
    while d <= end:
        if cal.is_candidate(d):
            out.append(d)
        d += timedelta(days=1)
    return out


def latest_expected_session(now: datetime | None = None) -> date:
    """The daily job runs after ~6:30 PM IST; before that, today's file is not expected."""
    now = now or now_ist()
    if (now.hour, now.minute) >= (18, 30):
        return now.date()
    return now.date() - timedelta(days=1)


# --------------------------------------------------------------------------- one day

@dataclass
class DayResult:
    date: date
    outcome: str  # ok|recovered|fallback|partial|failed|no_session|pending|skipped
    source: str | None = None
    rows: int = 0
    missing: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    network_down: bool = False


def _attach_buckets(df: pd.DataFrame, d: date) -> pd.DataFrame:
    _, u = universe.universe_for(d)
    m = dict(zip(u["symbol"], u["bucket"]))
    df = df.copy()
    df["bucket"] = df["symbol"].map(m)
    return df


def ingest_date(client: NSEClient, d: date, cal: TradingCalendar, status: StatusStore, *,
                allow_fallback: bool = True, rebuild: bool = False, now: datetime | None = None) -> DayResult:
    existing = store.read_daily_prices(d)
    if existing is not None and not rebuild and (existing["source"] == "nse_bhavcopy").all():
        return DayResult(d, "skipped", "nse_bhavcopy", len(existing))

    _, u = universe.universe_for(d)
    uni_syms = list(u["symbol"])
    mark = len(client.events)
    prev = status.day(d) or {}
    attempts = int(prev.get("attempts", 0)) + 1
    errors: list[str] = []
    df: pd.DataFrame | None = None
    fetch_error = False
    network_down = False

    try:
        df = fetch_bhavcopy(client, d)
    except NSEError as e:
        fetch_error = True
        network_down = e.network_down
        errors.append(f"bhavcopy: {e}")

    events = client.events_since(mark)
    recovered_events = [f"{e['kind']}: {e['detail']}" for e in events if e["kind"] == "recovered"]

    if df is not None and len(df):
        df = _attach_buckets(df, d)
        missing = sorted(set(uni_syms) - set(df["symbol"]))
        store.write_daily_prices(d, df, rebuild=True if existing is not None else rebuild)
        outcome = "recovered" if recovered_events else "ok"
        notes = [f"{len(missing)} universe symbol(s) not traded / absent from bhavcopy"] if missing else []
        status.set_day(d, status=outcome, source="nse_bhavcopy", attempts=attempts, errors=errors,
                       missing_symbols=missing, recovered_events=recovered_events, notes=notes, stale=False)
        return DayResult(d, outcome, "nse_bhavcopy", len(df), missing, errors)

    if not fetch_error:
        # every URL said 404
        official = cal.says_trading(d)
        today = (now or now_ist()).date()
        if official is not True:
            cal.mark_no_session(d)
            status.drop_day(d)
            return DayResult(d, "no_session")
        n = now or now_ist()
        if d == today and (n.hour, n.minute) < PUBLISH_CUTOFF_IST:
            return DayResult(d, "pending", errors=["bhavcopy not published yet"])
        errors.append("bhavcopy missing (404) on a trading day")

    if network_down or not allow_fallback:
        st = "failed"
        status.set_day(d, status=st, source=None, attempts=attempts, errors=errors,
                       missing_symbols=[], recovered_events=recovered_events,
                       notes=["will retry on the next scheduled run"], stale=False)
        return DayResult(d, "failed", errors=errors, network_down=network_down)

    # ---- fallback chain: NSE historical API -> yfinance
    parts, sources = [], []
    api_df, missing = fetch_from_nse_api(client, d, uni_syms)
    if len(api_df):
        parts.append(api_df)
        sources.append("nse_api")
    if missing:
        yf_df, missing = fetch_from_yfinance(d, missing)
        if len(yf_df):
            parts.append(yf_df)
            sources.append("yfinance")
    if not parts:
        errors.append("all fallback sources failed")
        status.set_day(d, status="failed", source=None, attempts=attempts, errors=errors,
                       missing_symbols=uni_syms, notes=["will retry on the next scheduled run"], stale=False)
        return DayResult(d, "failed", errors=errors)

    df = _attach_buckets(pd.concat(parts, ignore_index=True), d)
    store.write_daily_prices(d, df, rebuild=True)
    main_source = sources[0]
    outcome = "partial" if missing else "fallback"
    status.set_day(d, status=outcome, source=main_source, attempts=attempts, errors=errors,
                   missing_symbols=sorted(missing), recovered_events=recovered_events,
                   notes=[f"Day built from fallback source {' + '.join(sources)}",
                          "affected: whole day (bhavcopy missing); will retry bhavcopy on the next run"],
                   fallback_sources=sources, stale=False)
    status.event("fallback", f"{d}: built from {' + '.join(sources)}; {len(missing)} symbol(s) still missing",
                 date=d.isoformat())
    return DayResult(d, outcome, main_source, len(df), sorted(missing), errors)
