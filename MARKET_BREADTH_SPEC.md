# Market Breadth Indicator (India): Build Spec for Claude Code

**Owner:** Abhirag | **Spec version:** 3 (2026-10-10) | **Stack:** Python 3.11+ (data jobs) + Next.js 14+ / TypeScript (UI) | **Cost:** free data only

**Changes in v3:** a six-state market situation classifier built on the two indicators, with a selectable EMA length (10 / 20 / 50, default 20), shown in the UI and saved in the history file (sections 7.4, 8.2).

**Changes in v2:** daily indicator history file and charts; split adjustment through a user-maintained variable (no corporate-action pulling); permanent raw price/volume archive for backtesting; Next.js UI instead of Streamlit; layered fallbacks for every data-fetch failure, shown in the UI.

## 1. Goal

Build a local app that measures Indian market health at end of day (EOD) from the **top 1000 NSE stocks**. It computes two breadth metrics **separately for each market-cap bucket**:

1. **Volume Ratio**
2. **% of stocks above the 10, 20 and 50 EMA**

It stores every day's result and every stock's raw price and volume permanently, charts both indicators day by day, and surfaces any data problem in the UI.

## 2. Buckets (NSE-style, ranked by market cap)

| Bucket | Rank | Count | Seed source |
|---|---|---|---|
| Largecap | 1–100 | 100 | `ind_nifty100list.csv` |
| Midcap | 101–250 | 150 | `ind_niftymidcap150list.csv` |
| Smallcap | 251–500 | 250 | `ind_niftysmallcap250list.csv` |
| Microcap | 501–750 | 250 | `ind_niftymicrocap250_list.csv` |
| Nanocap | 751–1000 | 250 | Rank the rest of NSE EQ-series by market cap (see 3.2) |

Also compute an **ALL (1000)** aggregate. Counts are computed per bucket and per aggregate, so aggregate values are never an average of bucket percentages.

The Nifty index CSVs are free at `https://nsearchives.nseindia.com/content/indices/<file>`.

## 3. Universe construction (`universe.py`)

### 3.1 Ranks 1–750
- Download the four index CSVs above (columns: Company Name, Industry, Symbol, Series, ISIN Code).
- **Drop any symbol starting with `DUMMY`.** The microcap and smallcap files contain placeholder rows.
- Expected counts after cleaning: 100 / 150 / 250 / 250.
- A seed snapshot taken on 2026-10-10 is in `universe_seed_750.csv`. It is the **offline fallback** (see section 10) and a test fixture. It goes stale, so it is not the source of truth.
- The seed was read through a web summarizer. Re-download the CSVs with the NSE session in section 4 and diff against it.

### 3.2 Ranks 751–1000 (nanocap)
There is no NSE index for this tier, so build it:

1. Take all NSE equity symbols with series `EQ`, `BE` or `SM` from the latest bhavcopy.
2. Remove ETFs, InvITs, REITs, SME-only stocks and anything already in ranks 1–750.
3. Market cap = latest close × shares outstanding. Get the share count from AMFI's half-yearly "Categorization of Stocks" file, or from NSE's `quote-equity` API (`issuedSize`) as a fallback.
4. Sort descending and take the top 250 to fill ranks 751–1000.
5. Liquidity filter: at least 200 trading days of history and median daily traded value above ₹5 lakh. If a name fails, take the next one, so the bucket always holds 250.

### 3.3 Refresh policy
- Re-run universe construction **every 6 months**, after AMFI and NSE reconstitute (end of June and end of December).
- Keep every universe version in `data/universe_history/<YYYY-MM-DD>.csv`. Store the bucket used on each calculation date in the history file, so past results are not rewritten when a stock migrates between buckets.
- Provide `python -m mbi universe --refresh` and `--diff` to show promotions and demotions.

## 4. NSE data access (`nse_client.py`): avoid the 403 / JSONDecodeError

NSE blocks plain `requests`/`nsepython` calls that lack browser cookies. Implement the fix **once, in one client class**, and use that class for everything:

