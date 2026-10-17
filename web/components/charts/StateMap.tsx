"use client";

import type { EChartsOption } from "echarts";
import { useEffect, useMemo, useState } from "react";
import { BUCKET_LABEL, STATE_META, explain } from "@/lib/states";
import { bucketSeries } from "@/lib/series";
import type { Bucket, Ema, HistoryRow, RegimeConfig, StateCode } from "@/lib/types";
import { fmtNum, fmtPct } from "@/lib/format";
import { axisStyle, baseOption, ChartTokens, EChart } from "./EChart";

const VR_MIN = 0.05;
const VR_MAX = 8;
const TRAIL = 10;

function cellState(cell: unknown): { base: StateCode; alt?: StateCode } {
  if (typeof cell === "string") return { base: cell as StateCode };
  const c = cell as { state: StateCode; alt_state: StateCode };
  return { base: c.state, alt: c.alt_state };
}

export function StateMap({
  rows, bucket, ema, t, cfg,
}: { rows: HistoryRow[]; bucket: Bucket; ema: Ema; t: ChartTokens; cfg: RegimeConfig | null }) {
  const series = useMemo(() => bucketSeries(rows, bucket).filter((r) => r[`pct_ema${ema}`] != null), [rows, bucket, ema]);
  const [idx, setIdx] = useState(series.length - 1);
  useEffect(() => setIdx(series.length - 1), [series.length]);
  const cur = series[Math.min(idx, series.length - 1)];

  const option = useMemo<EChartsOption>(() => {
    const ax = axisStyle(t);
    const pz = cfg?.p_zones ?? { L: 20, M: 40, H: 60, VH: 80 };
    const vz = cfg?.vr_zones ?? { mid: 0.5, high: 1, extreme: 2 };
    const pEdges: [string, number, number][] = [["VL", 0, pz.L], ["L", pz.L, pz.M], ["M", pz.M, pz.H], ["H", pz.H, pz.VH], ["VH", pz.VH, 100]];
    const vEdges: [string, number, number][] = [["low", VR_MIN, vz.mid], ["mid", vz.mid, vz.high], ["high", vz.high, VR_MAX]];
    const areas: unknown[] = [];
    const labels: unknown[] = [];
    for (const [pzName, p0, p1] of pEdges) {
      for (const [vzName, v0, v1] of vEdges) {
        const cell = cfg?.table?.[pzName]?.[vzName];
        if (!cell) continue;
        const { base, alt } = cellState(cell);
        areas.push([{ xAxis: p0, yAxis: v0, itemStyle: { color: STATE_META[base].color, opacity: t.dark ? 0.16 : 0.1 } }, { xAxis: p1, yAxis: v1 }]);
        labels.push({ value: [(p0 + p1) / 2, Math.sqrt(v0 * v1)], label: alt ? `${base} / ${alt}*` : base });
      }
    }
    const pan = cfg?.overrides?.panic;
    if (pan?.enabled) areas.push([{ xAxis: 0, yAxis: pan.vr_min, itemStyle: { color: STATE_META.PA.color, opacity: t.dark ? 0.28 : 0.18 } }, { xAxis: pan.p_max, yAxis: VR_MAX }]);

    const end = Math.min(idx, series.length - 1);
    const trail = series.slice(Math.max(0, end - TRAIL + 1), end + 1);
    const pt = (r: HistoryRow) => [r[`pct_ema${ema}`], r.vol_ratio == null ? VR_MAX * 0.9 : Math.min(VR_MAX, Math.max(VR_MIN, r.vol_ratio))];
    const history = series.slice(0, end + 1).map((r) => ({ value: pt(r), date: r.date }));
    const trailData = trail.map((r, i) => ({
      value: pt(r), date: r.date,
      itemStyle: { color: t.ink, opacity: 0.25 + (0.75 * (i + 1)) / trail.length },
      symbolSize: 5 + (5 * (i + 1)) / trail.length,
    }));
    const latest = trail.at(-1);
    const byDate = Object.fromEntries(series.map((r) => [r.date, r]));
    return {
      ...baseOption(t),
      grid: { left: 52, right: 20, top: 16, bottom: 44 },
      xAxis: { type: "value", min: 0, max: 100, name: `% above EMA${ema}`, nameLocation: "middle", nameGap: 26, nameTextStyle: { color: t.muted, fontSize: 11 }, ...ax,
        splitLine: { show: false }, axisLabel: { ...ax.axisLabel, formatter: "{value}%" } },
      yAxis: { type: "log", min: VR_MIN, max: VR_MAX, name: "Volume ratio (log)", nameTextStyle: { color: t.muted, fontSize: 11 }, ...ax, splitLine: { show: false } },
      tooltip: {
        ...baseOption(t).tooltip,
        trigger: "item",
        formatter: (p: unknown) => {
          const d = (p as { data?: { date?: string } }).data?.date;
          const r = d ? byDate[d] : undefined;
          if (!r) return "";
          const s = r[`state_ema${ema}`] as StateCode | null;
          return `<b>${d}</b> · ${BUCKET_LABEL[bucket]}<br/>P = <b>${fmtPct(r[`pct_ema${ema}`])}</b>, VR = <b>${r.vol_ratio == null ? "null" : fmtNum(r.vol_ratio)}</b><br/>${s ? `${STATE_META[s].icon} ${STATE_META[s].name}` : ""}<br/><span style="color:${t.ink2}">${explain(r, ema)}</span>`;
        },
      },
      series: [
        {
          type: "scatter", name: "zones", silent: true, symbolSize: 0, data: labels as never,
          label: { show: true, formatter: (p: unknown) => (p as { data: { label: string } }).data.label, color: t.ink2, fontSize: 11, fontWeight: 600 },
          markArea: { silent: true, data: areas as never },
          markLine: {
            silent: true, symbol: "none", label: { show: false }, lineStyle: { color: t.axis, type: "solid" as const, width: 1 },
            data: [...[pz.L, pz.M, pz.H, pz.VH].map((x) => ({ xAxis: x })), ...[vz.mid, vz.high, vz.extreme].map((y) => ({ yAxis: y }))] as never,
          },
        },
        { type: "scatter", name: "history", data: history as never, symbolSize: 4, itemStyle: { color: t.muted, opacity: 0.35 } },
        { type: "line", name: "trail", data: trailData as never, showSymbol: true, symbol: "circle", lineStyle: { color: t.ink, width: 1.5, opacity: 0.6 }, z: 5 },
        latest ? {
          type: "effectScatter", name: "latest", data: [{ value: pt(latest), date: latest.date }] as never, symbolSize: 14, z: 6,
          rippleEffect: { scale: 2.2, brushType: "stroke" as const },
          itemStyle: { color: latest[`state_ema${ema}`] ? STATE_META[latest[`state_ema${ema}`] as StateCode].color : t.ink, borderColor: t.surface, borderWidth: 2 },
          label: { show: true, position: "right" as const, formatter: latest.date, color: t.ink, fontSize: 11, fontWeight: 600 },
        } : { type: "scatter", data: [] },
      ] as never,
    };
  }, [series, idx, t, cfg, ema, bucket]);

  if (!series.length) return null;
  return (
    <div>
      <EChart option={option} height={380} ariaLabel={`State map: volume ratio against percent above EMA${ema} for ${BUCKET_LABEL[bucket]}`} />
      <div className="mt-2 flex items-center gap-3 text-xs text-ink-2">
        <label htmlFor="replay" className="whitespace-nowrap">Replay</label>
        <input id="replay" type="range" min={0} max={series.length - 1} value={Math.min(idx, series.length - 1)} onChange={(e) => setIdx(Number(e.target.value))} className="w-full accent-[#2a78d6]" />
        <span className="tabular whitespace-nowrap font-medium text-ink">{cur?.date}</span>
        {idx !== series.length - 1 ? <button className="underline" onClick={() => setIdx(series.length - 1)}>latest</button> : null}
      </div>
      <p className="mt-1 text-[11px] text-muted">Grid = zone edges from regime_config.json. * = cell switches on the trend condition (VR ≥ 0.7 and P rising, or dP &lt; 0). Darker band at top-left = panic override. VR null is plotted at the top.</p>
    </div>
  );
}
