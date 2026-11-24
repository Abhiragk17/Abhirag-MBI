"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Card, CardBody, CardHeader, EmptyState, Skeleton } from "@/components/ui/card";
import { StockChart } from "@/components/stock/StockChart";
import { EMA_COLORS } from "@/components/stock/emaColors";
import { BUCKET_LABEL } from "@/lib/states";
import type { Bucket } from "@/lib/types";

interface StockBars {
  symbol: string;
  bucket: Bucket | null;
  bars: { time: number; open: number; high: number; low: number; close: number; volume: number }[];
  events: { time: number; type: "split"; label: string }[];
  snapshot: { date: string; ema10: number | null; ema20: number | null; ema50: number | null; above: Record<10 | 20 | 50, boolean>; relVol: number | null; valid: boolean; reason: string } | null;
  group: { name: string; slug: string } | null;
}

export default function StockPage({ params }: { params: { symbol: string } }) {
  const { dark, setDark, dataVersion, ema } = useApp();
  const symbol = decodeURIComponent(params.symbol).toUpperCase();
  const [data, setData] = useState<StockBars | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    fetch(`/api/stock/${encodeURIComponent(symbol)}`, { cache: "no-store" })
      .then(async (r) => {
        const b = await r.json();
        if (!live) return;
        if (!r.ok) setError(b.error ?? `HTTP ${r.status}`); else setData(b);
      })
      .catch((e) => live && setError(String(e)));
    return () => { live = false; };
  }, [symbol, dataVersion]);

  // the chart wants a pixel height; fill the viewport below the page header
  const [chartH, setChartH] = useState(640);
  useEffect(() => {
    const fit = () => setChartH(Math.max(520, window.innerHeight - 250));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const last = data?.bars.at(-1);
  const prev = data?.bars.at(-2);
  const chg = last && prev ? ((last.close / prev.close - 1) * 100) : null;

  return (
    <div className="flex flex-col gap-3">
      <Link href={`/stocks?ema=${ema}`} className="w-fit text-xs text-ink-2 underline">← All stocks</Link>
      {error ? (
        <EmptyState title={`No chart for ${symbol}`} reason={error} className="mx-auto mt-6 max-w-lg" />
      ) : !data ? (
        <Skeleton className="h-[calc(100vh-200px)] min-h-[520px]" label={`Loading ${symbol}`} />
      ) : (
        <Card>
          <CardHeader
            title={
              <span className="flex flex-wrap items-baseline gap-x-3">
                <span className="text-base">{data.symbol}</span>
                {data.bucket ? <span className="text-xs font-normal text-ink-2">{BUCKET_LABEL[data.bucket] ?? data.bucket}</span> : null}
                {last ? <span className="tabular text-base">{last.close.toFixed(2)}</span> : null}
                {chg != null ? <span className="tabular text-xs" style={{ color: chg >= 0 ? "var(--good-text)" : "var(--critical)" }}>{chg >= 0 ? "▲" : "▼"} {Math.abs(chg).toFixed(2)}%</span> : null}
              </span>
            }
            subtitle={`Daily, split-adjusted · ${data.bars.length} sessions to ${new Date(last!.time * 1000).toISOString().slice(0, 10)} · EMA 10 / 20 / 50 / 200 overlaid`}
            actions={<a className="text-xs underline" href={`/api/download/stock/${encodeURIComponent(symbol)}?adjusted=1`}>CSV</a>}
          />
          <CardBody>
            {data.snapshot ? (
              <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-2">
                <span className="tabular">Breadth inputs · {data.snapshot.date}</span>
                {([10, 20, 50] as const).map((e) => {
                  const up = data.snapshot!.above[e];
                  const v = data.snapshot![`ema${e}` as "ema10" | "ema20" | "ema50"];
                  return (
                    <span key={e} className={`tabular inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${e === ema ? "font-semibold text-ink" : ""}`}
                      style={{ background: `color-mix(in srgb, ${up ? "var(--accent)" : "var(--critical)"} 15%, transparent)` }}
                      title={`Close ${up ? "above" : "below"} EMA${e}${v != null ? ` (${v.toFixed(2)})` : ""}`}>
                      <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: EMA_COLORS[e] }} />
                      {up ? "▲ above" : "▼ below"} EMA{e}
                    </span>
                  );
                })}
                {data.snapshot.relVol != null ? <span className="tabular">rel vol <b className="text-ink">{data.snapshot.relVol.toFixed(2)}×</b></span> : null}
                {!data.snapshot.valid ? <span className="rounded bg-surface-2 px-1.5 py-0.5">excluded from counts: {data.snapshot.reason || "data"}</span> : null}
                {data.group ? <Link className="underline" href={`/themes/${data.group.slug}?ema=${ema}`}>Group: {data.group.name} →</Link> : null}
              </div>
            ) : data.group ? (
              <div className="mb-2 text-xs text-ink-2"><Link className="underline" href={`/themes/${data.group.slug}?ema=${ema}`}>Group: {data.group.name} →</Link></div>
            ) : null}
            <StockChart symbol={data.symbol} bars={data.bars} events={data.events} dark={dark} onThemeChange={setDark} height={chartH} />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