- A single `requests.Session()` with browser-like headers: a current Chrome `User-Agent`, `Accept`, `Accept-Language: en-US,en;q=0.9`, `Referer: https://www.nseindia.com/`, `Connection: keep-alive`. Don't use an old UA such as Chrome 79.
- **Warm-up:** `GET https://www.nseindia.com` (and `/market-data/live-equity-market` if needed) so NSE sets its cookies **before** any `/api/...` call.
- **Re-warm on failure:** on 401/403/empty body/`JSONDecodeError`, recreate the session, warm up again, and retry.
- Retry with exponential backoff (3–5 tries), jitter, and a global rate limit of about 2–3 req/s. Rotate the session every ~100 calls or ~5 minutes.
- **Browser fallback:** if `requests` still fails, use Playwright to open nseindia.com and fetch through the browser context (`page.request`), or copy its cookies into the `requests` session.
- `nselib` and `nsepython` are allowed for convenience, but **route their HTTP through this session** or wrap them with the same retry logic.
- Every failure and recovery is recorded in the run log and in the `data_status` file (section 10), so the UI can show it.

## 5. Price and volume data (`ingest.py`) and the permanent archive

### 5.1 Sources
- **Primary:** NSE daily bhavcopy, the CM-UDiFF file (`BhavCopy_NSE_CM_0_0_0_<YYYYMMDD>_F_0000.csv.zip` on `nsearchives.nseindia.com/content/cm/`). One file per trading day carries open, high, low, close, volume and traded value for every stock.
- **Holidays/weekends:** NSE returns 404 for non-trading days. Treat that as "no session", not as an error. Use NSE's `holiday-master` API for the calendar, with a cached copy as fallback.
- **Daily job:** run after ~6:30 PM IST.

### 5.2 Archive files (new in v2)
Raw, **unadjusted** OHLCV for every stock on every day is stored in its own files, separate from the indicator history, so backtesting beyond one year works without re-downloading anything.

```
data/
  prices/
    daily/YYYY/YYYY-MM-DD.parquet        # one file per session, ~1000 rows
    prices_all.parquet                   # consolidated (rebuilt by `mbi consolidate`)
  breadth/
    breadth_history.csv                  # indicator results, one row per date x bucket
    breadth_history.parquet              # same, for fast loading
    breadth_latest.json                  # latest day, read by the UI
  meta/
    universe_history/YYYY-MM-DD.csv
    data_status.json                     # per-day source / error log (section 10)
  config/
    split_adjustments.json               # section 6
    regime_config.json                   # section 7.4 thresholds
```

- Columns in `prices/daily/*.parquet`: `date, symbol, bucket, open, high, low, close, prev_close, volume, traded_value, trades, source`.
- **Never prune or overwrite** archived raw files, except through an explicit `--rebuild` of one date. All writes are atomic (write a temp file, then rename).
- **Backfill:** `mbi backfill --from 2021-01-01` loads as much history as the user asks for. Bhavcopy goes back many years, and the archive is meant to grow. The indicator calculation needs only the last ~320 days, but the archive keeps everything.
- A stock outside the 1000 on a given day is still stored if it was in the universe version in force that day.
- Calculations read from the archive, not from the network, so indicators can be recomputed for any past date offline (`mbi recompute --from ... --to ...`).

## 6. Split adjustment (variable plus function; no corporate-action pulling)

The app does **not** fetch corporate actions. Split adjustment is driven by a list that the user maintains.

### 6.1 The variable
`config/split_adjustments.json` (loaded into a module-level variable `SPLIT_ADJUSTED_STOCKS`):

```json
[
  {"symbol": "KOTAKBANK", "ex_date": "2026-01-13", "old_fv": 5, "new_fv": 1, "factor": 5.0, "type": "split"},
  {"symbol": "ANGELONE",  "ex_date": "2026-02-25", "old_fv": 10, "new_fv": 1, "factor": 10.0, "type": "split"}
]
```

