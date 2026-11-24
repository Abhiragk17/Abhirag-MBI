// Types, filter engine, presets and saved scans for the Scanner page. Filtering runs in the browser
// over the columnar table written by `python -m mbi screener`.

export interface ScreenField {
  key: string; label: string; group: string; unit: string; desc: string; kind: "num" | "flag"; dec: number;
}
export type Cell = string | number | null;
export interface ScreenerData {
  generated_at: string; date: string | null; archive_start: string; n_sessions: number; n_stocks: number;
  bench: Record<string, { label: string; members: number; returns: Record<string, number | null> }>;
  fields: ScreenField[]; columns: string[]; rows: Cell[][]; error?: string;
}

export type Op = ">" | ">=" | "<" | "<=" | "=" | "between";
export const OPS: { value: Op; label: string }[] = [
  { value: ">=", label: "≥" }, { value: ">", label: ">" }, { value: "<=", label: "≤" },
  { value: "<", label: "<" }, { value: "=", label: "=" }, { value: "between", label: "between" },
];

export interface Condition {
  id: string; field: string; op: Op;
  value: string; value2: string;          // text so half-typed numbers survive re-renders
  vsField: string | null; mult: string;   // compare against another field × multiplier instead of a number
}
export interface Universe {
  buckets: string[]; group: string; minTv: string; tradedOnly: boolean; breadthOnly: boolean; cleanOnly: boolean;
}
export interface Scan { match: "all" | "any"; conditions: Condition[]; universe: Universe }

export const BUCKET_ORDER = ["LARGECAP", "MIDCAP", "SMALLCAP", "MICROCAP", "NANOCAP"];
export const DEFAULT_UNIVERSE: Universe = { buckets: [], group: "", minTv: "1", tradedOnly: true, breadthOnly: false, cleanOnly: true };

let seq = 0;
export const newId = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;
export const blankCondition = (field = "rsi_14d"): Condition => ({ id: newId(), field, op: ">=", value: "", value2: "", vsField: null, mult: "1" });
export const emptyScan = (): Scan => ({ match: "all", conditions: [], universe: { ...DEFAULT_UNIVERSE } });

// ----------------------------------------------------------------------------- engine

export interface Indexed { col: Record<string, number>; field: Record<string, ScreenField>; groups: string[] }

export function indexData(d: ScreenerData): Indexed {
  const col: Record<string, number> = {};
  d.columns.forEach((c, i) => { col[c] = i; });
  const field: Record<string, ScreenField> = {};
  d.fields.forEach((f) => { field[f.key] = f; });
  const gi = col.group;
  const groups = Array.from(new Set(d.rows.map((r) => r[gi]).filter((g): g is string => typeof g === "string"))).sort();
  return { col, field, groups };
}

const num = (s: string): number | null => (s.trim() === "" || Number.isNaN(Number(s)) ? null : Number(s));

/** A condition with nothing to compare against is ignored (not "match nothing"). */
export function isActive(c: Condition, ix: Indexed): boolean {
  if (!(c.field in ix.col)) return false;
  if (c.vsField) return c.vsField in ix.col && num(c.mult) != null;
  return c.op === "between" ? num(c.value) != null && num(c.value2) != null : num(c.value) != null;
}

function test(c: Condition, row: Cell[], ix: Indexed): boolean {
  const l = row[ix.col[c.field]];
  if (typeof l !== "number") return false;
  if (c.op === "between") {
    const a = num(c.value)!, b = num(c.value2)!;
    return l >= Math.min(a, b) && l <= Math.max(a, b);
  }
  let r: number;
  if (c.vsField) {
    const o = row[ix.col[c.vsField]];
    if (typeof o !== "number") return false;
    r = o * num(c.mult)!;
  } else r = num(c.value)!;
  switch (c.op) {
    case ">": return l > r;
    case ">=": return l >= r;
    case "<": return l < r;
    case "<=": return l <= r;
    default: return Math.abs(l - r) < 1e-9;
  }
}

/** Row indices that pass the universe filters and the conditions. */
export function runScan(d: ScreenerData, ix: Indexed, scan: Scan): number[] {
  const u = scan.universe;
  const active = scan.conditions.filter((c) => isActive(c, ix));
  const bi = ix.col.bucket, gi = ix.col.group, ti = ix.col.tv_20d_cr, tdi = ix.col.traded_today, bri = ix.col.in_breadth, ji = ix.col.jump_1y;
  const minTv = num(u.minTv) ?? 0;
  const out: number[] = [];
  d.rows.forEach((row, i) => {
    if (u.buckets.length && !u.buckets.includes(row[bi] as string)) return;
    if (u.group && row[gi] !== u.group) return;
    if (minTv > 0 && !(typeof row[ti] === "number" && (row[ti] as number) >= minTv)) return;
    if (u.tradedOnly && row[tdi] !== 1) return;
    if (u.breadthOnly && row[bri] !== 1) return;
    if (u.cleanOnly !== false && row[ji] === 1) return;      // saved scans from before this option default to clean
    if (active.length) {
      const ok = scan.match === "all" ? active.every((c) => test(c, row, ix)) : active.some((c) => test(c, row, ix));
      if (!ok) return;
    }
    out.push(i);
  });
  return out;
}

// ----------------------------------------------------------------------------- formatting

