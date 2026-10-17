export const BUCKETS = ["LARGECAP", "MIDCAP", "SMALLCAP", "MICROCAP", "NANOCAP"] as const;
export const ALL_BUCKETS = [...BUCKETS, "ALL"] as const;
export type Bucket = (typeof ALL_BUCKETS)[number];
export type Ema = 10 | 20 | 50;
export const EMAS: Ema[] = [10, 20, 50];
export type StateCode = "BD" | "LD" | "EU" | "BR" | "LS" | "PA";

export interface HistoryRow {
  date: string;
  bucket: Bucket;
  universe_version: string | null;
  n_universe: number;
  n_valid: number;
  n_excluded: number;
  n_high: number;
  n_low: number;
  vol_ratio: number | null;
  vol_regime: string | null;
  n_above_ema10: number;
  n_above_ema20: number;
  n_above_ema50: number;
  pct_ema10: number | null;
  pct_ema20: number | null;
  pct_ema50: number | null;
  state_ema10: StateCode | null;
  state_ema20: StateCode | null;
  state_ema50: StateCode | null;
  state_raw_ema10: StateCode | null;
  state_raw_ema20: StateCode | null;
  state_raw_ema50: StateCode | null;
  rule_ema10: string | null;
  rule_ema20: string | null;
  rule_ema50: string | null;
  dp_ema10: number | null;
  dp_ema20: number | null;
  dp_ema50: number | null;
  days_in_state_ema10: number | null;
  days_in_state_ema20: number | null;
  days_in_state_ema50: number | null;
  data_source: string | null;
  data_quality: string | null;
}

export interface DayStatus {
  status: "ok" | "recovered" | "fallback" | "partial" | "failed";
  source: string | null;
  attempts: number;
  errors: string[];
  missing_symbols: string[];
  excluded_symbols: { symbol: string; reason: string }[];
  suspected_events?: { symbol: string; bucket: string; ratio: number; hint: string }[];
  excluded_summary?: Record<string, number>;
  recovered_events?: string[];
  notes?: string[];
  fallback_sources?: string[];
  stale: boolean;
  updated_at: string | null;
}

export interface StatusFile {
  updated_at: string | null;
  offline: boolean;
  offline_since: string | null;
  last_run: {
    command: string;
    started_at: string;
    finished_at: string | null;
    ok: boolean | null;
    error: string | null;
    traceback: string | null;
    log_file: string | null;
    summary: string | null;
  } | null;
  universe: {
    version: string;
    source: string;
    age_days: number;
    nanocap_stale: boolean;
    nanocap_note: string | null;
    warnings: string[];
    counts?: Record<string, number>;
  } | null;
  calendar: { source: string; note: string | null } | null;
  days: Record<string, DayStatus>;
  events: { ts: string; kind: string; detail: string; url?: string; date?: string }[];
}

export interface StatusResponse {
  status: StatusFile | null;
  latestDate: string | null;
  badge: "ok" | "warn" | "partial" | "error";
  badgeLabel: string;
  banners: Banner[];
  warnings: string[];
  generatedAt: string;
}

export interface Banner {
  id: string;
  level: "info" | "warn" | "partial" | "error";
  message: string;
  details?: string[];
  link?: string;
}

export interface BreadthResponse {
  rows: HistoryRow[];
  source: "csv" | "parquet" | "latest_json" | "none";
  warnings: string[];
}

export interface RegimeConfig {
  p_zones: { L: number; M: number; H: number; VH: number };
  vr_zones: { mid: number; high: number; extreme: number };
  table: Record<string, Record<string, string | { state: string; alt_state: string; alt_when: Record<string, number> }>>;
  overrides: { panic: { enabled: boolean; vr_min: number; p_max: number }; euphoria: { enabled: boolean; p_min: number } };
  null_vr_zone: string;
  trend: { enabled: boolean; dp_window: number; missing_dp: number };
  confirm_days: number;
  vr_regimes: { min: number | null; max: number | null; id: string; label: string }[];
  boundary_margin?: { p: number; vr: number };
  [k: string]: unknown;
}

export interface StockRow {
  symbol: string;
  bucket: Bucket;
  close: number | null;
  adj_close: number | null;
  volume: number | null;
  avgvol20: number | null;
  rel_vol: number | null;
  ema10: number | null;
  ema20: number | null;
  ema50: number | null;
  above_ema10: boolean;
  above_ema20: boolean;
  above_ema50: boolean;
  valid: boolean;
  reason: string;
  adj_factor: number | null;
}