- `factor` = old_fv / new_fv for a split. For a bonus `x:y`, factor = (x+y)/y.
- The initial content is the seed table in section 12. The user adds entries later.
- Validate on load: no duplicate (symbol, ex_date), factor > 0, ex_date a valid date, symbol present in the archive. Invalid rows are skipped and reported in the UI warnings panel.

### 6.2 The function
Implement `adjust_ohlcv(df, splits) -> df` in `adjust.py`:

- For each symbol, for every row dated **before** its ex-date: `adj_close = close / F`, same for open/high/low, and `adj_volume = volume * F`, where `F` is the product of all factors with ex-dates after that row's date.
- Return the original columns unchanged, plus the `adj_*` columns and the `adj_factor`.
- It runs at calculation time on the raw archive. It never modifies archived files.
- Unit-test it with the seed splits.

### 6.3 Safety net (warning only, not pulling)
If a symbol's `close / prev_close` is below 0.6 or above 1.6 on a day and the symbol has no entry in `SPLIT_ADJUSTED_STOCKS` for that date, flag it as a **suspected unadjusted event**:
- exclude that symbol from that day's counts,
- list it in the UI's Data Quality panel with a "add to split list?" hint.

## 7. Metrics (`metrics.py`)

For each date *t* and each bucket, use only valid symbols: traded that day, at least 50 days of history, no data-quality flag. Prices and volumes are the **adjusted** series from section 6.

### 7.1 Volume Ratio
- `avgvol20(s,t)` = simple mean of adjusted volume over the 20 sessions **before** *t*. This excludes *t* by default. Expose it as a config flag `include_today_in_avg`.
- `rel_vol = volume(t) / avgvol20`
- `N_high` = count with `rel_vol >= 1.5`. `N_low` = count with `rel_vol < 0.5`.
- **Volume Ratio = N_high / N_low.** If `N_low == 0`, store `null` and show the counts.
- Regime labels (from the project note "Volume ratio"):
  - `< 0.25`: extreme low demand or fear
  - `0.25–0.50`: choppy and muted (most common)
  - `0.50–0.70`: improving, tradable
  - `0.70–1.00`: building demand (gap-filler band, not in the source note)
  - `> 1.0`: high-demand phase
  - `> 2.0`: extreme excess or shakeout, a climax or panic day

### 7.2 % above EMA
- EMA on adjusted close, spans 10, 20, 50, `ewm(span=n, adjust=False)`, seeded from the first valid close.
- For each span: % above = count(close > EMA) / n_valid × 100.

### 7.3 Daily history row
One row per `date × bucket` (5 buckets + ALL) is appended to `breadth_history.csv`:

`date, bucket, universe_version, n_universe, n_valid, n_excluded, n_high, n_low, vol_ratio, vol_regime, n_above_ema10, n_above_ema20, n_above_ema50, pct_ema10, pct_ema20, pct_ema50, state_ema10, state_ema20, state_ema50, state_raw_ema20, data_source, data_quality`

- Re-running a date replaces its rows (upsert on `date, bucket`).
- Keep the file append-friendly and human-readable so it can be opened in Excel for historical comparison.
- `mbi compare --date A --date B` prints two days side by side. The UI has the same feature (section 8).

### 7.4 Market situation classifier (`classifier.py`)

Classifies each `date × bucket` (including ALL) into one of **six market situations**, using only the two indicators: the **volume ratio (VR)** and **% of stocks above the EMA (P)**.

**EMA selector:** the user chooses the EMA length used for P: **10, 20 or 50, default 20**. The classifier runs for all three and stores `state_ema10`, `state_ema20`, `state_ema50`, so history stays comparable whichever length is selected in the UI. The UI selector only picks which column is displayed.

#### The six situations (definitions from the user's source video, 03:26–06:40)

