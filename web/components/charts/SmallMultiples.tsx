"use client";

import type { EChartsOption } from "echarts";
import { useMemo } from "react";
import { BUCKET_LABEL, EMA_COLORS } from "@/lib/states";
import { indexRows } from "@/lib/series";
import type { Ema, HistoryRow } from "@/lib/types";
import { ALL_BUCKETS, EMAS } from "@/lib/types";
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
          return `<b>${p.axisValue}</b> · ${BUCKET_LABEL[b]}<br/>` + EMAS.map((e) => `EMA${e}: <b>${fmtPct(r[`pct_ema${e}`])}</b> (${r[`n_above_ema${e}`]}/${r.n_valid})`).join("<br/>");
        },
      },
      series: ALL_BUCKETS.flatMap((b, gi) => EMAS.map((e) => {
        const c = EMA_COLORS[e][t.dark ? "dark" : "light"];
        const sel = e === ema;
        return {
          name: `EMA${e}`, type: "line" as const, xAxisIndex: gi, yAxisIndex: gi, showSymbol: false,
          lineStyle: { width: sel ? 2 : 1, color: c, opacity: sel ? 1 : 0.45 }, itemStyle: { color: c }, z: sel ? 5 : 2,
          data: dates.map((d) => by[d]?.[b]?.[`pct_ema${e}`] ?? null),
          markLine: e === 10 ? { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: t.axis, type: "solid" as const, width: 1 }, data: [{ yAxis: 20 }, { yAxis: 80 }] } : undefined,
        };
      })) as never,
    };
  }, [by, dates, t, zoom, ema]);
  const onEvents = useMemo(() => ({ datazoom: onZoomFactory(dates, setZoom) }), [dates, setZoom]);
  return <EChart option={option} height={440} onEvents={onEvents as never} ariaLabel="Percent above EMA, small multiples for all six buckets" />;
}
