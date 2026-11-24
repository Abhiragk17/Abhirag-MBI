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
  th_page: {
    title: "Themes & sector rotation",
    what: "Groups the 1,297 stocks in your theme file into 112 industries and themes, and shows which ones are leading, rotating in, or fading.",
    read: "Start with the Leaderboard for who leads, then the Rotation graph for who is turning, then Movers for individual stocks.",
  },
  th_group_index: {
    title: "Group index",
    what: "An equal-weight index of the group's counted stocks: each day it moves by the average return of those stocks, chained over time.",
    read: "Equal weight keeps one giant stock from dominating a small theme. It is not a tradable index.",
  },
  th_market_bar: {
    title: "Market (equal weight)",
    what: "The benchmark every group is compared with: an equal-weight index of every counted stock across all groups.",
    read: "If a group beats this line, it is outperforming the typical theme stock, not a cap-weighted index like the Nifty.",
  },
  th_recompute: {
    title: "Recompute themes",
    what: "Re-runs the theme analytics (python -m mbi themes) from the stored price archive. It does not download anything.",
    read: "Use it after changing settings or the group list on the Config page. The normal daily refresh already does this for you.",
  },
  th_low_n: {
    title: "Show low-n groups",
    what: "Low-n means the group has fewer counted stocks than the minimum (default 3), usually because most of its stocks are illiquid or newly listed.",
    read: "With so few stocks one name decides the whole group, so these are hidden from rankings and the rotation graph. Tick the box to see them anyway, and treat them with caution.",
  },
  th_leaderboard: {
    title: "Group leaderboard",
    what: "All groups ranked by the leadership score, with returns, breadth and volume side by side. Click a header to sort and a group name to open it.",
    read: "Score near 100 with Leading quadrant, high %>EMA20 and rising volume is the strongest picture. Rank arrows show the change over 5 sessions.",
  },
  th_score: {
    title: "Leadership score (0-100)",
    what: "A blend of four percentile ranks across all groups: relative strength vs the market over 1M/3M/6M, breadth inside the group, RS momentum, and traded-value expansion.",
    read: "90 means ahead of 90% of groups on the blend. It is relative: in a falling market the best group can still be falling. Weights are editable on the Config page.",
  },
  th_quadrant: {
    title: "Rotation quadrant",
    what: "Where the group sits on the rotation graph: Leading (strong and gaining), Weakening (strong but fading), Lagging (weak and fading), Improving (weak but gaining).",
    read: "Groups usually move clockwise: Improving → Leading → Weakening → Lagging.",
  },
  th_rel_3m: {
    title: "3M vs market",
    what: "The group's 3-month return minus the market's, in percentage points.",
    read: "Positive means it beat the average theme stock over 3 months, whatever the market did.",
  },
  th_pct_ema: {
    title: "% above EMA",
    what: "The share of the group's counted stocks closing above their EMA20 (or EMA50).",
    read: "High and rising means the whole group is participating, not just one stock. The arrow shows the change over 5 sessions.",
  },
  th_near_high: {
    title: "Near 52-week high",
    what: "The share of counted stocks within 5% of their 52-week high.",
    read: "Leading themes usually have many stocks near highs.",
  },
  th_vol_exp: {
    title: "Volume expansion",
    what: "The group's average traded value over the last 10 sessions divided by its average over the last 60.",
    read: "Above 1 means more money is flowing in than usual. Below 1 means interest is drying up.",
  },
  th_n: {
    title: "Stocks counted (n)",
    what: "Counted stocks / stocks in the group. A stock counts when it has enough history and enough daily traded value.",
    read: "A big gap means many stocks are illiquid or new, so the group index rests on fewer names.",
  },
  th_heatmap: {
    title: "Group heatmap",
    what: "Every group as a tile, coloured by the metric you pick and sized by how many stocks are counted. Hover for details, click to open.",
    read: "Look for clusters of green (leaders) or red (laggards) sharing a theme. Use the metric switch to compare return, outperformance, score and breadth.",
  },
  th_rrg: {
    title: "Rotation graph (RRG)",
    what: "Plots every group by RS-Ratio (is it stronger than the market over the medium term?) and RS-Momentum (is that strength rising or falling?). Both are centred on 100.",
    read: "Right side = outperforming, top = gaining. The tail shows where the group was in recent weeks, ending at the dot. Click a dot to open the group.",
  },
  th_rs_ratio: {
    title: "RS-Ratio",
    what: "The group's relative strength line (group index ÷ market index) divided by its own moving average, times 100.",
    read: "Above 100 means the group is above its recent relative trend, so it is outperforming.",
  },
  th_rs_momentum: {
    title: "RS-Momentum",
    what: "100 plus the change in RS-Ratio over the momentum window (default 10 sessions).",
    read: "Above 100 means relative strength is rising. A Leading group whose momentum dips below 100 moves to Weakening, an early warning.",
  },
  th_rrg_pick: {
    title: "Groups shown",
    what: "Which groups are plotted. Top 15 / Top 30 use the leadership score on the as-of date. Leading and Improving filter by quadrant.",
    read: "Showing fewer groups keeps the chart readable. 'All' can get crowded.",
  },
  th_rrg_tail: {
    title: "Tail length",
    what: "How many weeks of history each group's trail shows (one point per week).",
    read: "Long tails show a group's full rotation. Short tails show only the latest move.",
  },
  th_rrg_asof: {
    title: "As-of date and play",
    what: "Move the slider to see the chart as it looked on an earlier date, or press Play to watch groups rotate over time.",
    read: "Useful for seeing how past leaders entered Leading, and how long leadership lasted.",
  },
  th_rrg_highlight: {
    title: "Highlight a group",
    what: "Picks one group and dims the others so you can follow its path.",
    read: "The listing beside the chart shows every group by quadrant, with its score.",
  },
  th_movers: {
    title: "Top movers",
    what: "The biggest gainers and losers over the chosen period, for groups (index return) and for stocks.",
    read: "Stocks shown are liquid, not newly listed, and traded today, so illiquid circuit-limit names don't crowd the list.",
  },
  th_rs_stock: {
    title: "Stock RS",
    what: "The stock's percentile rank (0-100) across all liquid theme stocks, averaged over its 1M, 3M and 6M returns.",
    read: "80 means it has beaten 80% of theme stocks. It is relative, not absolute.",
  },
  th_role: {
    title: "Leader / laggard",
    what: "Leader: RS 70 or more and beating its own group over 3 months. Laggard: RS under 30 and trailing its group. New: listed within the last 60 sessions.",
    read: "Leaders in leading groups are the usual place to look for continuation setups.",
  },
  th_vs_group: {
    title: "Vs group",
    what: "The stock's return minus its own group's index return over the same period.",
    read: "Positive means the stock is outperforming its peers, not just riding the theme.",
  },
  th_rel_vol: {
    title: "Relative volume",
    what: "Today's volume divided by the stock's average of the previous 20 sessions.",
    read: "Above 1.5 means unusual activity. Very high values on thin stocks are common and less meaningful.",
  },
  th_explorer: {
    title: "Stock explorer",
    what: "Every liquid theme stock in one table. Filter by group or role, search by symbol, and click a header to sort.",
    read: "Try role = Leaders with a leading group selected to shortlist candidates.",
  },
  th_digest: {
    title: "Daily digest",
    what: "A one-screen summary: the leading groups, leader stocks inside them, the weakest groups, and the alerts.",
    read: "Download it as Markdown or JSON, or export the watchlist.",
  },
  th_emerging: {
    title: "Emerging themes",
    what: "Groups that moved from Improving or Lagging into Leading within the last N sessions (default 10).",
    read: "Early rotation signal: a fresh entry into Leading with rising breadth is more interesting than a group that has been Leading for months.",
  },
  th_deteriorating: {
    title: "Losing leadership",
    what: "Groups that were Leading within the last N sessions and are now Weakening or Lagging.",
    read: "A warning to tighten risk on stocks from these groups.",
  },
  th_thrust: {
    title: "Breadth thrust",
    what: "The share of a group's stocks above EMA20 rose sharply (default 30+ points in 5 sessions) to a high level (default 60%+).",
    read: "Many stocks turning up together suggests real group-wide demand rather than one stock's move.",
  },
  th_watchlist: {
    title: "Watchlist export",
    what: "A text file in the same ###GROUP,NSE:SYMBOL format as your source file: the top stocks (by RS, above EMA50, liquid) of the leading groups.",
    read: "Import it into TradingView as a watchlist. Group and stock counts are set on the Config page.",
  },
  th_regime: {
    title: "Groups by market state",
    what: "For each market-breadth state (BD, LD, EU, BR, LS, PA), the average daily return of each group minus the market, on days the market was in that state.",
    read: "It shows what has tended to work in each state. It is descriptive, not a forecast, and states with few days give noisy numbers.",
  },
  th_corr: {
    title: "Group correlation",
    what: "How closely groups' daily returns move together over the last 60 sessions (1 = identical). The heatmap is ordered so similar groups sit together.",
    read: "Two high-correlation groups are effectively the same bet. Low or negative pairs diversify.",
  },
  th_corr_pick: {
    title: "Pick a group",
    what: "Lists the groups that move most and least like the one you choose.",
    read: "Use it to find real diversifiers for a position.",
  },
  th_group_page: {
    title: "Group page",
    what: "Everything about one group: its index against the market, relative strength, rotation, internal breadth, score history and every stock in it.",
    read: "Faded rows are illiquid stocks that are excluded from the group index.",
  },
  th_illiquid: {
    title: "Illiquid",
    what: "Stocks whose 20-day median traded value is below the minimum on the Config page.",
    read: "They appear in the table but don't affect the group index or the rankings.",
  },
  cfgth_liquidity: {
    title: "Liquidity filter",
    what: "A stock counts in a group only if its 20-day median daily traded value is at least this amount (shown in lakh rupees; 100 lakh = 1 crore).",
    read: "Higher values give cleaner, tradable groups but fewer stocks per group. Lower values include thin micro-caps that can distort small groups.",
  },
  cfgth_history: {
    title: "History and new listings",
    what: "Minimum sessions before a stock counts (skips IPO noise), and how young a stock must be to be tagged 'new'.",
    read: "Recent IPOs often jump 50%+ on listing. Raising the minimum keeps them out longer.",
  },
  cfgth_winsor: {
    title: "Daily return clip",
    what: "Each stock's daily return is capped at this percentage up or down before averaging into the group.",
    read: "Stops a single circuit-limit day from moving a small group. 20% matches NSE's widest regular band.",
  },
  cfgth_min_size: {
    title: "Group size limits",
    what: "Minimum counted stocks for a group to be ranked, and the minimum counted on a given day for the group index to move.",
    read: "Raising the first hides more thin groups. The second only matters on days when many stocks in a group did not trade.",
  },
  cfgth_rrg: {
    title: "Rotation windows",
    what: "RS-Ratio window: the moving-average length that RS is compared with. Momentum window: the lookback for the change in RS-Ratio. Tail step: sessions between tail points. History: how many sessions the graph keeps.",
    read: "Longer windows give smoother, slower rotation. Shorter windows react faster but jitter more.",
  },
  cfgth_weights: {
    title: "Score weights",
    what: "How much each component contributes to the leadership score. They are normalised, so only the ratios matter.",
    read: "Raise 'Relative strength' for a pure trend view. Raise 'Breadth' to favour groups where most stocks participate.",
  },
  cfgth_alerts: {
    title: "Alert thresholds",
    what: "Emerging/deteriorating look-back, and the breadth thrust rule: rise in % above EMA20, within a number of sessions, to at least a level.",
    read: "Tighter thresholds give fewer, stronger alerts.",
  },
  cfgth_misc: {
    title: "Correlation, lists and watchlist",
    what: "Correlation window in sessions, how many stocks each top list shows, and how many groups and stocks per group go into the watchlist export.",
  },
  cfgth_aliases: {
    title: "Symbol aliases",
    what: "Maps a symbol in your group list to the NSE symbol used in the price archive when they differ (for example M_M → M&M).",
    read: "Characters like _ are already tried as & and - automatically. Add an alias only for symbols that still show as unmapped.",
  },
  cfgth_list: {
    title: "Group list",
    what: "The groups and their stocks, one group per line: ###GROUP NAME,NSE:SYMBOL,NSE:SYMBOL. A stock that appears in two groups stays in the first.",
    read: "Saving writes data/config/themes.txt and leaves the original file untouched. Reset returns to the original list.",
  },
} satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;