| State | Meaning | What to focus on |
|---|---|---|
| **Bullish Domination** | Stocks move upward easily | Breakouts, gaps, strong-structure reversal setups |
| **Lack of Demand** | No strong demand; stocks fail to follow through | Intraday breakouts, shorting gaps, reversals and pullbacks |
| **Euphoria / Overheated Market** | Highly extended market; breakouts may fail | Parabolic shorts, gap-up shorts, playing the index trend |
| **Bearish Domination** | Majority of stocks are falling | Short setups, stocks entering stage 4 |
| **Lack of Supply** | Sellers pausing after a strong decline | Resilient stocks that are not falling further; breakouts from strong structures |
| **Panic / Overheated Decline** | Oversold, bottoming situation | Reversals; parabolic long setups in strong-structure or declining stocks |

The "What to focus on" text is shown in the UI as the playbook for the current state.

#### Default decision table

The source video does not give numeric thresholds, so these are **starting defaults that the user will calibrate**. They live in `config/regime_config.json`, not in code.

Zones for P (percent above the chosen EMA): **VL** < 20, **L** 20–40, **M** 40–60, **H** 60–80, **VH** ≥ 80.
Zones for VR: **low** < 0.5, **mid** 0.5–1.0, **high** ≥ 1.0 (≥ 2.0 = extreme).

| P zone | VR low (< 0.5) | VR mid (0.5–1.0) | VR high (≥ 1.0) |
|---|---|---|---|
| **VH** (≥ 80) | Euphoria | Euphoria | Euphoria |
| **H** (60–80) | Lack of Demand | Bullish Domination | Bullish Domination |
| **M** (40–60) | Lack of Demand | Lack of Demand, or Bullish if VR ≥ 0.7 and P rising | Bullish Domination |
| **L** (20–40) | Lack of Supply | Bearish Domination | Bearish Domination |
| **VL** (< 20) | Lack of Supply | Bearish Domination | Panic / Overheated Decline |

Extra rules, evaluated first:
1. **Panic override:** VR ≥ 2.0 and P < 30 → Panic / Overheated Decline.
2. **Euphoria override:** P ≥ 80 → Euphoria (a very high P is overheated whatever the volume is).
3. If VR is `null` (`N_low == 0`), treat VR as **high**.
4. **Trend input (optional, on by default):** `dP = P(t) − P(t−5)`. In the M row, "P rising" means `dP > 0`. In the L row with VR low, Lack of Supply needs `dP >= 0`; if `dP < 0`, label it Bearish Domination.

Every threshold, zone edge, override and the `dP` window is a field in `regime_config.json`. Changing the file and running `mbi recompute` reclassifies the whole history.

#### Smoothing (anti-flicker)

- `state_raw_ema20` (and the equivalents for 10 and 50) is the classification straight from the table.
- The **confirmed state** (`state_ema20`, etc.) changes only after the new raw state appears on **2 consecutive sessions** (`confirm_days`, configurable; set it to 1 to switch smoothing off).
- The UI shows the confirmed state by default and has a toggle to show the raw state.

#### Output per day

`state`, `state_raw`, the `P` and `VR` values used, the EMA length, and `days_in_state`. A `distance_to_boundary` field is optional and flags a state sitting near a zone edge.

The classifier is a pure function: `classify(vr, p, dp, config) -> (state, rule_id)`. `rule_id` records which table cell or override fired, so every label can be explained in the UI tooltip.

## 8. UI (Next.js, not Streamlit)

### 8.1 Stack
- **Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui.**
- **Charts: Apache ECharts via `echarts-for-react`.** Reasons: the regime-band shading (`markArea`), heatmaps, brush/zoom, a dual-axis combo chart and good dark-mode theming are native. Recharts is acceptable only for small sparklines.
- Data access: Next.js route handlers (`/api/breadth`, `/api/status`, `/api/day/[date]`) read the files in `data/breadth/` and `data/meta/` (CSV through `papaparse` or JSON). No database server is needed.
- A `Refresh data` button calls `/api/refresh`, which spawns `python -m mbi daily` as a background process and streams its status to the UI. If spawning fails, show the error in the banner (section 9).
- Light and dark themes. Layout works at laptop width and tablet width.

### 8.2 Pages and charts
**Dashboard (`/`)**

