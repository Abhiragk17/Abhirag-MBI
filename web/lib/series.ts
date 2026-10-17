import type { Bucket, Ema, HistoryRow, StateCode } from "./types";
import { ALL_BUCKETS } from "./types";

/** Index rows as date -> bucket -> row; dates sorted ascending. */
export function indexRows(rows: HistoryRow[]) {
  const by: Record<string, Partial<Record<Bucket, HistoryRow>>> = {};
  for (const r of rows) (by[r.date] ??= {})[r.bucket] = r;
  const dates = Object.keys(by).sort();
  return { by, dates };
}

export function bucketSeries(rows: HistoryRow[], bucket: Bucket): HistoryRow[] {
  return rows.filter((r) => r.bucket === bucket).sort((a, b) => a.date.localeCompare(b.date));
}

export type RangeKey = "1M" | "3M" | "6M" | "1Y" | "All";
const RANGE_DAYS: Record<RangeKey, number | null> = { "1M": 31, "3M": 92, "6M": 183, "1Y": 366, All: null };

export function filterRange(rows: HistoryRow[], range: RangeKey): HistoryRow[] {
  const days = RANGE_DAYS[range];
  if (!days || !rows.length) return rows;
  const last = rows.reduce((m, r) => (r.date > m ? r.date : m), rows[0].date);
  const cutoff = new Date(new Date(last).getTime() - days * 86400000).toISOString().slice(0, 10);
  return rows.filter((r) => r.date >= cutoff);
}

export const isNonOk = (r: HistoryRow | undefined) => !!r && !!r.data_quality && !["ok", "unknown"].includes(r.data_quality);

export interface StateStatsResult {
  total: number;
  byState: Record<StateCode, { days: number; pct: number; runs: number; avgRun: number; longest: number }>;
  transitions: Record<StateCode, Record<StateCode, number>>;
}

export function stateStats(rows: HistoryRow[], bucket: Bucket, ema: Ema, raw: boolean): StateStatsResult {
  const codes: StateCode[] = ["BD", "LD", "EU", "BR", "LS", "PA"];
  const seq = bucketSeries(rows, bucket)
    .map((r) => (raw ? r[`state_raw_ema${ema}`] : r[`state_ema${ema}`]) as StateCode | null)
    .filter((s): s is StateCode => !!s);
  const byState = Object.fromEntries(codes.map((c) => [c, { days: 0, pct: 0, runs: 0, avgRun: 0, longest: 0 }])) as StateStatsResult["byState"];
  const transitions = Object.fromEntries(codes.map((c) => [c, Object.fromEntries(codes.map((d) => [d, 0]))])) as StateStatsResult["transitions"];
  let run = 0;
  seq.forEach((s, i) => {
    byState[s].days++;
    if (i > 0 && seq[i - 1] !== s) transitions[seq[i - 1]][s]++;
    run = i > 0 && seq[i - 1] === s ? run + 1 : 1;
    if (i === seq.length - 1 || seq[i + 1] !== s) {
      byState[s].runs++;
      byState[s].longest = Math.max(byState[s].longest, run);
    }
  });
  for (const c of codes) {
    const b = byState[c];
    b.pct = seq.length ? (100 * b.days) / seq.length : 0;
    b.avgRun = b.runs ? b.days / b.runs : 0;
  }
  return { total: seq.length, byState, transitions };
}

export const BUCKET_ROWS = ALL_BUCKETS;
