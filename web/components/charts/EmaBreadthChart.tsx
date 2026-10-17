"use client";

import type { EChartsOption } from "echarts";
import { useMemo } from "react";
import { BUCKET_LABEL, EMA_COLORS } from "@/lib/states";
import { bucketSeries, isNonOk } from "@/lib/series";
import type { Bucket, Ema, HistoryRow } from "@/lib/types";
import { EMAS } from "@/lib/types";
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
    return {
      ...baseOption(t),
      toolbox: toolbox(t),
      legend: { top: 0, left: 0, textStyle: { color: t.ink2, fontSize: 11 }, icon: "rect", itemWidth: 14, itemHeight: 3 },
      grid: { left: 44, right: 64, top: 36, bottom: 40 },
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
          const lines = EMAS.map((e) => {
            const c = EMA_COLORS[e][t.dark ? "dark" : "light"];
            return `<div style="display:flex;justify-content:space-between;gap:12px"><span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${c};margin-right:4px"></span>EMA${e}${e === ema ? " (selected)" : ""}</span><span style="font-variant-numeric:tabular-nums"><b>${fmtPct(r[`pct_ema${e}`])}</b> · ${r[`n_above_ema${e}`]}/${r.n_valid}</span></div>`;
          }).join("");
          const q = isNonOk(r) ? `<div style="color:${t.ink2};margin-top:4px">○ data ${r.data_quality} · source ${r.data_source}</div>` : "";
          return `<b>${d}</b> · ${BUCKET_LABEL[bucket]}<div style="min-width:220px;margin-top:4px">${lines}</div><div style="color:${t.muted}">n_valid ${r.n_valid} / n_universe ${r.n_universe}</div>${q}`;
        },
      },
      series: EMAS.map((e, i) => {
        const c = EMA_COLORS[e][t.dark ? "dark" : "light"];
        const sel = e === ema;
        return {
          name: `EMA${e}`,
          type: "line" as const,
          showSymbol: true,
          symbol: dates.length < 3 ? "circle" : "none",
          lineStyle: { width: sel ? 2.5 : 1.25, color: c, opacity: sel ? 1 : 0.55 },
          itemStyle: { color: c },
          z: sel ? 5 : 2,
          endLabel: sel ? { show: true, formatter: `EMA${e}`, color: t.ink, fontSize: 11 } : undefined,
          data: dates.map((d) => {
            const r = byDate[d];
            const v = r ? r[`pct_ema${e}`] : null;
            return r && isNonOk(r) ? { value: v, symbol: "emptyCircle", symbolSize: 8 } : v;
          }),
          markArea: i === 0 ? emaBands(t) : undefined,
          markLine: i === 0 ? {
            silent: true, symbol: "none", label: { show: false },
            lineStyle: { color: t.axis, type: "solid" as const, width: 1 },
            data: [{ yAxis: 20 }, { yAxis: 80 }],
          } : undefined,
        };
      }) as never,
    };
  }, [t, dates, zoom, byDate, ema, bucket]);

  const onEvents = useMemo(() => ({ datazoom: onZoomFactory(dates, setZoom) }), [dates, setZoom]);
  return <EChart option={option} height={height} onEvents={onEvents as never} ariaLabel={`Percent of ${BUCKET_LABEL[bucket]} stocks above EMA 10, 20 and 50`} />;
}
