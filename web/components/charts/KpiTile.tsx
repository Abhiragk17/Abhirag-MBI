"use client";

import { BUCKET_LABEL, REGIME_LABEL, STATE_META } from "@/lib/states";
import { fmtDelta, fmtNum, fmtPct } from "@/lib/format";
import type { Bucket, Ema, HistoryRow, StateCode } from "@/lib/types";
import { EMAS } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Tiny inline-SVG sparkline (no axes; the tile values carry the numbers). */
function Sparkline({ values, color }: { values: (number | null)[]; color: string }) {
  const v = values.filter((x): x is number => x != null);
  if (v.length < 2) return <div className="h-6" />;
  const min = Math.min(...v);
  const max = Math.max(...v);
  const w = 100;
  const h = 24;
  const pts = values
    .map((x, i) => (x == null ? null : `${(i / (values.length - 1)) * w},${h - 2 - ((x - min) / (max - min || 1)) * (h - 4)}`))
    .filter(Boolean)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-6 w-full" preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function KpiTile({
  bucket, series, ema, selected, onSelect, dark,
}: { bucket: Bucket; series: HistoryRow[]; ema: Ema; selected: boolean; onSelect: () => void; dark: boolean }) {
  const last = series.at(-1);
  const prev = series.at(-2);
  const spark = series.slice(-30);
  const ink = dark ? "#c3c2b7" : "#52514e";
  if (!last) {
    return (
      <div className="rounded-lg border border-line bg-surface p-3">
        <div className="text-xs font-semibold">{BUCKET_LABEL[bucket]}</div>
        <div className="mt-2 text-xs text-muted">No data</div>
      </div>
    );
  }
  const state = last[`state_ema${ema}`] as StateCode | null;
  const vrDelta = last.vol_ratio != null && prev?.vol_ratio != null ? last.vol_ratio - prev.vol_ratio : null;
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      className={cn("rounded-lg border bg-surface p-3 text-left transition-colors hover:bg-surface-2", selected ? "border-ink" : "border-line")}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">{BUCKET_LABEL[bucket]}</span>
        {state ? (
          <span className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ background: STATE_META[state].color }} title={STATE_META[state].name}>
            {STATE_META[state].icon} {state}
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold">{last.vol_ratio == null ? "–" : fmtNum(last.vol_ratio)}</span>
        <span className="text-xs text-ink-2 tabular">{fmtDelta(vrDelta, 2)}</span>
      </div>
      <div className="text-[11px] text-ink-2">
        VR · {last.vol_regime ? REGIME_LABEL[last.vol_regime] ?? last.vol_regime : "–"}
        {last.vol_ratio == null ? ` (${last.n_high} high / 0 low)` : ""}
      </div>
      <Sparkline values={spark.map((r) => r.vol_ratio)} color={ink} />
      <div className="mt-1 grid grid-cols-3 gap-1">
        {EMAS.map((e) => {
          const p = last[`pct_ema${e}`];
          const d = p != null && prev?.[`pct_ema${e}`] != null ? p - (prev[`pct_ema${e}`] as number) : null;
          return (
            <div key={e} className={cn("rounded px-1 py-0.5", e === ema ? "bg-surface-2" : "")}>
              <div className="text-[10px] text-muted">EMA{e}</div>
              <div className={cn("text-sm tabular", e === ema ? "font-semibold" : "")}>{fmtPct(p, 0)}</div>
              <div className="text-[10px] text-ink-2 tabular">{fmtDelta(d, 1)}</div>
            </div>
          );
        })}
      </div>
      <Sparkline values={spark.map((r) => r[`pct_ema${ema}`])} color={ink} />
      <div className="mt-1 text-[10px] text-muted tabular">valid {last.n_valid} / {last.n_universe}</div>
    </button>
  );
}
