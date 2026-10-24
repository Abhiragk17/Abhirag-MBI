"use client";

import { BUCKET_LABEL, DEFAULT_RULES, P_ZONE_ORDER, STATE_META, pZoneOf, pZoneWord, vrZoneOf, type RuleGridConfig } from "@/lib/states";
import { fmtDelta, fmtNum } from "@/lib/format";
import type { Bucket, Ema, HistoryRow, RegimeConfig, StateCode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card } from "./ui/card";
import { InfoTip, WithInfo } from "./ui/info";

const VR_ZONES = ["low", "mid", "high"] as const;

/** The P-zone x VR-zone rule table, with the cell that decided today's state highlighted. */
function RuleGrid({ cfg, p, vr, rule, state }: { cfg: RuleGridConfig; p: number; vr: number | null; rule: string | null; state: StateCode | null }) {
  const pz = pZoneOf(p, cfg);
  const vz = vrZoneOf(vr, cfg);
  const z = cfg.p_zones;
  const rowLabel: Record<string, string> = {
    VH: `≥ ${z.VH}%`, H: `${z.H}–${z.VH}%`, M: `${z.M}–${z.H}%`, L: `${z.L}–${z.M}%`, VL: `< ${z.L}%`,
  };
  const colLabel = { low: `< ${cfg.vr_zones.mid}`, mid: `${cfg.vr_zones.mid}–${cfg.vr_zones.high}`, high: `≥ ${cfg.vr_zones.high}` };
  const override = rule?.startsWith("override:") ? rule.slice(9) : null;
  return (
    <div>
      <div className="grid grid-cols-[auto_repeat(3,minmax(0,1fr))] gap-1 text-[11px]">
        <div />
        {VR_ZONES.map((c) => (
          <div key={c} className={cn("pb-0.5 text-center tabular", c === vz ? "font-semibold text-ink" : "text-muted")}>{colLabel[c]}</div>
        ))}
        {[...P_ZONE_ORDER].reverse().map((r) => (
          <div key={r} className="contents">
            <div className={cn("pr-2 text-right leading-6 tabular", r === pz ? "font-semibold text-ink" : "text-muted")}>{rowLabel[r]}</div>
            {VR_ZONES.map((c) => {
              const cell = cfg.table[r]?.[c];
              const base = (typeof cell === "string" ? cell : cell?.state) as StateCode | undefined;
              const alt = typeof cell === "object" && cell ? (cell.alt_state as StateCode) : null;
              const here = r === pz && c === vz;
              const shown = here && state ? state : base;
              const color = shown ? STATE_META[shown].color : "var(--line)";
              return (
                <div
                  key={c}
                  className={cn("flex h-6 items-center justify-center rounded font-semibold tabular", here ? "text-white ring-2 ring-ink ring-offset-1 ring-offset-surface" : "text-ink-2")}
                  style={{ background: here ? color : `${color}26` }}
                  title={alt ? `${base}, or ${alt} when the trend condition holds` : base}
                >
                  {here ? shown : alt ? `${base}/${alt}` : base}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between pl-12 text-[10px] text-muted">
        <span>↑ % above EMA (P)</span>
        <span>Volume ratio (VR) →</span>
      </div>
      {override ? (
        <p className="mt-2 text-[11px] text-ink-2">
          <b>{override === "panic" ? "Panic" : "Euphoria"} override</b> fired before the table
          {override === "panic" ? " (volume climax with weak breadth)." : " (breadth very high)."}
        </p>
      ) : null}
    </div>
  );
}

export function MarketStateCard({
  latest, bucket, ema, raw, setRaw, cfg,
}: {
  latest: Partial<Record<Bucket, HistoryRow>>; bucket: Bucket;
  ema: Ema; raw: boolean; setRaw: (v: boolean) => void; cfg: RegimeConfig | null;
}) {
  const r = latest[bucket];
  const rules: RuleGridConfig = cfg ?? DEFAULT_RULES;
  const state = r ? ((raw ? r[`state_raw_ema${ema}`] : r[`state_ema${ema}`]) as StateCode | null) : null;
  const rawState = r ? (r[`state_raw_ema${ema}`] as StateCode | null) : null;
  const meta = state ? STATE_META[state] : null;
  const p = r?.[`pct_ema${ema}`] ?? null;
  const dp = r?.[`dp_ema${ema}`] ?? null;
  const days = r?.[`days_in_state_ema${ema}`];
  const pending = !raw && rawState && rawState !== state;

  return (
    <Card className="overflow-hidden border-l-4" style={{ borderLeftColor: meta?.color ?? "var(--line)" }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2 text-xs text-ink-2">
        <WithInfo k="market_situation" className="font-semibold text-ink">Market situation</WithInfo>
        <span>{BUCKET_LABEL[bucket]} · EMA{ema}{r ? ` · ${r.date}` : ""}</span>
        <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={raw} onChange={(e) => setRaw(e.target.checked)} className="accent-[#2a78d6]" />
          raw state (no smoothing)
        </label>
        <InfoTip k="raw_state" />
      </div>

      {!r || p == null ? (
        <p className="p-4 text-sm text-muted">No data for this bucket.</p>
      ) : (
        <div className="grid gap-6 p-4 md:grid-cols-[minmax(0,1fr)_260px]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-2xl font-semibold" style={{ color: meta?.color }}>
                {meta ? <><span aria-hidden>{meta.icon}</span> {meta.name}</> : "No state"}
              </h2>
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs font-semibold tabular text-ink-2">{state}</span>
              <WithInfo k="sessions_in_state" className="text-sm text-ink-2">
                {raw ? "raw, today only" : `${days ?? "–"} session${days === 1 ? "" : "s"}`}
              </WithInfo>
            </div>
            {pending ? (
              <p className="mt-1 text-xs text-ink-2">
                Today alone reads <b style={{ color: STATE_META[rawState].color }}>{STATE_META[rawState].name}</b>; it switches if tomorrow agrees.
              </p>
            ) : null}
            {meta ? <p className="mt-1 text-base text-ink">{meta.meaning}.</p> : null}

            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-md bg-surface-2 px-3 py-2">
                <dt className="text-xs text-ink-2"><WithInfo k="breadth">Breadth · % above EMA{ema}</WithInfo></dt>
                <dd className="mt-0.5 flex items-baseline gap-2">
                  <span className="text-xl font-semibold tabular">{fmtNum(p, 1)}%</span>
                  <span className="text-xs text-ink-2">{pZoneWord(pZoneOf(p, rules))}</span>
                </dd>
                <dd className="text-xs text-muted tabular">
                  <WithInfo k="dp">{dp == null ? "no 5-session trend yet" : `${fmtDelta(dp, 1)} pts over 5 sessions`}</WithInfo>
                </dd>
              </div>
              <div className="rounded-md bg-surface-2 px-3 py-2">
                <dt className="text-xs text-ink-2"><WithInfo k="vol_ratio">Volume ratio · heavy ÷ light</WithInfo></dt>
                <dd className="mt-0.5 flex items-baseline gap-2">
                  <span className="text-xl font-semibold tabular">{r.vol_ratio == null ? "n/a" : fmtNum(r.vol_ratio)}</span>
                  <span className="text-xs text-ink-2">{vrZoneOf(r.vol_ratio, rules) === "low" ? "Quiet" : vrZoneOf(r.vol_ratio, rules) === "mid" ? "Moderate" : "Active"}</span>
                </dd>
                <dd className="text-xs text-muted tabular">{r.n_high} heavy vs {r.n_low} light-volume stocks</dd>
              </div>
            </dl>

            {meta ? (
              <p className="mt-4 text-sm">
                <WithInfo k="playbook" className="mr-1 font-semibold">Focus on:</WithInfo>
                <span className="text-ink-2">{meta.focus}</span>
              </p>
            ) : null}
            <p className="mt-3 text-[11px] text-muted tabular">
              <WithInfo k="valid">{r.n_valid} of {r.n_universe} stocks counted{r.n_valid < r.n_universe ? " (others excluded for data reasons)" : ""}</WithInfo>
            </p>
          </div>

          <div>
            <div className="mb-1.5 text-xs font-semibold text-ink-2"><WithInfo k="rule_grid">How it was decided</WithInfo></div>
            <RuleGrid cfg={rules} p={p} vr={r.vol_ratio} rule={r[`rule_ema${ema}`]} state={raw ? state : rawState} />
          </div>
        </div>
      )}
    </Card>
  );
}
