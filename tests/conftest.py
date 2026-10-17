import io
import sys
import zipfile
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from mbi import paths, store, universe  # noqa: E402


@pytest.fixture
def data_env(tmp_path, monkeypatch):
    monkeypatch.setenv("MBI_DATA_DIR", str(tmp_path / "data"))
    universe._load_version_cached.cache_clear()
    # no Muhurat/extra sessions so synthetic weekday calendars are simple
    store.atomic_write_json(paths.calendar_config(), {"extra_sessions": [], "short_sessions": []})
    store.atomic_write_json(paths.app_config(), {"include_today_in_avg": False, "detail_days": 5})
    yield tmp_path / "data"
    universe._load_version_cached.cache_clear()


def weekdays(start: date, n: int) -> list[date]:
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d += timedelta(days=1)
    return out


def make_universe(per_bucket: int = 4, v: date = date(2020, 1, 1)) -> pd.DataFrame:
    rows = []
    for b in store.BUCKETS:
        for i in range(per_bucket):
            rows.append({"bucket": b, "symbol": f"{b[:3]}{i}", "company": None, "industry": None,
                         "series": "EQ", "isin": "INE000000000", "mcap_cr": None, "source": "test", "rank": None})
    df = pd.DataFrame(rows)
    universe.save_version(df, v)
    return df


def write_prices(sessions, symbols, *, seed=1, price_fn=None, vol_fn=None, start_idx=None):
    """Write synthetic archive days. price_fn(t, sym) / vol_fn(t, sym) override the defaults."""
    rng = np.random.default_rng(seed)
    start_idx = start_idx or {}
    px = {s: 100.0 + 10 * k for k, s in enumerate(symbols)}
    for t, d in enumerate(sessions):
        rows = []
        for s in symbols:
            if t < start_idx.get(s, 0):
                continue
            px[s] *= float(np.exp(rng.normal(0.0005, 0.01)))
            close = price_fn(t, s) if price_fn else px[s]
            vol = vol_fn(t, s) if vol_fn else float(rng.integers(90_000, 110_000))
            rows.append({"date": d, "symbol": s, "bucket": None, "open": close, "high": close, "low": close,
                         "close": close, "prev_close": close, "volume": vol, "traded_value": vol * close,
                         "trades": 100, "source": "nse_bhavcopy", "series": "EQ", "isin": "INE000000000"})
        store.atomic_write_parquet(paths.prices_daily_file(d), pd.DataFrame(rows)[store.PRICE_COLUMNS])


def udiff_zip(d: date, rows: list[dict]) -> bytes:
    cols = ["TradDt", "BizDt", "Sgmt", "Src", "FinInstrmTp", "FinInstrmId", "ISIN", "TckrSymb", "SctySrs",
            "XpryDt", "FininstrmActlXpryDt", "StrkPric", "OptnTp", "FinInstrmNm", "OpnPric", "HghPric", "LwPric",
            "ClsPric", "LastPric", "PrvsClsgPric", "UndrlygPric", "SttlmPric", "OpnIntrst", "ChngInOpnIntrst",
            "TtlTradgVol", "TtlTrfVal", "TtlNbOfTxsExctd", "SsnId", "NewBrdLotQty", "Rmks"]
    recs = []
    for r in rows:
        recs.append({c: None for c in cols} | {
            "TradDt": d.isoformat(), "Sgmt": "CM", "Src": "NSE", "FinInstrmTp": "STK",
            "ISIN": r.get("isin", "INE000000001"), "TckrSymb": r["symbol"], "SctySrs": r.get("series", "EQ"),
            "FinInstrmNm": r["symbol"] + " LTD", "OpnPric": r["close"], "HghPric": r["close"], "LwPric": r["close"],
            "ClsPric": r["close"], "LastPric": r["close"], "PrvsClsgPric": r.get("prev", r["close"]),
            "TtlTradgVol": r["volume"], "TtlTrfVal": r["volume"] * r["close"], "TtlNbOfTxsExctd": 10,
        })
    csv = pd.DataFrame(recs, columns=cols).to_csv(index=False)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(f"BhavCopy_NSE_CM_0_0_0_{d:%Y%m%d}_F_0000.csv", csv)
    return buf.getvalue()