export function fmtCell(f: ScreenField | undefined, v: Cell): string {
  if (v == null) return "–";
  if (typeof v === "string") return v;
  if (!f) return String(v);
  if (f.kind === "flag") return v ? "✓" : "–";
  if (f.key === "volume" || f.unit === "#") return Math.round(v).toLocaleString("en-IN");
  if (f.dec === 0) return String(Math.round(v));
  const s = v.toLocaleString("en-IN", { minimumFractionDigits: f.dec, maximumFractionDigits: f.dec });
  return f.unit === "%" || f.unit === "pp" ? `${v > 0 && /^(ret_|alpha_|crs_|gap_open)/.test(f.key) ? "+" : ""}${s}` : s;
}

/** Colour a value green/red when its sign means something (returns, alpha, CRS, distance from an average). */
export function signColor(f: ScreenField | undefined, v: Cell): string | undefined {
  if (!f || typeof v !== "number" || v === 0) return undefined;
  if (!/^(ret_|alpha_|crs_|gap_open|macd_hist|.*(sma|ema)_.*_dist$)/.test(f.key)) return undefined;
  return v > 0 ? "var(--good-text)" : "var(--critical)";
}

export const DEFAULT_COLUMNS = ["close", "ret_1d", "ret_1m", "rel_vol", "rsi_14d", "high_52w_dist", "rs_rating"];

// ----------------------------------------------------------------------------- presets

const C = (field: string, op: Op, value: string, extra: Partial<Condition> = {}): Condition =>
  ({ id: newId(), field, op, value, value2: "", vsField: null, mult: "1", ...extra });
const VS = (field: string, op: Op, vsField: string, mult = "1"): Condition => C(field, op, "", { vsField, mult });

export interface Preset { id: string; label: string; desc: string; match?: "all" | "any"; build: () => Condition[] }
export const PRESETS: Preset[] = [
  { id: "breakout", label: "52W high breakout zone", desc: "Within 3% of the 52-week high with momentum aligned (the Breakout Window flag), on above-average volume.",
    build: () => [C("breakout_window", "=", "1"), C("rel_vol", ">=", "1")] },
  { id: "fresh-high", label: "Fresh 52W high", desc: "Made a new 52-week high in the last 5 sessions.", build: () => [C("high_52w_days", "<=", "5"), C("rs_rating", ">=", "60")] },
  { id: "minervini", label: "Trend template + RS 70", desc: "All eight Minervini-style trend checks pass and the RS rating is 70+.", build: () => [C("minervini_pass", "=", "1")] },
  { id: "leaders", label: "Market leaders", desc: "RS rating 80+, beating the market over 3 months, above SMA 50D.", build: () => [C("rs_rating", ">=", "80"), C("alpha_mkt_3m", ">", "0"), VS("close", ">", "sma_50d")] },
  { id: "momentum", label: "Strong momentum", desc: "RSI 60+, ADX 25+ (a real trend) and above the 200-day SMA.", build: () => [C("rsi_14d", ">=", "60"), C("adx_14d", ">=", "25"), C("above_sma200", "=", "1")] },
  { id: "golden", label: "Fresh golden cross", desc: "50D SMA crossed above the 200D SMA within the last 5 sessions.", build: () => [C("gc_50_200d", "<=", "5")] },
  { id: "death", label: "Fresh death cross", desc: "50D SMA crossed below the 200D SMA within the last 5 sessions.", build: () => [C("dc_50_200d", "<=", "5")] },
  { id: "macd", label: "Fresh MACD bullish cross", desc: "The MACD line crossed above its signal line within the last 3 sessions.", build: () => [C("macd_bull_chg", "<=", "3")] },
  { id: "vstop-up", label: "Daily VSTOP flipped up", desc: "The daily volatility stop (14D, 2x) flipped to an uptrend in the last 3 sessions.", build: () => [C("vstop_d14_2p0_up", "=", "1"), C("vstop_d14_2p0_chg", "<=", "3")] },
  { id: "pullback", label: "Pullback to EMA20 in an uptrend", desc: "Close > SMA50 > SMA200 and today's range touched EMA20.", build: () => [C("pullback_ema20", "=", "1")] },
  { id: "vol-up", label: "Volume surge on an up day", desc: "Relative volume 2x+ with a higher close: accumulation.", build: () => [C("vol_surge_up", "=", "1")] },
  { id: "squeeze", label: "Bollinger squeeze", desc: "Volatility compressed to the lowest 20% of its recent range, and above the 200D SMA.", build: () => [C("bb_squeeze", "=", "1"), C("above_sma200", "=", "1")] },
  { id: "vcp", label: "Tight & quiet base (VCP-like)", desc: "Range contracting, volume dried up, within 15% of the 52W high and above the 200D SMA.",
    build: () => [C("vcp_tight", "<=", "0.6"), C("vol_dryup", "=", "1"), C("high_52w_dist", "<=", "15"), C("above_sma200", "=", "1")] },
  { id: "gap", label: "Gap-up with volume", desc: "Opened 2%+ above the previous close on 1.5x relative volume.", build: () => [C("gap_up", "=", "1"), C("rel_vol", ">=", "1.5")] },
  { id: "oversold", label: "Oversold bounce", desc: "RSI 35 or lower, but today closed higher.", build: () => [C("rsi_14d", "<=", "35"), C("streak", ">=", "1")] },
  { id: "extended", label: "Extended (pullback risk)", desc: "More than 8 ATRs above the 50D SMA.", build: () => [C("ext_atr_50", ">=", "8")] },
];

// ----------------------------------------------------------------------------- saved scans (per browser)

const KEY = "mbi.scans.v1";
export interface Saved { name: string; scan: Scan; columns: string[] }
export function loadSaved(): Saved[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function storeSaved(list: Saved[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
}
