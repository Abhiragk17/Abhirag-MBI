"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { EChartsOption } from "echarts";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Button, Segmented } from "@/components/ui/button";
import { InfoTip, WithInfo } from "@/components/ui/info";
import { EChart, baseOption, ChartTokens } from "@/components/charts/EChart";
import type { Quadrant, RrgData } from "@/lib/themes";
import { QUAD_COLOR, quadrantAt, QUADRANTS } from "@/lib/themes";
import { groupHref } from "./shared";

type Pick = "top15" | "top30" | "Leading" | "Improving" | "all";
const QUAD_HINT: Record<Quadrant, string> = {
  Leading: "strong and gaining", Weakening: "strong but fading", Lagging: "weak and fading", Improving: "weak but gaining",
};
const short = (n: string) => (n.length > 22 ? `${n.slice(0, 21)}…` : n);

export function RotationGraph({ rrg, t }: { rrg: RrgData; t: ChartTokens }) {
  const router = useRouter();
  const last = rrg.dates.length - 1;
  const [asof, setAsof] = useState(last);
  const [tailWeeks, setTailWeeks] = useState(6);
  const [pick, setPick] = useState<Pick>("top15");
  const [focus, setFocus] = useState("");
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { setAsof(last); }, [last]);
  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => setAsof((a) => {
      if (a >= last) { setPlaying(false); return a; }
      return a + 1;
    }), 250);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [playing, last]);

  const step = rrg.tail_step;
  const series = useMemo(() => {
    const entries = Object.entries(rrg.groups).filter(([, g]) => !g.low_n);
    const cur = entries.map(([name, g]) => ({ name, g, ratio: g.ratio[asof], mom: g.momentum[asof], score: g.score[asof] }))
      .filter((e) => e.ratio != null && e.mom != null);
    let chosen = cur;
    if (pick === "top15" || pick === "top30") chosen = [...cur].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, pick === "top15" ? 15 : 30);
    else if (pick === "Leading" || pick === "Improving") chosen = cur.filter((e) => quadrantAt(e.ratio, e.mom) === pick);
    // keep a focused group on screen even if the filter would hide it
    if (focus && !chosen.some((e) => e.name === focus)) { const f = cur.find((e) => e.name === focus); if (f) chosen = [...chosen, f]; }
    return chosen.map((e) => {
      const pts: { value: [number, number]; date: string }[] = [];
      for (let k = tailWeeks; k >= 0; k--) {
        const i = asof - k * step;
        if (i < 0) continue;
        const r = e.g.ratio[i], m = e.g.momentum[i];
        if (r != null && m != null) pts.push({ value: [r, m], date: rrg.dates[i] });
      }
      return { name: e.name, slug: e.g.slug, pts, q: quadrantAt(e.ratio, e.mom) as Quadrant, score: e.score };
    });
  }, [rrg, asof, tailWeeks, pick, step, focus]);

  const option = useMemo<EChartsOption>(() => {
    const xs = series.flatMap((s) => s.pts.map((p) => p.value[0]));
    const ys = series.flatMap((s) => s.pts.map((p) => p.value[1]));
    const spanX = Math.max(4, ...xs.map((x) => Math.abs(x - 100))) * 1.12;
    const spanY = Math.max(4, ...ys.map((y) => Math.abs(y - 100))) * 1.12;
    const xmin = 100 - spanX, xmax = 100 + spanX, ymin = 100 - spanY, ymax = 100 + spanY;
    const qLabel = (q: Quadrant, pos: "insideTopRight" | "insideBottomRight" | "insideBottomLeft" | "insideTopLeft") => ({
      show: true, position: pos, formatter: q.toUpperCase(), color: QUAD_COLOR[q], opacity: 0.85, fontSize: 12, fontWeight: 700, padding: 8,
    });
    const area = (x0: number, x1: number, y0: number, y1: number, q: Quadrant, pos: "insideTopRight" | "insideBottomRight" | "insideBottomLeft" | "insideTopLeft") => [
      { xAxis: x0, yAxis: y0, label: qLabel(q, pos), itemStyle: { color: `${QUAD_COLOR[q]}${t.dark ? "22" : "14"}` } }, { xAxis: x1, yAxis: y1 },
    ];
    const lines = series.map((s) => {
      const dim = focus && focus !== s.name;
      const color = QUAD_COLOR[s.q];
      const n = s.pts.length;
      return {
        type: "line" as const, name: s.name, smooth: 0.25, data: s.pts,
        symbol: "circle", symbolSize: (_v: unknown, p: { dataIndex: number }) => (p.dataIndex === n - 1 ? (focus === s.name ? 15 : 11) : 3 + (p.dataIndex / Math.max(n - 1, 1)) * 3),
        lineStyle: { width: focus === s.name ? 2.6 : 1.4, color, opacity: dim ? 0.1 : 0.75 },
        itemStyle: { color, opacity: dim ? 0.12 : 1, borderColor: t.surface, borderWidth: 1 },
        label: {
          show: !dim, position: "right" as const, color: t.ink, fontSize: focus === s.name ? 12 : 10, fontWeight: focus === s.name ? 700 : 400,
          formatter: (p: { dataIndex: number }) => (p.dataIndex === n - 1 ? short(s.name) : ""),
        },
        labelLayout: { hideOverlap: true, moveOverlap: "shiftY" as const },
        emphasis: { focus: "series" as const, lineStyle: { width: 2.6 }, label: { show: true, fontWeight: 700 } },
        z: focus === s.name ? 6 : 3,
      };
    });
    return {
      ...baseOption(t),
      grid: { left: 56, right: 28, top: 14, bottom: 48 },
      xAxis: { type: "value", min: xmin, max: xmax, name: "← weaker than market     RS-Ratio     stronger →", nameLocation: "middle", nameGap: 30, nameTextStyle: { color: t.muted, fontSize: 11 }, axisLabel: { color: t.muted, fontSize: 11 }, splitLine: { show: false }, axisLine: { show: false }, axisTick: { show: false } },
      yAxis: { type: "value", min: ymin, max: ymax, name: "← losing     RS-Momentum     gaining →", nameLocation: "middle", nameGap: 40, nameTextStyle: { color: t.muted, fontSize: 11 }, axisLabel: { color: t.muted, fontSize: 11 }, splitLine: { show: false }, axisLine: { show: false }, axisTick: { show: false } },
      tooltip: {
        ...baseOption(t).tooltip, trigger: "item",
        formatter: (p: unknown) => {
          const pp = p as { seriesName: string; data: { value: [number, number]; date: string }; dataIndex: number };
          const s = series.find((x) => x.name === pp.seriesName);
          if (!s) return "";
          const isEnd = pp.dataIndex === s.pts.length - 1;
          const qq = quadrantAt(pp.data.value[0], pp.data.value[1]) as Quadrant;
          return `<b>${s.name}</b><br/><span style="color:${QUAD_COLOR[qq]}">● ${qq}</span> on ${pp.data.date}<br/>RS-Ratio <b>${pp.data.value[0].toFixed(1)}</b> · Momentum <b>${pp.data.value[1].toFixed(1)}</b>`
            + (isEnd ? `<br/>Score ${s.score?.toFixed(0) ?? "–"}<br/><span style="color:${t.muted}">Click to open</span>` : "");
        },
      },
      series: [
        {
          type: "line", name: "_quadrants", data: [], silent: true, tooltip: { show: false },
          markArea: { silent: true, data: [area(100, xmax, 100, ymax, "Leading", "insideTopRight"), area(100, xmax, ymin, 100, "Weakening", "insideBottomRight"), area(xmin, 100, ymin, 100, "Lagging", "insideBottomLeft"), area(xmin, 100, 100, ymax, "Improving", "insideTopLeft")] as never },
          markLine: { silent: true, symbol: "none", lineStyle: { color: t.axis, type: "dashed", width: 1 }, label: { show: false }, data: [{ xAxis: 100 }, { yAxis: 100 }] },
        },
        ...lines,
      ] as never,
    } as EChartsOption;
  }, [series, t, focus]);

  if (!rrg.dates.length) return <EmptyState title="No rotation data yet" reason="Needs about 60 sessions of history." />;
  const byQ = Object.fromEntries(QUADRANTS.map((q) => [q, series.filter((s) => s.q === q).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))])) as Record<Quadrant, typeof series>;
  const allNames = Object.entries(rrg.groups).filter(([, g]) => !g.low_n).map(([n]) => n).sort();

  return (
    <Card>
      <CardHeader
        title="Sector rotation graph (RRG)" info="th_rrg"
        subtitle="Groups usually rotate clockwise: Improving → Leading → Weakening → Lagging. The big dot is the as-of date; the tail shows recent weeks."
        actions={<>
          <WithInfo k="th_rrg_pick"><Segmented<Pick> label="Groups shown" value={pick} onChange={setPick} options={[
            { value: "top15", label: "Top 15" }, { value: "top30", label: "Top 30" }, { value: "Leading", label: "Leading" },
            { value: "Improving", label: "Improving" }, { value: "all", label: "All" }]} /></WithInfo>
          <WithInfo k="th_rrg_tail"><Segmented<number> label="Tail length" value={tailWeeks} onChange={setTailWeeks} options={[{ value: 3, label: "3w" }, { value: 6, label: "6w" }, { value: 10, label: "10w" }]} /></WithInfo>
        </>}
      />
      <CardBody>
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <span className="inline-flex items-center gap-1 text-ink-2">X axis <b className="text-ink">RS-Ratio</b><InfoTip k="th_rs_ratio" /></span>
          <span className="inline-flex items-center gap-1 text-ink-2">Y axis <b className="text-ink">RS-Momentum</b><InfoTip k="th_rs_momentum" /></span>
          <WithInfo k="th_rrg_highlight">
            <select aria-label="Highlight a group" value={focus} onChange={(e) => setFocus(e.target.value)} className="h-8 max-w-[220px] rounded-md border border-line bg-surface px-2 text-xs">
              <option value="">Highlight a group…</option>
              {allNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </WithInfo>
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <InfoTip k="th_rrg_asof" />
            <Button size="sm" variant="outline" onClick={() => { if (!playing && asof >= last) setAsof(Math.max(0, last - 60)); setPlaying((p) => !p); }}>{playing ? "⏸ Pause" : "▶ Play"}</Button>
            <input type="range" min={0} max={last} value={asof} onChange={(e) => { setPlaying(false); setAsof(Number(e.target.value)); }} aria-label="As-of date" className="w-40 sm:w-64" />
            <span className="tabular w-24 text-right font-medium">{rrg.dates[asof]}</span>
            <Button size="sm" variant="ghost" onClick={() => { setPlaying(false); setAsof(last); }}>Latest</Button>
          </span>
        </div>
        <EChart option={option} height={600} ariaLabel="Relative rotation graph of thematic groups"
          onEvents={{ click: ((p: { seriesName?: string }) => { const s = series.find((x) => x.name === p.seriesName); if (s) router.push(groupHref(s.slug)); }) as never }} />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {QUADRANTS.map((q) => (
            <div key={q} className="rounded-md border border-line p-2.5" style={{ borderTopColor: QUAD_COLOR[q], borderTopWidth: 3 }}>
              <div className="mb-1.5 flex items-baseline justify-between text-xs">
                <span className="font-semibold" style={{ color: QUAD_COLOR[q] }}>{q}</span>
                <span className="text-muted">{QUAD_HINT[q]} · {byQ[q].length}</span>
              </div>
              <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs">
                {byQ[q].length ? byQ[q].map((s) => (
                  <li key={s.name} className="flex items-center justify-between gap-2" onMouseEnter={() => setFocus(s.name)} onMouseLeave={() => setFocus("")}>
                    <Link href={groupHref(s.slug)} className="min-w-0 truncate hover:underline" title={s.name}>{s.name}</Link>
                    <span className="tabular text-muted">{s.score?.toFixed(0) ?? "–"}</span>
                  </li>
                )) : <li className="text-muted">none shown</li>}
              </ul>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
