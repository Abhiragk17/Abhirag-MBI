"use client";

import { useMemo } from "react";
import { TradingChart, COMPACT_FEATURES } from "trading-chart-react";
import type { Bar, EventInput, IndicatorSpec } from "trading-chart-react";
import "trading-chart-react/styles.css";
import { EMA_COLORS, EMA_LENGTHS } from "./emaColors";

export interface StockChartProps {
  symbol: string;
  bars: Bar[];
  events: EventInput[];
  dark: boolean;
  height?: number;
  onThemeChange?: (dark: boolean) => void;
}

// module-level so the props keep the same identity between renders
const INDICATORS: IndicatorSpec[] = EMA_LENGTHS.map((length) => ({ type: "ema", params: { length }, colors: { ema: EMA_COLORS[length] } }));
const FEATURES = { ...COMPACT_FEATURES, topToolbar: true, drawingToolbar: true, legend: true, navigation: true, indicators: true, bottomBar: true };
const SETTINGS = { precision: 2 } as const;

/** Wraps the in-house charting terminal. Loaded client-only (lightweight-charts needs `window`). */
export default function StockChartInner({ symbol, bars, events, dark, height = 640, onThemeChange }: StockChartProps) {
  const storageKey = useMemo(() => `mbi.chart.v2.${symbol}`, [symbol]);
  return (
    <TradingChart
      data={bars}
      symbol={symbol}
      events={events}
      theme={dark ? "dark" : "light"}
      onThemeChange={(t) => onThemeChange?.(t === "dark")}
      accentColor="#2a78d6"
      height={height}
      timeframe="1D"
      chartType="candles"
      indicators={INDICATORS}
      storageKey={storageKey}
      features={FEATURES}
      settings={SETTINGS}
    />
  );
}
