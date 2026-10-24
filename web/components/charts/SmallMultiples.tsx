"use client";

import type { EChartsOption } from "echarts";
import { useMemo } from "react";
import { BUCKET_LABEL, EMA_COLORS } from "@/lib/states";
import { indexRows } from "@/lib/series";
import type { Ema, HistoryRow } from "@/lib/types";
import { ALL_BUCKETS } from "@/lib/types";
import { fmtPct } from "@/lib/format";
import { axisStyle, baseOption, ChartTokens, EChart, onZoomFactory, zoomComponents, ZoomState } from "./EChart";

/** Six panels (5 buckets + ALL) on the same 0-100% scale. */
export function SmallMultiples({
  rows, ema, t, zoom, setZoom,
}: { rows: HistoryRow[]; ema: Ema; t: ChartTokens; zoom: ZoomState | null; setZoom: (z: ZoomState | null) => void }) {
  const { by, dates } = useMemo(() => indexRows(rows), [rows]);
  const option = useMemo<EChartsOption>(() => {
    const ax = axisStyle(t);
    const cols = 3;
    const c = EMA_COLORS[ema][t.dark ? "dark" : "light"];
    const grids = ALL_BUCKETS.map((_, i) => ({
      left: `${(i % cols) * 33.3 + 3.5}%`, width: "28%",
      top: `${Math.floor(i / cols) * 50 + 9}%`, height: "33%",
    }));
    return {
      ...baseOption(t),
      title: ALL_BUCKETS.map((b, i) => ({
        text: BUCKET_LABEL[b], left: `${(i % cols) * 33.3 + 3.5}%`, top: `${Math.floor(i / cols) * 50 + 1}%`,
        textStyle: { fontSize: 12, fontWeight: 600, color: t.ink },
      })),
      grid: grids,
      xAxis: ALL_BUCKETS.map((_, i) => ({ type: "category" as const, data: dates, gridIndex: i, ...ax, splitLine: { show: false }, axisLabel: { ...ax.axisLabel, fontSize: 9, hideOverlap: true } })),
      yAxis: ALL_BUCKETS.map((_, i) => ({ type: "value" as const, min: 0, max: 100, interval: 50, gridIndex: i, ...ax, axisLabel: { ...ax.axisLabel, fontSize: 9, formatter: "{value}%" } })),
      dataZoom: zoomComponents(dates, zoom, ALL_BUCKETS.map((_, i) => i), false) as never,
      tooltip: {
        ...baseOption(t).tooltip,
        trigger: "axis",
        formatter: (ps: unknown) => {
          const p = (ps as { axisValue: string; axisIndex: number }[])[0];
          const b = ALL_BUCKETS[p.axisIndex] ?? "ALL";
          const r = by[p.axisValue]?.[b];
          if (!r) return p.axisValue;
          return `<b>${p.axisValue}</b> · ${BUCKET_LABEL[b]}<br/>Above EMA${ema}: <b>${fmtPct(r[`pct_ema${ema}`])}</b> (${r[`n_above_ema${ema}`]} of ${r.n_valid})`;
        },
      },
      series: ALL_BUCKETS.map((b, gi) => ({
        name: BUCKET_LABEL[b], type: "line" as const, xAxisIndex: gi, yAxisIndex: gi, showSymbol: false,
        lineStyle: { width: 1.75, color: c }, itemStyle: { color: c },
        data: dates.map((d) => by[d]?.[b]?.[`pct_ema${ema}`] ?? null),
        markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: t.axis, type: "dashed" as const, width: 1 }, data: [{ yAxis: 20 }, { yAxis: 80 }] },
      })) as never,
    };
  }, [by, dates, t, zoom, ema]);
  const onEvents = useMemo(() => ({ datazoom: onZoomFactory(dates, setZoom) }), [dates, setZoom]);
  return <EChart option={option} height={440} onEvents={onEvents as never} ariaLabel={`Percent above EMA ${ema}, small multiples for all six buckets`} />;
}
