"use client";

import dynamic from "next/dynamic";
import type { EChartsOption } from "echarts";
import { useMemo } from "react";

const ReactECharts = dynamic(() => import("echarts-for-react"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded bg-surface-2" />,
});

export interface ChartTokens {
  ink: string; ink2: string; muted: string; grid: string; axis: string; surface: string; dark: boolean;
}

export function chartTokens(dark: boolean): ChartTokens {
  return dark
    ? { ink: "#f0efec", ink2: "#c3c2b7", muted: "#898781", grid: "#2c2c2a", axis: "#383835", surface: "#1a1a19", dark }
    : { ink: "#0b0b0b", ink2: "#52514e", muted: "#898781", grid: "#e1e0d9", axis: "#c3c2b7", surface: "#fcfcfb", dark };
}

/** Common axis/tooltip styling: hairline grid, muted labels, recessive axes. */
export function baseOption(t: ChartTokens): EChartsOption {
  return {
    backgroundColor: "transparent",
    textStyle: { fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif", color: t.ink2 },
    animation: false,
    tooltip: {
      backgroundColor: t.surface,
      borderColor: t.grid,
      textStyle: { color: t.ink, fontSize: 12 },
      extraCssText: "box-shadow: 0 4px 16px rgba(0,0,0,.12); border-radius: 6px;",
      confine: true,
    },
  };
}

export const axisStyle = (t: ChartTokens) => ({
  axisLine: { lineStyle: { color: t.axis } },
  axisTick: { show: false },
  axisLabel: { color: t.muted, fontSize: 11 },
  splitLine: { lineStyle: { color: t.grid, type: "solid" as const } },
});

export interface ZoomState { start: string; end: string }

/** Inside zoom + optional slider bound to shared (date) zoom state. */
export function zoomComponents(dates: string[], zoom: ZoomState | null, xAxisIndex: number[] = [0], slider = true, t?: ChartTokens) {
  const startValue = zoom && dates.includes(zoom.start) ? zoom.start : dates[0];
  const endValue = zoom && dates.includes(zoom.end) ? zoom.end : dates.at(-1);
  const out: Record<string, unknown>[] = [{ type: "inside", xAxisIndex, startValue, endValue, filterMode: "none" }];
  if (slider) {
    out.push({
      type: "slider", xAxisIndex, startValue, endValue, height: 18, bottom: 6, filterMode: "none",
      borderColor: t?.grid, textStyle: { color: t?.muted, fontSize: 10 }, brushSelect: true,
    });
  }
  return out;
}

/** dataZoom event -> shared {start,end} date state (keeps all charts in sync). */
export function onZoomFactory(dates: string[], setZoom: (z: ZoomState | null) => void) {
  return (_params: unknown, chart: { getOption: () => { dataZoom?: { startValue?: number; endValue?: number }[] } }) => {
    const dz = chart.getOption().dataZoom?.[0];
    if (!dz || dz.startValue == null || dz.endValue == null) return;
    const s = dates[Math.max(0, Math.round(dz.startValue))];
    const e = dates[Math.min(dates.length - 1, Math.round(dz.endValue))];
    if (s && e) setZoom({ start: s, end: e });
  };
}

export const toolbox = (t: ChartTokens) => ({
  right: 8,
  top: 0,
  itemSize: 13,
  iconStyle: { borderColor: t.muted },
  feature: {
    dataZoom: { yAxisIndex: "none" as const, title: { zoom: "Brush to zoom", back: "Undo zoom" } },
    restore: { title: "Reset" },
    saveAsImage: { title: "PNG", backgroundColor: t.surface },
  },
});

export function EChart({
  option, height = 320, onEvents, ariaLabel,
}: { option: EChartsOption; height?: number | string; onEvents?: Record<string, (...a: never[]) => void>; ariaLabel: string }) {
  const style = useMemo(() => ({ height, width: "100%" }), [height]);
  return (
    <div role="img" aria-label={ariaLabel} style={style}>
      <ReactECharts option={option} style={style} notMerge={false} lazyUpdate onEvents={onEvents as never} opts={{ renderer: "canvas" }} />
    </div>
  );
}
