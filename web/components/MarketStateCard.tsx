"use client";

import { BUCKET_LABEL, STATE_META, explain, ruleText } from "@/lib/states";
import { fmtNum, fmtPct } from "@/lib/format";
import type { Bucket, Ema, HistoryRow, StateCode } from "@/lib/types";
import { ALL_BUCKETS } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card } from "./ui/card";
import { StateBadge } from "./StateBadge";

export function MarketStateCard({
  latest, bucket, setBucket, ema, raw, setRaw,
}: {
  latest: Partial<Record<Bucket, HistoryRow>>; bucket: Bucket; setBucket: (b: Bucket) => void;
  ema: Ema; raw: boolean; setRaw: (v: boolean) => void;
}) {
  const r = latest[bucket];
  const state = r ? ((raw ? r[`state_raw_ema${ema}`] : r[`state_ema${ema}`]) as StateCode | null) : null;
  const rawState = r ? (r[`state_raw_ema${ema}`] as StateCode | null) : null;
  const meta = state ? STATE_META[state] : null;
  return (
    <Card className="overflow-hidden">
      <div className="h-1" style={{ background: meta?.color ?? "var(--line)" }} />
      <div className="grid gap-4 p-4 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">Market situation · {BUCKET_LABEL[bucket]} · EMA{ema}</h2>
            <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-xs text-ink-2">
              <input type="checkbox" checked={raw} onChange={(e) => setRaw(e.target.checked)} className="accent-[#2a78d6]" />
              show raw state (no smoothing)
            </label>
          </div>
          {r ? (
            <>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <StateBadge state={state} size="lg" explainText={explain(r, ema, raw)} />
                <span className="text-sm text-ink-2 tabular">
                  {raw ? "raw state" : `${r[`days_in_state_ema${ema}`] ?? "–"} session(s) in state`}
                </span>
                {!raw && rawState && rawState !== state ? (
                  <span className="text-xs text-ink-2">raw today: <b>{STATE_META[rawState].icon} {rawState}</b> (awaiting confirmation)</span>
                ) : null}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                <div><dt className="text-xs text-muted">% above EMA{ema} (P)</dt><dd className="font-semibold tabular">{fmtPct(r[`pct_ema${ema}`])}</dd></div>
                <div><dt className="text-xs text-muted">Volume ratio (VR)</dt><dd className="font-semibold tabular">{r.vol_ratio == null ? "null" : fmtNum(r.vol_ratio)}</dd></div>
                <div><dt className="text-xs text-muted">dP (5 sessions)</dt><dd className="font-semibold tabular">{r[`dp_ema${ema}`] == null ? "–" : fmtNum(r[`dp_ema${ema}`], 1)}</dd></div>
                <div><dt className="text-xs text-muted">Rule</dt><dd className="font-medium">{ruleText(r[`rule_ema${ema}`])}</dd></div>
              </dl>
              <p className="mt-2 text-xs text-muted tabular">{r.date} · {r.n_high} high / {r.n_low} low volume · {r.n_valid} valid of {r.n_universe}</p>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted">No data for this bucket.</p>
          )}
        </div>
        <div className="rounded-md bg-surface-2 p-3">
          {meta ? (
            <>
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-2">Playbook</div>
              <p className="mt-1 text-sm font-medium">{meta.meaning}</p>
              <p className="mt-2 text-sm"><span className="text-ink-2">Focus on: </span>{meta.focus}</p>
            </>
          ) : (
            <p className="text-sm text-muted">No state.</p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-line px-4 py-2">
        {ALL_BUCKETS.map((b) => {
          const rr = latest[b];
          const s = rr ? ((raw ? rr[`state_raw_ema${ema}`] : rr[`state_ema${ema}`]) as StateCode | null) : null;
          return (
            <button
              key={b}
              onClick={() => setBucket(b)}
              aria-pressed={b === bucket}
              className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs", b === bucket ? "border-ink bg-surface-2" : "border-line hover:bg-surface-2")}
              title={rr && s ? explain(rr, ema, raw) : undefined}
            >
              <span className="font-medium">{BUCKET_LABEL[b]}</span>
              {s ? (
                <span className="rounded px-1 text-[10px] font-bold text-white" style={{ background: STATE_META[s].color }}>
                  {STATE_META[s].icon} {s}
                </span>
              ) : <span className="text-muted">–</span>}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
