export const QUADRANTS = ["Leading", "Weakening", "Lagging", "Improving"] as const;
export type Quadrant = (typeof QUADRANTS)[number];

/** Quadrant colours carry a text label everywhere they are used. */
export const QUAD_COLOR: Record<Quadrant, string> = {
  Leading: "#008300", Weakening: "#eda100", Lagging: "#e34948", Improving: "#2a78d6",
};

export const PERIODS = ["1D", "1W", "1M", "3M", "6M"] as const;
export type Period = (typeof PERIODS)[number];

export interface GroupRow {
  name: string; slug: string; n_total: number; n_eligible: number; low_n: boolean;
  score: number | null; score_5d: number | null; rank: number | null; rank_5d: number | null;
  rs_ratio: number | null; rs_momentum: number | null; quadrant: Quadrant | null;
  pct_ema20: number | null; pct_ema50: number | null; pct_ema20_5d: number | null;
  pct_near_high: number | null; vol_exp: number | null; spark: (number | null)[]; leaders: string[];
  ret_1D: number | null; ret_1W: number | null; ret_1M: number | null; ret_3M: number | null; ret_6M: number | null;
  rel_1D: number | null; rel_1W: number | null; rel_1M: number | null; rel_3M: number | null; rel_6M: number | null;
}

export interface TopStock {
  symbol: string; group: string; close: number | null; ret_1d: number | null; ret_5d: number | null;
  ret_21d: number | null; ret_63d: number | null; rs: number | null; rel_vol: number | null; role: string; tv_cr: number | null;
}

export interface StockRow extends TopStock {
  ret_126d: number | null; rel_group_21d: number | null; rel_group_63d: number | null; from_high: number | null;
  above_ema20: boolean; above_ema50: boolean; liquid: boolean; new: boolean; traded: boolean; suspect: boolean;
}

export interface Emerging { name: string; slug: string; days_in_leading: number; from: string; score: number | null; ret_1M: number | null; pct_ema20: number | null }
export interface Deteriorating { name: string; slug: string; now: string; left_leading_days_ago: number; score: number | null; ret_1M: number | null }
export interface Thrust { name: string; slug: string; pct_ema20: number; from: number; rise: number; n_eligible: number }

export interface Digest {
  date: string; market_state: string | null;
  leaders: { name: string; slug: string; score: number; quadrant: Quadrant; ret_1M: number; rel_3M: number; pct_ema20: number }[];
  emerging: Emerging[]; deteriorating: Deteriorating[]; thrusts: Thrust[];
  top_stocks: { symbol: string; group: string; ret_1d: number; ret_21d: number; rs: number }[];
  worst_groups: { name: string; slug: string; score: number; quadrant: Quadrant; ret_1M: number }[];
}

export interface ThemesLatest {
  generated_at: string; date: string | null; prev_date: string | null; n_sessions: number; note?: string;
  coverage: { stocks: number; liquid: number; new: number; eligible_today: number; groups: number; symbols_in_file: number; unmapped: string[]; aliased: Record<string, string> };
  config: {
    min_traded_value: number; min_group_size: number; emerging_lookback: number;
    thrust: { lookback: number; rise: number; level: number };
  };
  bench: Record<string, number | null>;
  groups: GroupRow[];
  top_stocks: { gainers: Record<string, TopStock[]>; losers: Record<string, TopStock[]> };
  emerging: Emerging[]; deteriorating: Deteriorating[]; thrusts: Thrust[]; digest: Digest;
}

export interface RrgData {
  dates: string[]; tail_step: number;
  groups: Record<string, { slug: string; low_n: boolean; ratio: (number | null)[]; momentum: (number | null)[]; score: (number | null)[] }>;
}

export interface RegimeData {
  states: string[]; days: Record<string, number>; current: string | null;
  rows: ({ name: string; slug: string } & Record<string, { avg_bps: number | null; hit: number | null; n: number } | string>)[];
}

export interface CorrData {
  window: number; order: string[]; slugs: string[]; matrix: (number | null)[][];
  most_correlated: { a: string; b: string; corr: number }[]; diversifiers: { a: string; b: string; corr: number }[];
}

export interface GroupDetail {
  summary: Omit<GroupRow, "spark">; dates: string[]; index: (number | null)[]; bench: (number | null)[]; rs: (number | null)[];
  ratio: (number | null)[]; momentum: (number | null)[]; pct_ema20: (number | null)[]; pct_ema50: (number | null)[];
  pct_near_high: (number | null)[]; score: (number | null)[]; n: number[]; stocks: StockRow[];
}

export function quadrantAt(ratio: number | null | undefined, mom: number | null | undefined): Quadrant | null {
  if (ratio == null || mom == null) return null;
  if (ratio >= 100) return mom >= 100 ? "Leading" : "Weakening";
  return mom >= 100 ? "Improving" : "Lagging";
}