1. **Header strip:** latest session date, data-status badge (section 9), universe version, last refresh time.
2. **KPI tiles** (one per bucket + ALL): latest volume ratio with its regime chip, and % above EMA10/20/50, each with the change versus the previous day and a tiny sparkline.
3. **Volume Ratio chart** (daily):
   - A line of `vol_ratio` per bucket (toggle buckets on and off; default = ALL + five buckets).
   - Horizontal shaded regime bands at 0.25 / 0.50 / 0.70 / 1.0 / 2.0.
   - Option for a log y-axis, since the ratio is skewed.
   - A second panel beneath it: stacked bars of `n_high` (up) and `n_low` (down) for the selected bucket, so the ratio's numerator and denominator are visible.
4. **% Above EMA chart** (daily):
   - Three lines (EMA10, EMA20, EMA50) for the selected bucket, y-axis 0–100%.
   - Reference lines at 20% and 80%, with overbought/oversold shading.
   - A bucket selector. A **small-multiples view** shows all six buckets in a grid at the same scale.
5. **Heatmap:** days (x) × buckets (y), cells coloured by % above EMA20 (or the volume ratio; the toggle chooses). Hover shows the underlying counts.
6. **Range controls:** 1M / 3M / 6M / 1Y / All, a zoom slider, and a brush on every chart. The zoom is synchronised across charts.
7. **Compare days:** pick two dates and show their metrics side by side, with the differences.
8. Tooltips show date, value, counts (`n_high`, `n_low`, `n_valid`) and the regime label.
9. **EMA selector (global):** a 10 / 20 / 50 segmented control in the header, **default 20**. It drives the % above EMA chart highlight, the heatmap, the market-situation views and the KPI tiles. The choice is kept in the URL (`?ema=20`) and in `localStorage`.
10. **Market situation card** (top of the dashboard): the current state for the selected bucket, shown as a coloured badge, with the VR and P values behind it, the `days_in_state`, the rule that fired and the playbook text from 7.4. A bucket switcher sits beside it, and all six buckets are shown as a compact row of badges.
11. **State timeline ribbon:** a horizontal strip, one coloured cell per day, one row per bucket, aligned with the date axis of the other charts. Hover shows the date, state, VR and P.
12. **State map (VR vs P scatter):** x = % above the selected EMA, y = volume ratio (log scale), with the zone boundaries from the config drawn as the grid and each of the six areas labelled. The latest point is highlighted, with a fading **trail of the last 10 days** so the user can see the market moving between situations. A date slider replays history.
13. **State statistics:** days spent in each state (count and %), average and longest run, and a **transition matrix** (from-state → to-state).
14. **Raw / confirmed toggle** and an **explain** popover on every badge ("P = 71%, VR = 0.62, rule: H × mid → Bullish").
15. A fixed colour per state, used everywhere, with colour-blind-safe hues plus an icon or letter code (e.g. BD, LD, EU, BR, LS, PA), so colour is never the only cue.
16. An optional **Config** page edits `regime_config.json` thresholds, with a reset to defaults and a live preview of how many past days would change state.

**Stocks (`/stocks`):** a table of the day's symbols with bucket, `rel_vol`, close, and above/below flags for EMA10/20/50, sortable and filterable by bucket. Excluded symbols are shown with the reason.

**Data & Quality (`/data`):** the status log, per-day source used, missing and excluded symbols, split list validation results, and links to download `breadth_history.csv` and a stock's archived OHLCV.

**Downloads:** CSV export from each chart.

## 9. Fallbacks and error display

Every fetch has a defined fallback, and **the UI says which fallback is active**.

