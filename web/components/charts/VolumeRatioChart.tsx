"use client";

import type { EChartsOption } from "echarts";
import { useMemo } from "react";
import { BUCKET_COLORS, BUCKET_LABEL, REGIME_LABEL } from "@/lib/states";
import { indexRows, isNonOk } from "@/lib/series";
import type { Bucket, HistoryRow, RegimeConfig } from "@/lib/types";
import { ALL_BUCKETS } from "@/lib/types";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";
import { axisStyle, baseOption, ChartTokens, EChart, onZoomFactory, toolbox, zoomComponents, ZoomState } from "./EChart";

const LOG_FLOOR = 0.05;
/** Regime edges that get a guide line and a gutter label. 0.7 is left out: on a log axis it
 * sits too close to 0.5 and 1 to label legibly (its band is still in the tooltip). */
const GUIDES: { v: number; label: string }[] = [
  { v: 2, label: "climax" },
  { v: 1, label: "high demand" },
  { v: 0.5, label: "improving" },
  { v: 0.25, label: "choppy" },
];

/** Checkbox chips that pick which buckets the chart draws. */
export function BucketToggles({ value, onChange, dark }: { value: Bucket[]; onChange: (v: Bucket[]) => void; dark: boolean }) {
  const toggle = (b: Bucket) => onChange(value.includes(b) ? value.filter((x) => x !== b) : ALL_BUCKETS.filter((x) => x === b || value.includes(x)));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {ALL_BUCKETS.map((b) => {
        const on = value.includes(b);
        const c = BUCKET_COLORS[b][dark ? "dark" : "light"];
        return (
          <label
            key={b}
            className={cn(
              "inline-flex cursor-pointer select-none items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
              on ? "border-ink/40 bg-surface-2 text-ink" : "border-line text-muted hover:text-ink-2",
            )}
          >
            <input type="checkbox" className="sr-only" checked={on} onChange={() => toggle(b)} />
            <span
              aria-hidden
              className="inline-flex h-3 w-3 items-center justify-center rounded-sm border text-[9px] leading-none text-white"
              style={{ background: on ? c : "transparent", borderColor: c }}
            >
              {on ? "✓" : ""}
            </span>
            {BUCKET_LABEL[b]}
          </label>
        );
      })}
      <span className="mx-1 h-4 w-px bg-line" aria-hidden />
      <button type="button" className="text-xs text-ink-2 underline-offset-2 hover:underline" onClick={() => onChange(["ALL"])}>Only ALL</button>
      <button type="button" className="text-xs text-ink-2 underline-offset-2 hover:underline" onClick={() => onChange([...ALL_BUCKETS])}>All</button>
    </div>
  );
}

