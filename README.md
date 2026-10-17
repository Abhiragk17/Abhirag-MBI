# Market Breadth Indicator (India)

End-of-day breadth for the top 1000 NSE stocks, built from `MARKET_BREADTH_SPEC.md` (v3).
Python jobs fetch and archive data and compute the indicators; a Next.js app charts them.

## Quick start

```bash
pip install -r requirements.txt
python -m mbi backfill --from 2025-01-01      # ~4 min of bhavcopies + nanocap ranking
cd web && npm install && npm run build && npm start   # http://localhost:3000
```

Then run `python -m mbi daily` after ~6:30 PM IST each trading day. You can also press
**Refresh data** in the UI, which spawns the same job.

No network? `MBI_DATA_DIR=/tmp/mbi-demo python -m mbi demo` writes synthetic data you can
use to try the UI. The command refuses to touch an archive that holds real data.

## Commands (`python -m mbi …`)

| Command | What it does |
|---|---|
| `daily [--date D] [--offline]` | Ingests new sessions and retries recent failed or fallback days, then computes and classifies |
| `backfill --from D [--to D] [--fallback] [--rebuild]` | Bulk-downloads bhavcopies (UDiFF from 2024-07-08, legacy format before that) |
| `recompute [--from] [--to] [--states-only]` | Rebuilds the indicators from the archive, offline |
| `universe --refresh [--nanocap-only] [--amfi-file X]` / `--diff [A] [B]` (`seed` allowed) / `--show` | Builds, compares or shows universe versions |
| `consolidate` | Rebuilds `data/prices/prices_all.parquet` |
| `compare --date A --date B [--ema 20]` | Prints two days side by side |
| `export-stock SYM [--adjusted]`, `export-history`, `day-detail --date D`, `print-config`, `classify-preview --config F` | Helpers that the UI calls |

## Layout

```
mbi/        nse_client, universe, ingest, adjust, metrics, classifier, store, status, pipeline, cli, demo
web/        Next.js 14 (App Router) + Tailwind + ECharts; API routes read data/ and spawn python
data/       prices/daily/YYYY/*.parquet (raw, never overwritten), breadth/, meta/, config/
tests/      pytest, mapped to spec section 11
```

Config files (all under `data/config/`, created on first run):
- `split_adjustments.json`: `SPLIT_ADJUSTED_STOCKS`, seeded from `splits_seed.csv`.
- `regime_config.json`: classifier thresholds. Edit it in the UI (Config page) or by hand, then run `mbi recompute --states-only`.
- `calendar.json`: `extra_sessions` lists weekend trading days. `short_sessions` lists Muhurat-style sessions; they are archived but skipped in the maths. Verify these dates.
- `app_config.json`: `include_today_in_avg` and `detail_days`, the number of recent days that get a pre-built per-stock table. Older days are computed on demand.

## Implementation notes and deviations

- **Archive scope.** Each daily parquet holds every EQ/BE/BZ/RR/IV row with an `INE…` ISIN, about 2,000 rows, not just the 1000. The nanocap liquidity filter needs history for stocks before they enter the universe. Columns follow spec 5.2, plus `series` and `isin`.
- **EMA window.** EMA(t) is computed over the last 320 sessions ending at t, seeded from the first close in that window. That is about 13× the EMA50 time constant, so `daily` and `recompute` produce identical values however the runs are chunked.
- **Extra history columns.** The history file adds `state_raw_ema10/50`, `rule_emaN`, `dp_emaN` and `days_in_state_emaN` after the spec's columns. State codes: BD, LD, EU, BR, LS, PA.
- **Nanocap share counts.** NSE `quote-equity` is blocked by bot protection for plain HTTP clients. The chain is NSE (3 probes), then yfinance `fast_info.shares`, then the previous ranking. Results are cached in `data/meta/shares_outstanding.csv` for 180 days. The AMFI xlsx is also supported.
- **Playwright fallback.** Implemented but optional: `pip install playwright && python -m playwright install chromium`.
- **Universe history.** Dates before the earliest universe version use that earliest version, so backfilled history carries survivorship bias.
- **Classifier preview.** The Config page's preview runs the Python classifier, so the defaults and the rules live in one place.