| Failure | Fallback chain | UI behaviour |
|---|---|---|
| NSE 403 / empty / JSON error | Re-warm session → retry with backoff → Playwright browser session | Yellow "Recovered" note on the day |
| Bhavcopy file missing for a trading day | NSE `historical/cm/equity` API → `yfinance` (`SYMBOL.NS`) for the missing symbols → retry on the next scheduled run | Banner: "Day built from fallback source X" plus a list of the symbols affected |
| Some symbols missing | Exclude them from that day's counts, retry them later; store `n_excluded` | Counts shown as `n_valid / n_universe` |
| Holiday calendar fetch fails | Use the cached calendar; assume a weekday session and let a 404 mean "no session" | Info note |
| Universe CSV download fails | Use the last good `universe_history` version, then `universe_seed_750.csv` | Banner showing the universe version in use and its age |
| Share counts unavailable (nanocap ranking) | Reuse the last ranking | Banner: "Nanocap list is stale" |
| Network fully down | Serve the last stored results, mark them stale | Red "Offline / showing data as of <date>" banner |
| Python job crashes | Write the error and the traceback summary to `data_status.json`; keep earlier data intact | Red banner with the error and a "View log" link |
| Corrupt or missing output file | Fall back to the parquet copy, or the previous day's file | Warning banner |
| Unexplained price jump (section 6.3) | Exclude and flag | Data Quality panel |

`data_status.json` holds, per session date: `status` (`ok | recovered | fallback | partial | failed`), `source` (`nse_bhavcopy | nse_api | yfinance | cache`), `attempts`, `errors[]`, `missing_symbols[]`, `excluded_symbols[]`, `stale` (bool) and `updated_at`.

UI rules:
- A persistent **status badge** in the header: green = ok, yellow = recovered/fallback, orange = partial, red = failed/stale.
- A **dismissible banner** with a plain-language message for any non-ok state, and a link to `/data`.
- Charts mark non-ok days with a distinct marker (hollow dot), and their tooltips state the source used.
- The UI must never crash on missing or empty data. It shows empty states with the reason.

## 10. Project layout

```
mbi/                       # Python
  nse_client.py            # session, warm-up, retry, Playwright fallback
  universe.py              # 750 from index CSVs + nanocap ranking + versioning
  ingest.py                # bhavcopy download, parse, archive, fallbacks
  adjust.py                # SPLIT_ADJUSTED_STOCKS loader + adjust_ohlcv()
  metrics.py               # volume ratio, EMA breadth
  classifier.py            # six-state market situation classifier + smoothing
  store.py                 # parquet/CSV writers (atomic), upserts
  status.py                # data_status.json writer
  cli.py                   # backfill, daily, recompute, universe, consolidate, compare
web/                       # Next.js app
  app/(dashboard)/page.tsx
  app/stocks/page.tsx
  app/data/page.tsx
  app/api/{breadth,status,day,refresh}/route.ts
  components/charts/{VolumeRatioChart,EmaBreadthChart,Heatmap,SmallMultiples,KpiTile,StateTimeline,StateMap}.tsx
  components/{EmaSelector,MarketStateCard,StateStats}.tsx
  app/config/page.tsx
  components/{StatusBadge,StatusBanner,DateRange,CompareDays}.tsx
data/                      # see section 5.2
tests/
```

## 11. Tests and acceptance

1. Universe cleaning gives exactly 100/150/250/250 with no `DUMMY` and no duplicates. Nanocap gives 250 and the total is 1000.
2. **Split test:** with the seed list, KOTAKBANK (5→1, ex 2026-01-13) has a continuous `adj_close` across the ex-date and no 5× step in `adj_volume`. The raw archive is unchanged.
3. EMA test: compare 5 random symbols against TradingView or Pine `ta.ema` within ±0.5%.
4. NSE client test: with cookies cleared, the first call still succeeds, and a forced 403 triggers re-warm and retry.
5. Volume ratio edge cases: `N_low == 0`, a new listing with under 50 days, a trading holiday.
6. **Archive test:** after `mbi daily`, a new `prices/daily/YYYY/YYYY-MM-DD.parquet` exists with the raw values, and `breadth_history.csv` has 6 new rows for the date. Re-running the same date does not duplicate rows.
7. **Recompute test:** deleting `breadth_history.csv` and running `mbi recompute` reproduces the same values from the archive alone, offline.
8. **Fallback tests:** simulate each failure in section 9, and confirm the right `data_status` value, the right banner and a UI that does not crash.
9. UI: all charts render with 1 day, with 300 days, and with an empty history. Date-range zoom is synchronised.
10. A full `mbi daily` run completes in under 3 minutes after backfill.
11. **Classifier tests:** a table-driven test covers every cell of the decision table and each override (for example P = 85 → Euphoria whatever VR is; VR = 2.3 with P = 25 → Panic; `VR = null` is treated as high). Boundary values (P exactly 20, 40, 60, 80; VR exactly 0.5, 1.0) fall in the upper zone.
12. **Smoothing test:** a one-day change of raw state does not change the confirmed state with `confirm_days = 2`, and it does with `confirm_days = 1`.
13. **EMA selector test:** switching to 10 or 50 changes the displayed state column and the URL, and the stored history is unchanged.
14. **Recompute test:** editing `regime_config.json` and running `mbi recompute` changes only the state columns; the VR, P and archive files stay identical.

