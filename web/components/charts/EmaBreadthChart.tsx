"use client";

import type { EChartsOption } from "echarts";
import { useMemo } from "react";
import { BUCKET_LABEL, EMA_COLORS } from "@/lib/states";
import { bucketSeries, isNonOk } from "@/lib/series";
import type { Bucket, Ema, HistoryRow } from "@/lib/types";
import { fmtPct } from "@/lib/format";
import { axisStyle, baseOption, ChartTokens, EChart, onZoomFactory, toolbox, zoomComponents, ZoomState } from "./EChart";

export function emaBands(t: ChartTokens) {
  return {
    silent: true,
    data: [
      [{ yAxis: 80, itemStyle: { color: t.dark ? "rgba(98,80,214,0.14)" : "rgba(98,80,214,0.08)" }, name: "overbought ≥ 80%" }, { yAxis: 100 }],
      [{ yAxis: 0, itemStyle: { color: t.dark ? "rgba(227,73,72,0.14)" : "rgba(227,73,72,0.08)" }, name: "oversold < 20%" }, { yAxis: 20 }],
    ],
    label: { show: true, position: "insideTopRight" as const, color: t.muted, fontSize: 10 },
  };
}

export function EmaBreadthChart({
  rows, bucket, ema, t, zoom, setZoom, dates, height = 340,
}: {
  rows: HistoryRow[]; bucket: Bucket; ema: Ema; t: ChartTokens; zoom: ZoomState | null; setZoom: (z: ZoomState | null) => void;
  dates: string[]; height?: number;
}) {
  const series = useMemo(() => bucketSeries(rows, bucket), [rows, bucket]);
  const byDate = useMemo(() => Object.fromEntries(series.map((r) => [r.date, r])), [series]);

  const option = useMemo<EChartsOption>(() => {
    const ax = axisStyle(t);
    const c = EMA_COLORS[ema][t.dark ? "dark" : "light"];
    return {
      ...baseOption(t),
      toolbox: toolbox(t),
      grid: { left: 44, right: 24, top: 32, bottom: 40 },
      xAxis: { type: "category", data: dates, ...ax, splitLine: { show: false } },
      yAxis: { type: "value", min: 0, max: 100, interval: 20, ...ax, axisLabel: { ...ax.axisLabel, formatter: "{value}%" } },
      dataZoom: zoomComponents(dates, zoom, [0], true, t) as never,
      tooltip: {
        ...baseOption(t).tooltip,
        trigger: "axis",
        formatter: (ps: unknown) => {
          const d = (ps as { axisValue: string }[])[0]?.axisValue;
          const r = byDate[d];
          if (!r) return `<b>${d}</b><br/>no data`;
          const q = isNonOk(r) ? `<div style="color:${t.ink2};margin-top:4px">○ data ${r.data_quality} · source ${r.data_source}</div>` : "";
          return `<b>${d}</b> · ${BUCKET_LABEL[bucket]}<div style="margin-top:4px">Above EMA${ema}: <b style="font-variant-numeric:tabular-nums">${fmtPct(r[`pct_ema${ema}`])}</b> <span style="color:${t.muted}">(${r[`n_above_ema${ema}`]} of ${r.n_valid})</span></div>${q}`;
        },
      },
      series: [{
        name: `EMA${ema}`,
        type: "line" as const,
        showSymbol: dates.length < 3,
        symbol: "circle",
        lineStyle: { width: 2, color: c },
        itemStyle: { color: c },
        data: dates.map((d) => {
          const r = byDate[d];
          const v = r ? r[`pct_ema${ema}`] : null;
          return r && isNonOk(r) ? { value: v, symbol: "emptyCircle", symbolSize: 8, showSymbol: true } : v;
        }),
        markArea: emaBands(t),
        markLine: {
          silent: true, symbol: "none", label: { show: false },
          lineStyle: { color: t.axis, type: "dashed" as const, width: 1 },
          data: [{ yAxis: 20 }, { yAxis: 50 }, { yAxis: 80 }],
        },
      }] as never,
    };
  }, [t, dates, zoom, byDate, ema, bucket]);

  const onEvents = useMemo(() => ({ datazoom: onZoomFactory(dates, setZoom) }), [dates, setZoom]);
  return <EChart option={option} height={height} onEvents={onEvents as never} ariaLabel={`Percent of ${BUCKET_LABEL[bucket]} stocks above EMA ${ema}`} />;
}
