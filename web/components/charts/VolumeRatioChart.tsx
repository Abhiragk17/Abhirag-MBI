"use client";

import type { EChartsOption } from "echarts";
import { useMemo } from "react";
import { BUCKET_COLORS, BUCKET_LABEL, REGIME_LABEL } from "@/lib/states";
import { indexRows, isNonOk } from "@/lib/series";
import type { Bucket, HistoryRow, RegimeConfig } from "@/lib/types";
import { ALL_BUCKETS } from "@/lib/types";
import { fmtNum } from "@/lib/format";
import { axisStyle, baseOption, ChartTokens, EChart, onZoomFactory, toolbox, zoomComponents, ZoomState } from "./EChart";

const LOG_FLOOR = 0.02;
// regime bands: diverging, red (fear) -> neutral -> blue (demand), very low opacity
const BAND_FILL = ["rgba(227,73,72,0.13)", "rgba(227,73,72,0.06)", "rgba(137,135,129,0.06)", "rgba(42,120,214,0.06)", "rgba(42,120,214,0.11)", "rgba(42,120,214,0.18)"];

export function VolumeRatioChart({
  rows, t, zoom, setZoom, log, barBucket, cfg, height = 460,
}: {
  rows: HistoryRow[]; t: ChartTokens; zoom: ZoomState | null; setZoom: (z: ZoomState | null) => void;
  log: boolean; barBucket: Bucket; cfg: RegimeConfig | null; height?: number;
}) {
  const { by, dates } = useMemo(() => indexRows(rows), [rows]);

  const option = useMemo<EChartsOption>(() => {
    const regimes = cfg?.vr_regimes ?? [];
    const maxVr = Math.max(2.5, ...rows.map((r) => r.vol_ratio ?? 0));
    const bands = regimes.map((r, i) => [
      { yAxis: Math.max(r.min ?? (log ? LOG_FLOOR : 0), log ? LOG_FLOOR : 0), itemStyle: { color: BAND_FILL[i % BAND_FILL.length] }, name: REGIME_LABEL[r.id] ?? r.label },
      { yAxis: r.max ?? maxVr * 1.2 },
    ]);
    const lineSeries = ALL_BUCKETS.map((b, si) => {
      const color = BUCKET_COLORS[b][t.dark ? "dark" : "light"];
      return {
        name: BUCKET_LABEL[b],
        type: "line" as const,
        xAxisIndex: 0,
        yAxisIndex: 0,
        showSymbol: true,
        symbol: dates.length < 3 ? "circle" : "none",
        connectNulls: false,
        lineStyle: { width: b === "ALL" ? 2.5 : 1.5, color },
        itemStyle: { color },
        emphasis: { focus: "series" as const },
        z: b === "ALL" ? 5 : 3,
        endLabel: b === "ALL" ? { show: true, formatter: "ALL", color: t.ink, fontSize: 11 } : undefined,
        data: dates.map((d) => {
          const r = by[d]?.[b];
          let v = r?.vol_ratio ?? null;
          if (v != null && log) v = Math.max(v, LOG_FLOOR);
          return isNonOk(r) ? { value: v, symbol: "emptyCircle", symbolSize: 8 } : v;
        }),
        markArea: si === 0 ? {
          silent: true,
          label: { show: true, position: "insideRight" as const, color: t.muted, fontSize: 10 },
          data: bands as never,
        } : undefined,
      };
    });
    const barColorUp = t.dark ? "#3987e5" : "#2a78d6";
    const barColorDown = t.dark ? "#e66767" : "#e34948";
    const barSeries = [
      { name: `High volume (rel_vol ≥ 1.5) · ${BUCKET_LABEL[barBucket]}`, type: "bar" as const, stack: "hl", xAxisIndex: 1, yAxisIndex: 1, barCategoryGap: "20%",
        itemStyle: { color: barColorUp, borderRadius: [2, 2, 0, 0] }, data: dates.map((d) => by[d]?.[barBucket]?.n_high ?? null) },
      { name: `Low volume (rel_vol < 0.5) · ${BUCKET_LABEL[barBucket]}`, type: "bar" as const, stack: "hl", xAxisIndex: 1, yAxisIndex: 1,
        itemStyle: { color: barColorDown, borderRadius: [0, 0, 2, 2] }, data: dates.map((d) => (by[d]?.[barBucket]?.n_low != null ? -(by[d]![barBucket]!.n_low) : null)) },
    ];
    const ax = axisStyle(t);
    return {
      ...baseOption(t),
      toolbox: toolbox(t),
      legend: { top: 0, left: 0, textStyle: { color: t.ink2, fontSize: 11 }, itemWidth: 14, itemHeight: 3, icon: "rect",
        data: ALL_BUCKETS.map((b) => BUCKET_LABEL[b]) },
      grid: [{ left: 48, right: 120, top: 52, height: "50%" }, { left: 48, right: 120, top: "72%", bottom: 34 }],
      xAxis: [
        { type: "category", data: dates, gridIndex: 0, ...ax, axisLabel: { show: false }, splitLine: { show: false } },
        { type: "category", data: dates, gridIndex: 1, ...ax, axisLabel: { ...ax.axisLabel, hideOverlap: true }, splitLine: { show: false } },
      ],
      yAxis: [
        { type: log ? "log" : "value", gridIndex: 0, name: "Volume ratio", nameTextStyle: { color: t.muted, fontSize: 11 }, min: log ? LOG_FLOOR : 0, ...ax,
          axisLabel: { ...ax.axisLabel, formatter: (v: number) => (v < 1 ? v.toFixed(2) : String(v)) } },
        { type: "value", gridIndex: 1, name: "N high / N low", nameTextStyle: { color: t.muted, fontSize: 11 }, ...ax,
          axisLabel: { ...ax.axisLabel, formatter: (v: number) => String(Math.abs(v)) } },
      ],
      dataZoom: zoomComponents(dates, zoom, [0, 1], true, t) as never,
      tooltip: {
        ...baseOption(t).tooltip,
        trigger: "axis",
        axisPointer: { type: "line", lineStyle: { color: t.axis } },
        formatter: (ps: unknown) => {
          const arr = ps as { axisValue: string }[];
          const d = arr[0]?.axisValue;
          const day = by[d] ?? {};
          const head = `<b>${d}</b>`;
          const lines = ALL_BUCKETS.map((b) => {
            const r = day[b];
            if (!r) return "";
            const c = BUCKET_COLORS[b][t.dark ? "dark" : "light"];
            const vr = r.vol_ratio == null ? "null" : fmtNum(r.vol_ratio);
            return `<div style="display:flex;gap:8px;justify-content:space-between"><span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${c};margin-right:4px"></span>${BUCKET_LABEL[b]}</span><span style="font-variant-numeric:tabular-nums"><b>${vr}</b> · ${r.n_high}/${r.n_low} of ${r.n_valid}</span></div>`;
          }).join("");
          const a = day.ALL;
          const reg = a?.vol_regime ? `<div style="margin-top:4px;color:${t.ink2}">ALL regime: ${REGIME_LABEL[a.vol_regime] ?? a.vol_regime}</div>` : "";
          const q = a && isNonOk(a) ? `<div style="margin-top:4px;color:${t.ink2}">○ data ${a.data_quality} · source ${a.data_source ?? "?"}</div>` : a ? `<div style="color:${t.muted}">source ${a.data_source ?? "?"}</div>` : "";
          return `${head}<div style="min-width:260px;margin-top:4px">${lines}</div>${reg}${q}<div style="color:${t.muted};margin-top:2px">counts: n_high / n_low of n_valid</div>`;
        },
      },
      series: [...lineSeries, ...barSeries] as never,
    };
  }, [by, dates, rows, t, zoom, log, barBucket, cfg]);

  const onEvents = useMemo(() => ({ datazoom: onZoomFactory(dates, setZoom) }), [dates, setZoom]);
  return <EChart option={option} height={height} onEvents={onEvents as never} ariaLabel="Volume ratio by bucket with high and low volume counts" />;
}
