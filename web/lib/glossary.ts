/** Hover help for every concept in the app: what it is, and how to read it.
 * Thresholds quoted are the starting defaults in regime_config.json (editable on Config). */
export interface GlossaryEntry { title: string; what: string; read?: string }

export const GLOSSARY = {
  // ---------------------------------------------------------------- header
  session: {
    title: "Session",
    what: "The latest NSE trading day whose end-of-day data has been downloaded and computed.",
    read: "Every number on the dashboard is as of this day's close. NSE publishes the data after about 6:30 PM IST.",
  },
  universe: {
    title: "Universe version",
    what: "The date of the stock list in use: the top 1000 NSE stocks by market cap, split into five rank buckets.",
    read: "It's rebuilt every six months after the June and December index reconstitutions. Past days keep the list that was in force then.",
  },
  data_status: {
    title: "Data status",
    what: "Health of the latest download: OK, recovered, from a fallback source, partial, or failed.",
    read: "Anything other than OK means some numbers may rest on incomplete data. See Data & Quality for details.",
  },
  ema_selector: {
    title: "EMA span",
    what: "Which exponential moving average (10, 20 or 50 sessions) is used for breadth and for the market situation everywhere in the app.",
    read: "EMA10 reacts within days (short-term swings), EMA20 is the medium-term default, EMA50 shows the slower trend.",
  },
  refresh: {
    title: "Refresh data",
    what: "Runs the daily job (python -m mbi daily). It fetches any missing sessions, retries recent failed days, recomputes and reclassifies.",
    read: "It takes a few seconds. Run it once a day after NSE publishes, around 6:30 PM IST.",
  },

  // ---------------------------------------------------------------- market situation
  market_situation: {
    title: "Market situation",
    what: "One of six states (Bullish domination, Lack of demand, Euphoria, Bearish domination, Lack of supply, Panic), decided from breadth (P) and volume ratio (VR) for the selected bucket.",
    read: "It describes current conditions, not a forecast. The playbook line suggests which setups tend to suit the state.",
  },
  sessions_in_state: {
    title: "Sessions in state",
    what: "How many trading days the current confirmed state has lasted.",
    read: "A new state is confirmed only after it shows up 2 sessions in a row, which filters one-day noise. A low count means a fresh change, a high count an established condition.",
  },
  raw_state: {
    title: "Raw state (no smoothing)",
    what: "Shows each day's classification on its own, without the 2-session confirmation filter.",
    read: "Raw reacts a day earlier but flips more often. Use it to spot a change that hasn't been confirmed yet.",
  },
  breadth: {
    title: "Breadth: % above EMA (P)",
    what: "The percentage of valid stocks in the bucket whose close is above their own EMA.",
    read: "Above 60% is strong (most stocks trending up), 40–60% mixed, below 40% weak. 80% and above is overheated and below 20% oversold.",
  },
  dp: {
    title: "dP: 5-session trend",
    what: "Breadth today minus breadth five sessions ago, in percentage points.",
    read: "Positive means breadth is improving, negative means it's deteriorating. It only tips the decision in two borderline cells of the rule table.",
  },
  vol_ratio: {
    title: "Volume ratio (VR)",
    what: "The number of stocks trading at 1.5× or more of their 20-day average volume, divided by the number trading below 0.5× of it.",
    read: "Below 0.5 is a quiet market, 0.5–1 normal, above 1 active and above 2 a climax day. VR shows intensity, not direction: read it together with breadth.",
  },
  vol_regime: {
    title: "Volume regime",
    what: "A plain-language band for the volume ratio.",
    read: "<0.25 extreme low demand / fear · 0.25–0.5 choppy and muted (most common) · 0.5–0.7 improving · 0.7–1 building demand · 1–2 high demand · ≥2 extreme excess / climax.",
  },
  rule_grid: {
    title: "How it was decided",
    what: "The decision table: rows are breadth zones, columns are volume-ratio zones, and each cell names the state it produces. Today's cell is outlined.",
    read: "Two overrides run first: panic (VR ≥ 2 with P < 30) and euphoria (P ≥ 80). Cells marked X/Y switch to Y when the 5-session trend condition holds.",
  },
  playbook: {
    title: "Playbook: focus on",
    what: "The trade setups that typically suit the current state.",
    read: "Use it as a filter for which setups to prioritise, not as a signal to trade.",
  },
  valid: {
    title: "Valid stocks",
    what: "Stocks counted in today's numbers. A stock is excluded if it didn't trade, has fewer than 50 sessions of history, shows an unexplained price jump (possible unadjusted split), or has no volume average.",
    read: "If many stocks are excluded, the bucket's numbers rest on a smaller sample.",
  },
  buckets: {
    title: "Buckets",
    what: "The 1000 stocks are split by market-cap rank: Largecap 1–100, Midcap 101–250, Smallcap 251–500, Microcap 501–750, Nanocap 751–1000, plus ALL.",
    read: "Each bucket is computed independently. Smaller caps naturally have lower volume ratios, so compare a bucket against its own history.",
  },

  // ---------------------------------------------------------------- dashboard charts
  range: {
    title: "Date range and zoom",
    what: "Sets the period shown by every chart below. You can also drag or scroll on any chart to zoom, and all charts follow.",
    read: "Use 1M or 3M to read recent day-by-day changes and 1Y or All for regimes and cycles.",
  },
  bucket_picker: {
    title: "Bucket for single-bucket charts",
    what: "Chooses the bucket for charts that show one bucket at a time: heavy vs light volume bars, % above EMA, state map and state statistics.",
  },
  vr_chart: {
    title: "Volume ratio over time",
    what: "Each line is one bucket's daily volume ratio. The guide lines mark the regime edges (0.25, 0.5, 1, 2).",
    read: "Spikes above 2 are climax days: in a weak market often capitulation, in a strong one a blow-off. Long stretches below 0.5 mean a muted market with little conviction. Log scale keeps spikes from flattening the rest.",
  },
  vr_buckets: {
    title: "Buckets to plot",
    what: "Tick the buckets to draw. Fewer lines are easier to read.",
    read: "ALL is the overall market. Add one bucket to compare it against the whole.",
  },
  hl_bars: {
    title: "Heavy vs light volume stocks",
    what: "Upward bars are stocks trading at 1.5× or more of their normal volume, downward bars stocks below 0.5×. The ratio of the two is the volume ratio.",
    read: "Shows whether a VR change came from more heavy-volume stocks or from fewer quiet ones.",
  },
  ema_chart: {
    title: "% of stocks above EMA",
    what: "Breadth over time for the EMA chosen in the header. The shaded zones mark overheated (≥80%) and oversold (<20%).",
    read: "A rising line means more stocks are recovering their trend. Readings near the extremes tend to revert. Divergence between buckets shows where strength or weakness is concentrated.",
  },
  timeline: {
    title: "Market situation timeline",
    what: "One coloured cell per day per bucket, showing that day's state.",
    read: "Long bands are persistent regimes. Frequent colour changes mean an unsettled, choppy market.",
  },
  heatmap: {
    title: "Heatmap",
    what: "Days across, buckets down, each cell coloured by breadth or by volume ratio.",
    read: "Spot whether strength or weakness started in large caps or small caps and how it spread.",
  },
  state_map: {
    title: "State map",
    what: "Plots the bucket on the decision grid (VR across, breadth up) with a trail of the last 10 sessions. The slider replays history.",
    read: "The direction of the trail shows where the market is heading: for example, moving up from bottom-left means a recovery from fear.",
  },
  state_stats: {
    title: "State statistics",
    what: "How often each state occurred in the selected range, and how long it typically lasted.",
    read: "Days = total sessions in the state · Share = % of the range · Runs = separate stretches · Avg run = typical length · Longest = longest stretch.",
  },
  transitions: {
    title: "Transition matrix",
    what: "How many times the state changed from one state (row) to another (column).",
    read: "Darker cells are common transitions, e.g. how often Panic gives way to Lack of supply versus straight to Bullish.",
  },
  compare_days: {
    title: "Compare days",
    what: "Puts two sessions side by side for every bucket: state, volume ratio, breadth and counts, with the difference B − A.",
    read: "Useful for checking what changed over a week or since a key day.",
  },

  // ---------------------------------------------------------------- stocks
  stocks_table: {
    title: "Stocks",
    what: "The per-stock inputs behind the breadth numbers for one session.",
    read: "Sort by rel_vol to see which stocks drove the volume ratio, or filter to excluded stocks to see why they were left out.",
  },
  rel_vol: {
    title: "rel_vol: relative volume",
    what: "Today's volume ÷ the stock's average volume over the previous 20 sessions.",
    read: "≥ 1.5 counts as heavy (▲ high) and < 0.5 as light (▼ low). Values in between aren't counted in the volume ratio.",
  },
  close_adj: {
    title: "Close",
    what: "The raw closing price. A ÷ factor appears when the stock had a split or bonus, and the EMAs use the adjusted price.",
  },
  ema_flags: {
    title: "Above / below EMA",
    what: "Whether the stock's split-adjusted close is above its 10, 20 and 50 session EMA. The selected EMA is in bold.",
    read: "Hover a flag to see the EMA value. Breadth (P) is the share of valid stocks marked ▲ above.",
  },
  stock_status: {
    title: "Status",
    what: "Valid stocks are counted. Excluded stocks are left out of that day's numbers, with the reason shown.",
  },
  archive: {
    title: "Archive",
    what: "Downloads this stock's full stored daily open, high, low, close and volume as CSV.",
  },

  // ---------------------------------------------------------------- data & quality
  last_job: {
    title: "Last job",
    what: "The most recent background run (daily, backfill, recompute or reclassify) and its result.",
    read: "Run daily fetches new sessions. Recompute rebuilds every indicator from the stored archive without downloading.",
  },
  universe_card: {
    title: "Universe & calendar",
    what: "Where the stock list came from, how old it is, the holiday calendar source, and network status.",
    read: "A stale nanocap list or an old universe means bucket membership may be out of date.",
  },
  downloads: {
    title: "Downloads",
    what: "Export the full indicator history, or one stock's raw or split-adjusted OHLCV.",
  },
  suspected: {
    title: "Suspected unadjusted events",
    what: "Stocks whose close jumped by more than ×1.6 or fell below ×0.6 of the previous close with no split-list entry, which usually means an unrecorded split or bonus.",
    read: "They're excluded from that day's counts. If it's a real split, add the suggested line to the split list and recompute.",
  },
  split_list: {
    title: "Split list",
    what: "The splits and bonuses used to adjust historical prices and volumes, so the EMAs and averages don't see false jumps.",
    read: "Rows with issues are ignored until fixed.",
  },
  day_log: {
    title: "Per-day status log",
    what: "For each session: data source, download attempts, missing symbols, excluded symbols and any errors.",
    read: "Status ok means clean data. Recovered or fallback means the data came another way. Partial means some symbols are missing.",
  },
  events: {
    title: "Recent events",
    what: "A timeline of recoveries, fallbacks and failures recorded by the downloader and jobs.",
  },
  run_log: {
    title: "Run log",
    what: "Raw text output of the background jobs, for debugging.",
  },

  // ---------------------------------------------------------------- config
  cfg_thresholds: {
    title: "Market situation thresholds",
    what: "All the cut-offs used to turn breadth and volume ratio into a state.",
    read: "Changes only affect the labels, not the underlying numbers. Check the live preview, then Save & reclassify to apply to all history.",
  },
  p_zones: {
    title: "P zones",
    what: "Breadth cut-offs: VL < L ≤ M ≤ H ≤ VH. Each value is the lower edge of that zone (inclusive).",
    read: "Defaults: L 20, M 40, H 60, VH 80.",
  },
  vr_zones: {
    title: "VR zones",
    what: "Volume-ratio cut-offs for the decision table's columns: low < mid ≤ high. Extreme is used by the panic override.",
    read: "Defaults: mid 0.5, high 1.0, extreme 2.0.",
  },
  panic: {
    title: "Panic override",
    what: "Before the table is used: if VR is at least this value and breadth is below this level, the state is Panic.",
    read: "It catches capitulation days: a volume climax while most stocks are already broken.",
  },
  euphoria: {
    title: "Euphoria override",
    what: "Before the table is used: if breadth is at or above this level, the state is Euphoria regardless of volume.",
  },
  trend_smoothing: {
    title: "Trend & smoothing",
    what: "dP window: how many sessions back the breadth trend (dP) compares. confirm_days: how many consecutive days a new state must appear before it's confirmed.",
    read: "A larger confirm_days gives fewer false flips but slower reaction.",
  },
  decision_table: {
    title: "Decision table",
    what: "The state for every breadth zone × volume zone combination. Starred cells switch to their second state when a trend condition on dP holds.",
  },
  live_preview: {
    title: "Live preview",
    what: "How many stored day × bucket states would change if the edited config were applied, per EMA.",
    read: "A small number means a fine-tune. A large one means you're redefining the states.",
  },
  raw_json: {
    title: "Raw JSON",
    what: "The full config file, including table cells and regime bands. Edit here for anything without a form field, then Apply JSON.",
  },
} satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;
