"use client";

import type { EChartsOption } from "echarts";
import { useMemo } from "react";
import { BUCKET_LABEL, STATE_META, explain } from "@/lib/states";
import { indexRows } from "@/lib/series";
import type { Ema, HistoryRow, StateCode } from "@/lib/types";
import { ALL_BUCKETS } from "@/lib/types";
import { axisStyle, baseOption, ChartTokens, EChart, onZoomFactory, zoomComponents, ZoomState } from "./EChart";

const CODES: StateCode[] = ["BD", "LD", "EU", "BR", "LS", "PA"];

/** One coloured cell per day per bucket; the letter code is drawn in each cell when
 * cells are wide enough, so colour is never the only cue. */
export function StateTimeline({
  rows, ema, raw, t, zoom, setZoom,
}: { rows: HistoryRow[]; ema: Ema; raw: boolean; t: ChartTokens; zoom: ZoomState | null; setZoom: (z: ZoomState | null) => void }) {
  const { by, dates } = useMemo(() => indexRows(rows), [rows]);
  const yCats = [...ALL_BUCKETS].reverse();
  const visible = useMemo(() => {
    if (!zoom) return dates.length;
    const s = dates.indexOf(zoom.start);
    const e = dates.indexOf(zoom.end);
    return s >= 0 && e >= 0 ? e - s + 1 : dates.length;
  }, [zoom, dates]);

  const option = useMemo<EChartsOption>(() => {
    const ax = axisStyle(t);
    const data: { value: [number, number, number]; code: StateCode }[] = [];
    dates.forEach((d, xi) => yCats.forEach((b, yi) => {
      const r = by[d]?.[b];
      const s = r ? ((raw ? r[`state_raw_ema${ema}`] : r[`state_ema${ema}`]) as StateCode | null) : null;
      if (s) data.push({ value: [xi, yi, CODES.indexOf(s)], code: s });
    }));
    return {
      ...baseOption(t),
      grid: { left: 84, right: 24, top: 8, bottom: 56 },
      xAxis: { type: "category", data: dates, ...ax, splitLine: { show: false } },
      yAxis: { type: "category", data: yCats.map((b) => BUCKET_LABEL[b]), ...ax, splitLine: { show: false } },
      visualMap: {
        type: "piecewise", show: true, orient: "horizontal", left: "center", bottom: 0, dimension: 2,
        pieces: CODES.map((c, i) => ({ value: i, label: `${STATE_META[c].icon} ${c} ${STATE_META[c].short}`, color: STATE_META[c].color })),
        textStyle: { color: t.ink2, fontSize: 11 }, itemWidth: 12, itemHeight: 12,
      },
      dataZoom: zoomComponents(dates, zoom, [0], false) as never,
      tooltip: {
        ...baseOption(t).tooltip,
        trigger: "item",
        formatter: (p: unknown) => {
          const v = (p as { value: [number, number, number] }).value;
          const d = dates[v[0]];
          const b = yCats[v[1]];
          const r = by[d]?.[b];
          const s = CODES[v[2]];
          if (!r) return d;
          return `<b>${d}</b> · ${BUCKET_LABEL[b]}<br/><b>${STATE_META[s].icon} ${STATE_META[s].name}</b>${raw ? " (raw)" : ""}<br/><span style="color:${t.ink2}">${explain(r, ema, raw)}</span>`;
        },
      },
      series: [{
        type: "heatmap",
        data: data as never,
        label: {
          show: visible <= 70,
          formatter: (p: unknown) => (p as { data: { code: string } }).data.code,
          color: "#fff", fontSize: 9, fontWeight: 600,
        },
        itemStyle: { borderColor: t.surface, borderWidth: dates.length > 150 && visible > 150 ? 0 : 1 },
      }],
    };
  }, [by, dates, t, zoom, ema, raw, yCats, visible]);
  const onEvents = useMemo(() => ({ datazoom: onZoomFactory(dates, setZoom) }), [dates, setZoom]);
  return <EChart option={option} height={260} onEvents={onEvents as never} ariaLabel="Market situation timeline for each bucket" />;
}
