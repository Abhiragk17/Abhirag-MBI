"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Segmented } from "@/components/ui/button";
import { EChart, baseOption, ChartTokens } from "@/components/charts/EChart";
import { STATE_META } from "@/lib/states";
import type { StateCode } from "@/lib/types";
import type { CorrData, RegimeData } from "@/lib/themes";
import { WithInfo } from "@/components/ui/info";
import { groupHref, heatColor, Th } from "./shared";

type Cell = { avg_bps: number | null; hit: number | null; n: number };

export function RegimePanel({ regime, dark }: { regime: RegimeData | null; dark: boolean }) {
  const states = regime?.states ?? [];
  const [state, setState] = useState<string>(regime?.current ?? states[0] ?? "");
  const rows = useMemo(() => {
    if (!regime || !state) return [];
    return regime.rows
      .map((r) => ({ name: r.name, slug: r.slug, c: r[state] as Cell | undefined }))
      .filter((r) => r.c && r.c.avg_bps != null)
      .sort((a, b) => (b.c!.avg_bps as number) - (a.c!.avg_bps as number));
  }, [regime, state]);
  if (!regime || !states.length) return <EmptyState title="No regime link yet" reason="Needs the breadth history (python -m mbi daily) to overlap the price archive." />;
  const meta = STATE_META[state as StateCode];
  const best = rows.slice(0, 12), worst = rows.slice(-8).reverse();
  const List = ({ items }: { items: typeof rows }) => (
    <table className="w-full text-xs">
      <thead className="border-b border-line text-left text-ink-2"><tr><Th>Group</Th><Th right>Avg excess / day</Th><Th right>Beat market</Th><Th right>Days</Th></tr></thead>
      <tbody>{items.map((r) => (
        <tr key={r.slug} className="border-b border-line/60">
          <td className="py-1 pr-3"><Link href={groupHref(r.slug)} className="hover:underline">{r.name}</Link></td>
          <td className="py-1 pr-3 text-right tabular" style={{ color: (r.c!.avg_bps as number) >= 0 ? "var(--good-text)" : "var(--critical)" }}>{(r.c!.avg_bps as number) > 0 ? "+" : ""}{(r.c!.avg_bps as number).toFixed(0)} bp</td>
          <td className="py-1 pr-3 text-right tabular">{r.c!.hit == null ? "–" : `${r.c!.hit}%`}</td>
          <td className="py-1 pr-3 text-right tabular text-ink-2">{r.c!.n}</td>
        </tr>))}</tbody>
    </table>
  );
  return (
    <Card>
      <CardHeader info="th_regime" title="Which groups work in which market state"
        subtitle="Average daily return of each group minus the market, on days the market-breadth state (EMA20, all stocks) was the one selected. Descriptive, not a forecast."
        actions={<Segmented label="Market state" value={state} onChange={setState} options={states.map((s) => ({ value: s, label: `${s} · ${regime.days[s]}d` }))} />} />
      <CardBody>
        <p className="mb-3 text-xs text-ink-2">
          {meta ? <><b>{meta.name}</b>: {meta.meaning}. </> : null}
          {regime.current ? <>Current state: <b>{regime.current}</b>.</> : null} States with fewer than 5 days for a group are left blank.
        </p>
        <div className="grid gap-6 lg:grid-cols-2">
          <div><h3 className="mb-2 text-xs font-semibold text-ink-2">Best in {state}</h3><List items={best} /></div>
          <div><h3 className="mb-2 text-xs font-semibold text-ink-2">Worst in {state}</h3><List items={worst} /></div>
        </div>
        <h3 className="mb-2 mt-6 text-xs font-semibold text-ink-2">The same groups across every state (average excess return per day, basis points)</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-xs">
            <thead className="border-b border-line text-left text-ink-2"><tr><Th>Group</Th>{states.map((st) => <Th key={st} right>{st}</Th>)}</tr></thead>
            <tbody>
              {[...best, ...worst].map((r) => {
                const full = regime.rows.find((x) => x.slug === r.slug);
                return (
                  <tr key={r.slug} className="border-b border-line/60">
                    <td className="py-1 pr-3"><Link href={groupHref(r.slug)} className="hover:underline">{r.name}</Link></td>
                    {states.map((st) => {
                      const c = full?.[st] as Cell | undefined;
                      const v = c?.avg_bps ?? null;
                      const col = v == null ? null : heatColor(v, 40, dark);
                      return <td key={st} className="px-2 py-1 text-right tabular" style={col ? { background: col.bg, color: col.fg, outline: st === state ? `1px solid ${dark ? "#f0efec" : "#0b0b0b"}` : undefined, outlineOffset: -1 } : undefined}>{v == null ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(0)}`}</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

export function CorrelationPanel({ corr, t }: { corr: CorrData | null; t: ChartTokens }) {
  const option = useMemo<EChartsOption | null>(() => {
    if (!corr?.order?.length) return null;
    const n = corr.order.length;
    const data: [number, number, number | null][] = [];
    corr.matrix.forEach((row, y) => row.forEach((v, x) => data.push([x, y, v])));
    return {
      ...baseOption(t),
      grid: { left: 8, right: 8, top: 8, bottom: 46 },
      xAxis: { type: "category", data: corr.order, show: false },
      yAxis: { type: "category", data: corr.order, show: false, inverse: true },
      visualMap: { type: "continuous", min: -0.2, max: 1, orient: "horizontal", left: "center", bottom: 0, itemWidth: 10, itemHeight: 180, text: ["1.0", "−0.2"], textStyle: { color: t.muted, fontSize: 10 },
        inRange: { color: t.dark ? ["#262624", "#184f95", "#3987e5", "#9ec5f4"] : ["#f0efec", "#cde2fb", "#6da7ec", "#184f95"] } },
      tooltip: { ...baseOption(t).tooltip, formatter: (p: unknown) => { const v = (p as { value: [number, number, number | null] }).value; return `${corr.order[v[1]]}<br/>${corr.order[v[0]]}<br/>correlation <b>${v[2]?.toFixed(2) ?? "–"}</b>`; } },
      series: [{ type: "heatmap", data: data as never, progressive: n * n, itemStyle: { borderWidth: 0 } }],
    } as EChartsOption;
  }, [corr, t]);
  const [pickG, setPickG] = useState("");
  const related = useMemo(() => {
    if (!corr || !pickG) return null;
    const i = corr.order.indexOf(pickG);
    if (i < 0) return null;
    const arr = corr.matrix[i].map((v, j) => ({ name: corr.order[j], slug: corr.slugs[j], v })).filter((x) => x.v != null && x.name !== pickG) as { name: string; slug: string; v: number }[];
    arr.sort((a, b) => b.v - a.v);
    return { most: arr.slice(0, 6), least: arr.slice(-6).reverse() };
  }, [corr, pickG]);
  if (!corr || !option) return <EmptyState title="No correlation data yet" />;
  const pair = (p: { a: string; b: string; corr: number }) => (
    <li key={p.a + p.b} className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate">{p.a} <span className="text-muted">×</span> {p.b}</span><b className="tabular">{p.corr.toFixed(2)}</b></li>
  );
  return (
    <Card>
      <CardHeader info="th_corr" title="Group correlation" subtitle={`Daily returns over the last ${corr.window} sessions, ordered so similar groups sit together. Highly correlated groups are the same bet; low ones diversify.`} />
      <CardBody>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <EChart option={option} height={520} ariaLabel="Heatmap of correlations between thematic groups" />
          <div className="space-y-4 text-xs">
            <div className="rounded-md border border-line p-3">
              <WithInfo k="th_corr_pick">
                <select aria-label="Pick a group" value={pickG} onChange={(e) => setPickG(e.target.value)} className="h-8 max-w-[260px] rounded-md border border-line bg-surface px-2 text-xs">
                  <option value="">Pick a group to compare…</option>
                  {[...corr.order].sort().map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </WithInfo>
              {related ? (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {([["Moves most like it", related.most], ["Moves least like it", related.least]] as const).map(([title, items]) => (
                    <div key={title}><h4 className="mb-1 font-semibold text-ink-2">{title}</h4>
                      <ul className="space-y-1">{items.map((x) => <li key={x.slug} className="flex items-center gap-1"><Link href={groupHref(x.slug)} className="min-w-0 flex-1 truncate hover:underline" title={x.name}>{x.name}</Link><b className="tabular">{x.v.toFixed(2)}</b></li>)}</ul>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <div><h3 className="mb-2 font-semibold text-ink-2">Most correlated pairs</h3><ul className="space-y-1">{corr.most_correlated.map(pair)}</ul></div>
            <div><h3 className="mb-2 font-semibold text-ink-2">Best diversifiers</h3><ul className="space-y-1">{corr.diversifiers.map(pair)}</ul></div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
