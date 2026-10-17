"use client";

import type { EChartsOption } from "echarts";
import { useMemo } from "react";
import { BUCKET_LABEL } from "@/lib/states";
import { indexRows } from "@/lib/series";
import type { Ema, HistoryRow } from "@/lib/types";
import { ALL_BUCKETS } from "@/lib/types";
import { fmtNum, fmtPct } from "@/lib/format";
import { axisStyle, baseOption, ChartTokens, EChart, onZoomFactory, zoomComponents, ZoomState } from "./EChart";

// sequential blue (one hue, light -> dark) for % above EMA
const SEQ = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
// diverging red <-> grey <-> blue for volume ratio (log2 around 1.0)
const DIV = ["#b8302f", "#e34948", "#f0a3a2", "#d9d8d2", "#9ec5f4", "#3987e5", "#184f95"];

export function Heatmap({
  rows, ema, metric, t, zoom, setZoom,
}: { rows: HistoryRow[]; ema: Ema; metric: "pct" | "vr"; t: ChartTokens; zoom: ZoomState | null; setZoom: (z: ZoomState | null) => void }) {
  const { by, dates } = useMemo(() => indexRows(rows), [rows]);
  const yCats = [...ALL_BUCKETS].reverse();
  const option = useMemo<EChartsOption>(() => {
    const ax = axisStyle(t);
    const data: (number | null)[][] = [];
    dates.forEach((d, xi) => yCats.forEach((b, yi) => {
      const r = by[d]?.[b];
      if (!r) return;
      const v = metric === "pct" ? r[`pct_ema${ema}`] : r.vol_ratio == null ? null : Math.log2(Math.max(r.vol_ratio, 1 / 16));
      data.push([xi, yi, v == null ? null : v]);
    }));
    const dark = t.dark;
    const div = dark ? ["#e66767", "#b54848", "#6b3434", "#383835", "#1c5cab", "#3987e5", "#86b6ef"] : DIV;
    const seq = dark ? [...SEQ].reverse() : SEQ;
    return {
      ...baseOption(t),
      grid: { left: 84, right: 24, top: 8, bottom: 70 },
      xAxis: { type: "category", data: dates, ...ax, splitArea: { show: false }, splitLine: { show: false } },
      yAxis: { type: "category", data: yCats.map((b) => BUCKET_LABEL[b]), ...ax, splitLine: { show: false } },
      visualMap: metric === "pct"
        ? { type: "continuous", min: 0, max: 100, calculable: false, orient: "horizontal", left: "center", bottom: 30, itemHeight: 220, itemWidth: 10,
            inRange: { color: seq }, text: ["100%", "0%"], textStyle: { color: t.muted, fontSize: 10 } }
        : { type: "continuous", min: -3, max: 3, calculable: false, orient: "horizontal", left: "center", bottom: 30, itemHeight: 220, itemWidth: 10,
            inRange: { color: div }, text: ["VR 8 (demand)", "VR 0.125"], textStyle: { color: t.muted, fontSize: 10 } },
      dataZoom: zoomComponents(dates, zoom, [0], false) as never,
      tooltip: {
        ...baseOption(t).tooltip,
        trigger: "item",
        formatter: (p: unknown) => {
          const v = (p as { value: [number, number, number | null] }).value;
          const d = dates[v[0]];
          const b = yCats[v[1]];
          const r = by[d]?.[b];
          if (!r) return d;
          return `<b>${d}</b> · ${BUCKET_LABEL[b]}<br/>% above EMA${ema}: <b>${fmtPct(r[`pct_ema${ema}`])}</b> (${r[`n_above_ema${ema}`]}/${r.n_valid})<br/>Volume ratio: <b>${r.vol_ratio == null ? "null" : fmtNum(r.vol_ratio)}</b> (${r.n_high} high / ${r.n_low} low)<br/><span style="color:${t.muted}">n_valid ${r.n_valid} / ${r.n_universe}</span>`;
        },
      },
      series: [{
        type: "heatmap", data: data as never,
        itemStyle: { borderColor: t.surface, borderWidth: dates.length > 150 ? 0 : 1 },
        emphasis: { itemStyle: { borderColor: t.ink, borderWidth: 1 } },
      }],
    };
  }, [by, dates, t, zoom, ema, metric, yCats]);
  const onEvents = useMemo(() => ({ datazoom: onZoomFactory(dates, setZoom) }), [dates, setZoom]);
  return <EChart option={option} height={300} onEvents={onEvents as never} ariaLabel={`Heatmap of ${metric === "pct" ? `percent above EMA${ema}` : "volume ratio"} by day and bucket`} />;
}
