"use client";

import { BUCKET_LABEL, REGIME_LABEL, STATE_META } from "@/lib/states";
import { fmtDelta, fmtNum, fmtPct } from "@/lib/format";
import type { Bucket, Ema, HistoryRow, StateCode } from "@/lib/types";
import { EMAS } from "@/lib/types";
import { cn } from "@/lib/utils";
import { InfoTip, WithInfo } from "../ui/info";

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
  if (!last) {
    return (
      <div className="rounded-lg border border-line bg-surface p-3">
        <div className="text-xs font-semibold">{BUCKET_LABEL[bucket]}</div>
        <div className="mt-2 text-xs text-muted">No data</div>
      </div>
    );
  }
  const state = last[`state_ema${ema}`] as StateCode | null;
  const meta = state ? STATE_META[state] : null;
  const p = last[`pct_ema${ema}`];
  const pPrev = prev?.[`pct_ema${ema}`];
  const pDelta = p != null && pPrev != null ? p - pPrev : null;
  const vrDelta = last.vol_ratio != null && prev?.vol_ratio != null ? last.vol_ratio - prev.vol_ratio : null;
  const others = EMAS.filter((e) => e !== ema);
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex flex-col rounded-lg border bg-surface p-3 text-left transition-colors hover:bg-surface-2",
        selected ? "border-ink ring-1 ring-ink" : "border-line",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{BUCKET_LABEL[bucket]}</span>
        {meta ? (
          <span className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ background: meta.color }} title={meta.name}>
            {meta.icon} {state}
          </span>
        ) : null}
      </div>
      <div className="text-[11px]" style={{ color: meta?.color }}>{meta?.short ?? "–"}</div>

      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular">{fmtPct(p, 0)}</span>
        <span className="text-xs text-ink-2 tabular">{fmtDelta(pDelta, 1)}</span>
      </div>
      <div className="text-[11px] text-muted"><WithInfo k="breadth" focusable={false}>above EMA{ema}</WithInfo></div>
      <Sparkline values={spark.map((r) => r[`pct_ema${ema}`])} color={meta?.color ?? (dark ? "#c3c2b7" : "#52514e")} />

      <div className="mt-2 flex items-baseline justify-between gap-2 border-t border-line pt-2">
        <WithInfo k="vol_ratio" focusable={false} className="text-[11px] text-muted">Vol. ratio</WithInfo>
        <span className="text-sm font-semibold tabular">
          {last.vol_ratio == null ? "n/a" : fmtNum(last.vol_ratio)}
          <span className="ml-1 text-[10px] font-normal text-ink-2">{fmtDelta(vrDelta, 2)}</span>
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-1 text-[11px] text-ink-2">
        <span className="truncate">{last.vol_regime ? REGIME_LABEL[last.vol_regime] ?? last.vol_regime : "–"}</span>
        <InfoTip k="vol_regime" focusable={false} />
      </div>

      <div className="mt-2 flex justify-between text-[10px] text-muted tabular">
        <span>{others.map((e) => `EMA${e} ${fmtPct(last[`pct_ema${e}`], 0)}`).join(" · ")}</span>
        {last.n_valid < last.n_universe ? <span title="valid / universe">{last.n_valid}/{last.n_universe}</span> : null}
      </div>
    </button>
  );
}