## 12. Splits seed (initial content of `SPLIT_ADJUSTED_STOCKS`)

Inside the 750-stock universe, 2026. Source: Equitymaster, **not checked against NSE**. Verify before backtesting.

| Symbol | Split | Factor | Ex-date | Bucket |
|---|---|---|---|---|
| KOTAKBANK | ₹5 → ₹1 | 5 | 2026-01-13 | Largecap |
| MCX | ₹10 → ₹2 | 5 | 2026-01-01 | Midcap |
| ANGELONE | ₹10 → ₹1 | 10 | 2026-02-25 | Smallcap |
| TDPOWERSYS | ₹2 → ₹1 | 2 | 2026-08-21 | Smallcap |
| V2RETAIL | ₹10 → ₹1 | 10 | 2026-03-24 | Microcap |
| E2E | ₹10 → ₹1 | 10 | 2026-06-04 | Microcap |
| KIRLPNU | ₹2 → ₹1 | 2 | 2026-08-17 | Microcap |

**Other 2026 equity splits (not in the 750; nanocap candidates or outside the top 1000).** Add them to the variable if they enter the universe:

| Company | Split | Date |
|---|---|---|
| JSW Dulux | ₹10 → ₹1 | 2026-10-21 (upcoming) |
| BLS E-Services | ₹10 → ₹5 | 2026-10-05 |
| Deepak Builders & Engineers | ₹10 → ₹1 | 2026-06-18 |
| Titan Biotech | ₹10 → ₹2 | 2026-02-19 |
| Ajmera Realty | ₹10 → ₹2 | 2026-01-13 |
| Spice Island | ₹10 → ₹2 | 2026-08-27 |
| Tanfac Industries | ₹10 → ₹5 | 2026-03-06 |
| Silver Touch Tech | ₹10 → ₹2 | 2026-03-05 |
| Dev Labtech | ₹10 → ₹5 | 2026-05-14 |
| Avro India | ₹10 → ₹1 | 2026-05-04 |

ETF splits are excluded from the universe.

## 13. Known gaps (verify before relying on)

- **The split list is partial.** There is no reliable list for July–December 2025. Since the app no longer pulls corporate actions, **any split or bonus missing from the variable will distort the EMAs and the volume average for that stock.** The suspected-event flag in 6.3 is the safety net. Bonus issues are not compiled at all.
- **The six-state thresholds are my defaults, not the video's.** The source gives definitions but no numbers, so the table in 7.4 needs calibration against past market phases before the labels are trusted. Euphoria and Panic in particular rely on the extreme P zones, and Lack of Supply versus Bearish Domination depends on the volume threshold and the `dP` trend input.
- **Seed universe lists** were captured through a web summarizer. Re-download and diff them.
- **Nanocap (751–1000) is not pre-built.** The app derives it in 3.2.
- Stocks that appear in the splits tables but not in the 750 may land in nanocap. Check them at build time.

## 14. Files delivered with this spec

- `universe_seed_750.csv` (bucket, symbol): 100 + 150 + 250 + 250 = 750 rows. Offline fallback and test fixture.
- `splits_seed.csv`: the 7 in-universe splits, to convert into `config/split_adjustments.json`.
