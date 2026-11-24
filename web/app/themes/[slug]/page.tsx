"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { useApp } from "@/components/AppShell";
import { Card, CardBody, CardHeader, EmptyState, Skeleton } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info";
import type { GlossaryKey } from "@/lib/glossary";
import { axisStyle, baseOption, chartTokens, ChartTokens, EChart, toolbox } from "@/components/charts/EChart";
import { QuadBadge, Ret, RoleBadge, ScoreBar, Th } from "@/components/themes/shared";
import { downloadCsv } from "@/lib/format";
import type { GroupDetail, StockRow } from "@/lib/themes";

function LineChart({ dates, series, t, height = 260, yName, area }: {
  dates: string[]; series: { name: string; data: (number | null)[]; color: string; dashed?: boolean }[]; t: ChartTokens; height?: number; yName?: string; area?: boolean;
}) {
  const option = useMemo<EChartsOption>(() => {
    const ax = axisStyle(t);
    return {
      ...baseOption(t),
      grid: { left: 48, right: 16, top: 28, bottom: 44 },
      legend: { top: 0, left: 0, textStyle: { color: t.ink2, fontSize: 11 }, itemWidth: 14, itemHeight: 2, icon: "roundRect" },
      xAxis: { type: "category", data: dates, ...ax, splitLine: { show: false } },
      yAxis: { type: "value", scale: true, name: yName, nameTextStyle: { color: t.muted, fontSize: 10 }, ...ax },
      tooltip: { ...baseOption(t).tooltip, trigger: "axis" },
      dataZoom: [{ type: "inside", filterMode: "none" }, { type: "slider", height: 16, bottom: 4, filterMode: "none", borderColor: t.grid, textStyle: { color: t.muted, fontSize: 10 } }],
      toolbox: toolbox(t),
      series: series.map((s) => ({
        type: "line", name: s.name, data: s.data, showSymbol: false, connectNulls: false,
        lineStyle: { width: 1.5, color: s.color, type: s.dashed ? "dashed" : "solid" }, itemStyle: { color: s.color },
        areaStyle: area ? { color: s.color, opacity: 0.08 } : undefined,
      })),
    } as EChartsOption;
  }, [dates, series, t, yName, area]);
  return <EChart option={option} height={height} ariaLabel={yName ?? "Line chart"} />;
}