export function VolumeRatioChart({
  rows, t, zoom, setZoom, log, barBucket, visible, height = 480,
}: {
  rows: HistoryRow[]; t: ChartTokens; zoom: ZoomState | null; setZoom: (z: ZoomState | null) => void;
  log: boolean; barBucket: Bucket; visible: Bucket[]; cfg?: RegimeConfig | null; height?: number;
}) {
  const { by, dates } = useMemo(() => indexRows(rows), [rows]);

  const option = useMemo<EChartsOption>(() => {
    const shown = ALL_BUCKETS.filter((b) => visible.includes(b));
    const floor = log ? LOG_FLOOR : 0;
    // explicit top: markArea "max" resolves against the (empty) guide series, not the axis
    const peak = Math.max(2.5, ...rows.filter((r) => visible.includes(r.bucket)).map((r) => r.vol_ratio ?? 0));
    const top = log ? 10 ** Math.ceil(Math.log10(peak)) : Math.ceil(peak * 1.1);
    const fear = t.dark ? "rgba(227,73,72,0.12)" : "rgba(227,73,72,0.07)";
    const climax = t.dark ? "rgba(57,135,229,0.14)" : "rgba(42,120,214,0.07)";

    // All six series stay in the option (hidden ones get no data) so ECharts' merge
    // update never leaves a stale line behind when a bucket is unticked.
    const lineSeries = ALL_BUCKETS.map((b) => {
      const on = visible.includes(b);
      const color = b === "ALL" ? t.ink : BUCKET_COLORS[b][t.dark ? "dark" : "light"];
      const isAll = b === "ALL";
      return {
        name: BUCKET_LABEL[b],
        type: "line" as const,
        xAxisIndex: 0,
        yAxisIndex: 0,
        showSymbol: dates.length < 3,
        symbol: "circle",
        connectNulls: false,
        lineStyle: { width: isAll ? 2.25 : 1.5, color, opacity: isAll || shown.length <= 2 ? 1 : 0.85 },
        itemStyle: { color },
        emphasis: { focus: "series" as const, lineStyle: { width: 2.5 } },
        blur: { lineStyle: { opacity: 0.15 } },
        z: isAll ? 5 : 3,
        data: !on ? [] : dates.map((d) => {
          const r = by[d]?.[b];
          let v = r?.vol_ratio ?? null;
          if (v != null && log) v = Math.max(v, LOG_FLOOR);
          return isNonOk(r) ? { value: v, symbol: "emptyCircle", symbolSize: 7, showSymbol: true } : v;
        }),
      };
    });

    const guideSeries = {
      name: "guides", type: "line" as const, xAxisIndex: 0, yAxisIndex: 0, silent: true, data: [] as number[],
      tooltip: { show: false },
      markLine: {
        silent: true,
        symbol: "none",
        lineStyle: { color: t.axis, type: "dashed" as const, width: 1 },
        label: { position: "end" as const, color: t.muted, fontSize: 10, formatter: (p: { data: { name: string } }) => p.data.name },
        data: GUIDES.map((g) => ({ yAxis: g.v, name: `${g.v}  ${g.label}` })),
      },
      markArea: {
        silent: true,
        label: { position: "insideBottomRight" as const, color: t.muted, fontSize: 10 },
        data: [
          [{ yAxis: floor, itemStyle: { color: fear }, name: "fear / no demand" }, { yAxis: 0.25 }],
          [{ yAxis: 2, itemStyle: { color: climax } }, { yAxis: top }],
        ] as never,
      },
    };

    const up = t.dark ? "rgba(57,135,229,0.85)" : "rgba(42,120,214,0.8)";
    const down = t.dark ? "rgba(230,103,103,0.75)" : "rgba(227,73,72,0.6)";
    const barSeries = [
      { name: "Heavy volume (≥ 1.5× avg)", type: "bar" as const, stack: "hl", xAxisIndex: 1, yAxisIndex: 1, barCategoryGap: "35%",
        itemStyle: { color: up }, data: dates.map((d) => by[d]?.[barBucket]?.n_high ?? null) },
      { name: "Light volume (< 0.5× avg)", type: "bar" as const, stack: "hl", xAxisIndex: 1, yAxisIndex: 1,
        itemStyle: { color: down }, data: dates.map((d) => (by[d]?.[barBucket]?.n_low != null ? -(by[d]![barBucket]!.n_low) : null)) },
    ];

    const ax = axisStyle(t);
    const swatch = (c: string) => `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${c};margin-right:6px"></span>`;
    return {
      ...baseOption(t),
      toolbox: toolbox(t),
      legend: { show: false },
      title: [{
        text: `Heavy ▲ vs light ▼ volume stocks · ${BUCKET_LABEL[barBucket]}`,
        left: 52, top: "69%", textStyle: { color: t.ink2, fontSize: 11, fontWeight: 500 },
      }],
      grid: [{ left: 52, right: 104, top: 24, height: "58%" }, { left: 52, right: 104, top: "74%", bottom: 34 }],
      xAxis: [
        { type: "category", data: dates, gridIndex: 0, ...ax, axisLabel: { show: false }, splitLine: { show: false } },
        { type: "category", data: dates, gridIndex: 1, ...ax, axisLabel: { ...ax.axisLabel, hideOverlap: true }, splitLine: { show: false } },
      ],
      yAxis: [
        { type: log ? "log" : "value", gridIndex: 0, min: floor, max: top, ...ax,
          splitLine: { show: false },
          axisLabel: { ...ax.axisLabel, formatter: (v: number) => (v < 1 ? String(+v.toFixed(2)) : String(v)) } },
        { type: "value", gridIndex: 1, ...ax, splitNumber: 2,
          axisLabel: { ...ax.axisLabel, formatter: (v: number) => String(Math.abs(v)) } },
      ],
      dataZoom: zoomComponents(dates, zoom, [0, 1], true, t) as never,
      tooltip: {
        ...baseOption(t).tooltip,
        trigger: "axis",
        axisPointer: { type: "line", lineStyle: { color: t.axis } },
        formatter: (ps: unknown) => {
          const d = (ps as { axisValue: string }[])[0]?.axisValue;
          const day = by[d] ?? {};
          const lines = shown
            .map((b) => ({ b, r: day[b] }))
            .filter((x) => x.r)
            .sort((x, y) => (y.r!.vol_ratio ?? Infinity) - (x.r!.vol_ratio ?? Infinity))
            .map(({ b, r }) => {
              const c = b === "ALL" ? t.ink : BUCKET_COLORS[b][t.dark ? "dark" : "light"];
              const vr = r!.vol_ratio == null ? "n/a" : fmtNum(r!.vol_ratio);
              const reg = r!.vol_regime ? REGIME_LABEL[r!.vol_regime] ?? r!.vol_regime : "";
              return `<div style="display:flex;gap:12px;justify-content:space-between;align-items:baseline"><span>${swatch(c)}${BUCKET_LABEL[b]}</span><span style="font-variant-numeric:tabular-nums"><b>${vr}</b> <span style="color:${t.muted}">${reg}</span></span></div>`;
            }).join("");
          const bb = day[barBucket];
          const bars = bb ? `<div style="margin-top:6px;padding-top:4px;border-top:1px solid ${t.grid};color:${t.ink2}">${BUCKET_LABEL[barBucket]}: ${bb.n_high} heavy · ${bb.n_low} light of ${bb.n_valid}</div>` : "";
          const a = day.ALL;
          const q = a && isNonOk(a) ? `<div style="color:${t.ink2}">○ data ${a.data_quality} · ${a.data_source ?? "?"}</div>` : "";
          return `<b>${d}</b><div style="min-width:280px;margin-top:4px">${lines || `<span style="color:${t.muted}">no bucket selected</span>`}</div>${bars}${q}`;
        },
      },
      series: [guideSeries, ...lineSeries, ...barSeries] as never,
    };
  }, [by, dates, rows, t, zoom, log, barBucket, visible]);

  const onEvents = useMemo(() => ({ datazoom: onZoomFactory(dates, setZoom) }), [dates, setZoom]);
  return <EChart option={option} height={height} onEvents={onEvents as never} ariaLabel="Volume ratio by bucket with heavy and light volume counts" />;
}