export default function GroupPage({ params }: { params: { slug: string } }) {
  const { dark, dataVersion } = useApp();
  const t = chartTokens(dark);
  const [d, setD] = useState<GroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: keyof StockRow; dir: 1 | -1 }>({ key: "rs", dir: -1 });
  const [role, setRole] = useState("");

  useEffect(() => {
    fetch(`/api/themes/group/${params.slug}`, { cache: "no-store" }).then(async (r) => {
      const b = await r.json();
      if (!r.ok) setError(b.error ?? "not found"); else { setD(b); setError(null); }
    }).catch((e) => setError(String(e)));
  }, [params.slug, dataVersion]);

  const rebased = useMemo(() => {
    if (!d) return null;
    const i0 = d.index.findIndex((v) => v != null);
    if (i0 < 0) return null;
    const gi = d.index[i0] as number, bi = d.bench[i0] as number;
    return {
      group: d.index.map((v, i) => (v == null || i < i0 ? null : +((v / gi) * 100).toFixed(2))),
      bench: d.bench.map((v, i) => (v == null || i < i0 ? null : +((v / bi) * 100).toFixed(2))),
    };
  }, [d]);

  const stocks = useMemo(() => {
    if (!d) return [];
    const f = d.stocks.filter((s) => !role || s.role === role);
    return [...f].sort((a, b) => {
      const va = (a[sort.key] as number | string | null) ?? -Infinity, vb = (b[sort.key] as number | string | null) ?? -Infinity;
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
  }, [d, sort, role]);

  if (error) return <EmptyState title="Group not found" reason={<>{error}. <Link className="underline" href="/themes">Back to themes</Link></>} className="mx-auto mt-10 max-w-lg" />;
  if (!d || !rebased) return <Skeleton className="h-64" label="Loading group" />;
  const s = d.summary;
  const th = (k: keyof StockRow, label: string, right = true, info?: GlossaryKey) => (
    <Th right={right} info={info} active={sort.key === k} dir={sort.dir} onClick={() => setSort((p) => ({ key: k, dir: p.key === k ? ((-p.dir) as 1 | -1) : k === "symbol" ? 1 : -1 }))}>{label}</Th>
  );
  const tile = (label: string, v: React.ReactNode, info?: GlossaryKey) => (
    <div className="rounded-lg border border-line bg-surface p-3"><div className="flex items-center gap-1 text-[11px] text-ink-2">{label}{info ? <InfoTip k={info} /> : null}</div><div className="mt-1 text-base font-semibold tabular">{v}</div></div>
  );

  return (
    <div className="space-y-4">
      <div>
        <Link href="/themes" className="text-xs text-ink-2 hover:underline">← Themes</Link>
        <h1 className="mt-1 flex flex-wrap items-center gap-2 text-lg font-bold tracking-tight">{s.name} <QuadBadge q={s.quadrant} />{s.low_n ? <span className="text-xs font-normal text-muted">low n: too few liquid stocks to rank</span> : null}</h1>
        <p className="text-xs text-ink-2">{s.n_eligible} of {s.n_total} stocks counted · rank {s.rank ?? "–"} · as of {d.dates.at(-1)}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {tile("Score", <ScoreBar v={s.score} />, "th_score")}
        {tile("1D", <Ret v={s.ret_1D} />)}{tile("1W", <Ret v={s.ret_1W} />)}{tile("1M", <Ret v={s.ret_1M} />)}{tile("3M", <Ret v={s.ret_3M} />)}
        {tile("3M vs market", <Ret v={s.rel_3M} />, "th_rel_3m")}
        {tile("% > EMA20", s.pct_ema20 == null ? "–" : `${s.pct_ema20.toFixed(0)}%`, "th_pct_ema")}
        {tile("Near 52wH", s.pct_near_high == null ? "–" : `${s.pct_near_high.toFixed(0)}%`, "th_near_high")}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader info="th_group_index" title="Group index vs market" subtitle="Equal-weight, rebased to 100 at the group's first counted session." /><CardBody>
          <LineChart dates={d.dates} t={t} series={[{ name: s.name, data: rebased.group, color: "#2a78d6" }, { name: "Market (equal weight)", data: rebased.bench, color: "#898781", dashed: true }]} />
        </CardBody></Card>
        <Card><CardHeader title="Relative strength vs market" subtitle="Group index ÷ market index. Rising means the group is outperforming." /><CardBody>
          <LineChart dates={d.dates} t={t} area series={[{ name: "RS", data: d.rs, color: "#1baf7a" }]} />
        </CardBody></Card>
        <Card><CardHeader info="th_rrg" title="Rotation: RS-Ratio and RS-Momentum" subtitle="Above 100 on both = Leading. Crossing 100 marks a change of quadrant." /><CardBody>
          <LineChart dates={d.dates} t={t} series={[{ name: "RS-Ratio", data: d.ratio, color: "#2a78d6" }, { name: "RS-Momentum", data: d.momentum, color: "#eb6834" }]} />
        </CardBody></Card>
        <Card><CardHeader info="th_pct_ema" title="Internal breadth" subtitle="Share of the group's counted stocks above EMA20 / EMA50 and near their 52-week high." /><CardBody>
          <LineChart dates={d.dates} t={t} yName="%" series={[{ name: "% > EMA20", data: d.pct_ema20, color: "#2a78d6" }, { name: "% > EMA50", data: d.pct_ema50, color: "#6250d6" }, { name: "% near 52wH", data: d.pct_near_high, color: "#eda100" }]} />
        </CardBody></Card>
        <Card className="lg:col-span-2"><CardHeader info="th_score" title="Leadership score" subtitle="0-100 percentile blend across all rankable groups on each date." /><CardBody>
          <LineChart dates={d.dates} t={t} height={200} series={[{ name: "Score", data: d.score, color: "#2a78d6" }]} />
        </CardBody></Card>
      </div>

      <Card>
        <CardHeader info="th_group_page" title={`Stocks (${stocks.length})`} subtitle="RS is the stock's percentile rank across all liquid theme stocks. Leaders beat the group over 3 months with RS ≥ 70."
          actions={<>
            <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)} className="h-8 rounded-md border border-line bg-surface px-2 text-xs">
              <option value="">All stocks</option><option value="leader">Leaders</option><option value="laggard">Laggards</option><option value="new">New listings</option>
            </select>
            <Button size="sm" variant="outline" onClick={() => downloadCsv(`${params.slug}_stocks.csv`, stocks as unknown as Record<string, unknown>[])}>CSV</Button>
          </>} />
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-xs">
              <thead className="border-b border-line text-left text-ink-2"><tr>
                {th("symbol", "Stock", false)}{th("close", "Close")}{th("ret_1d", "1D")}{th("ret_5d", "1W")}{th("ret_21d", "1M")}{th("ret_63d", "3M")}{th("ret_126d", "6M")}
                {th("rs", "RS", true, "th_rs_stock")}{th("rel_group_21d", "1M vs group", true, "th_vs_group")}{th("rel_group_63d", "3M vs group")}{th("from_high", "From 52wH", true, "th_near_high")}{th("rel_vol", "Rel vol", true, "th_rel_vol")}{th("tv_cr", "Traded ₹cr")}<Th>Trend</Th><Th info="th_role">Role</Th>
              </tr></thead>
              <tbody>
                {stocks.map((r) => (
                  <tr key={r.symbol} className={`border-b border-line/60 hover:bg-surface-2 ${r.liquid ? "" : "opacity-60"}`}>
                    <td className="py-1 pr-3 font-medium"><Link className="hover:underline" href={`/stocks/${encodeURIComponent(r.symbol)}`}>{r.symbol}</Link>{!r.liquid ? <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-muted">illiquid<InfoTip k="th_illiquid" /></span> : null}</td>
                    <td className="py-1 pr-3 text-right tabular">{r.close?.toLocaleString("en-IN") ?? "–"}</td>
                    <td className="py-1 pr-3 text-right"><Ret v={r.ret_1d} /></td><td className="py-1 pr-3 text-right"><Ret v={r.ret_5d} /></td>
                    <td className="py-1 pr-3 text-right"><Ret v={r.ret_21d} /></td><td className="py-1 pr-3 text-right"><Ret v={r.ret_63d} /></td><td className="py-1 pr-3 text-right"><Ret v={r.ret_126d} /></td>
                    <td className="py-1 pr-3 text-right tabular">{r.rs ?? "–"}</td>
                    <td className="py-1 pr-3 text-right"><Ret v={r.rel_group_21d} /></td><td className="py-1 pr-3 text-right"><Ret v={r.rel_group_63d} /></td>
                    <td className="py-1 pr-3 text-right"><Ret v={r.from_high} /></td>
                    <td className="py-1 pr-3 text-right tabular">{r.rel_vol == null ? "–" : `${r.rel_vol.toFixed(1)}×`}</td>
                    <td className="py-1 pr-3 text-right tabular">{r.tv_cr ?? "–"}</td>
                    <td className="py-1 pr-3 text-ink-2">{r.above_ema20 ? "▲20" : "▽20"} {r.above_ema50 ? "▲50" : "▽50"}</td>
                    <td className="py-1 pr-3"><RoleBadge role={r.role} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
