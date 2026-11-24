"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button, Segmented } from "@/components/ui/button";
import { InfoTip, WithInfo } from "@/components/ui/info";
import { EChart, baseOption, ChartTokens } from "@/components/charts/EChart";
import { downloadCsv } from "@/lib/format";
import type { GroupRow, Period } from "@/lib/themes";
import { PERIODS, QUAD_COLOR } from "@/lib/themes";
import { Delta, groupHref, heatColor, QuadBadge, Ret, ScoreBar, Spark, Th } from "./shared";

type SortKey = "rank" | "name" | `ret_${Period}` | "rel_3M" | "pct_ema20" | "pct_ema50" | "pct_near_high" | "vol_exp" | "n_eligible" | "score";
type Metric = "ret" | "rel" | "score" | "breadth";

const METRIC_LABEL: Record<Metric, string> = { ret: "Return", rel: "vs market", score: "Score", breadth: "% > EMA20" };

function metricValue(g: GroupRow, m: Metric, p: Period): number | null {
  if (m === "ret") return g[`ret_${p}` as const];
  if (m === "rel") return g[`rel_${p}` as const];
  if (m === "score") return g.score;
  return g.pct_ema20;
}

export function Leaderboard({ groups, t }: { groups: GroupRow[]; t: ChartTokens }) {
  const router = useRouter();
  const [view, setView] = useState<"table" | "map">("table");
  const [period, setPeriod] = useState<Period>("1M");
  const [metric, setMetric] = useState<Metric>("ret");
  const [q, setQ] = useState("");
  const [showLow, setShowLow] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "rank", dir: 1 });

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const base = groups.filter((g) => (showLow || !g.low_n) && (!ql || g.name.toLowerCase().includes(ql)));
    const val = (g: GroupRow): number | string => {
      if (sort.key === "name") return g.name;
      if (sort.key === "rank") return g.rank ?? 9999;
      return (g[sort.key] as number | null) ?? -Infinity;
    };
    return [...base].sort((a, b) => {
      const va = val(a), vb = val(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
  }, [groups, q, showLow, sort]);

  const th = (key: SortKey, label: string, right = true, title?: string, info?: Parameters<typeof Th>[0]["info"]) => (
    <Th right={right} title={title} info={info} active={sort.key === key} dir={sort.dir}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : key === "name" || key === "rank" ? 1 : -1 }))}>{label}</Th>
  );

  // ---- heatmap: tile colour by metric, tile size by counted stocks
  const mapData = useMemo(() => {
    const vals = rows.map((g) => metricValue(g, metric, period)).filter((v): v is number => v != null);
    const abs = vals.map(Math.abs).sort((a, b) => a - b);
    // clamp at the 90th percentile so one outlier does not wash out every other tile
    const lim = metric === "score" || metric === "breadth" ? 100 : Math.max(3, abs[Math.floor(abs.length * 0.9)] ?? 5);
    const mode = metric === "score" || metric === "breadth" ? "seq" : "div";
    return { lim, mode: mode as "div" | "seq" };
  }, [rows, metric, period]);

  const option = useMemo<EChartsOption>(() => {
    const unit = metric === "score" ? "" : "%";
    const data = rows.filter((g) => metricValue(g, metric, period) != null && g.n_eligible > 0).map((g) => {
      const v = metricValue(g, metric, period) as number;
      const c = heatColor(v, mapData.lim, t.dark, mapData.mode);
      return { name: g.name, slug: g.slug, value: [g.n_eligible, v], itemStyle: { color: c.bg }, label: { color: c.fg }, g };
    });
    return {
      ...baseOption(t),
      tooltip: {
        ...baseOption(t).tooltip,
        formatter: (p: unknown) => {
          const d = (p as { data: { name: string; value: [number, number]; g: GroupRow } }).data;
          const g = d.g;
          const f = (x: number | null, s = "%") => (x == null ? "–" : `${x > 0 && s === "%" ? "+" : ""}${x.toFixed(1)}${s}`);
          return `<b>${d.name}</b><br/>${METRIC_LABEL[metric]}${metric === "ret" || metric === "rel" ? ` (${period})` : ""}: <b>${f(d.value[1], unit)}</b><br/>`
            + `Rank ${g.rank ?? "–"} · score ${g.score?.toFixed(0) ?? "–"} · ${g.quadrant ?? "–"}<br/>`
            + `1M ${f(g.ret_1M)} · 3M ${f(g.ret_3M)} · ${g.pct_ema20?.toFixed(0) ?? "–"}% > EMA20<br/>`
            + `<span style="color:${t.muted}">${g.n_eligible} stocks counted · click to open</span>`;
        },
      },
      series: [{
        type: "treemap", data: data as never, roam: false, nodeClick: false, breadcrumb: { show: false }, top: 0, bottom: 0, left: 0, right: 0,
        squareRatio: 1.1,
        label: {
          show: true, overflow: "truncate", position: "insideTopLeft", padding: [4, 6],
          formatter: (p: { name: string; data: { value: [number, number] } }) => {
            const v = p.data.value[1];
            return `{n|${p.name}}\n{v|${v > 0 && metric !== "score" && metric !== "breadth" ? "+" : ""}${v.toFixed(metric === "score" || metric === "breadth" ? 0 : 1)}${unit}}`;
          },
          rich: { n: { fontSize: 11, fontWeight: 600, lineHeight: 15 }, v: { fontSize: 13, fontWeight: 700, lineHeight: 18 } },
        },
        itemStyle: { borderColor: t.surface, borderWidth: 2, gapWidth: 1, borderRadius: 3 },
        emphasis: { itemStyle: { borderColor: t.ink, borderWidth: 2 } },
      }],
    } as EChartsOption;
  }, [rows, period, metric, t, mapData]);

  const legend = useMemo(() => {
    const stops = mapData.mode === "div" ? [-1, -0.5, 0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
    const cols = stops.map((s) => heatColor(mapData.mode === "div" ? s * mapData.lim : s * 100, mapData.lim, t.dark, mapData.mode).bg);
    const labels = mapData.mode === "div" ? [`−${mapData.lim.toFixed(0)}`, "0", `+${mapData.lim.toFixed(0)}`] : ["0", "50", "100"];
    return { css: `linear-gradient(90deg, ${cols.join(",")})`, labels };
  }, [mapData, t.dark]);

  const exportRows = rows.map((g) => ({
    rank: g.rank, group: g.name, score: g.score, quadrant: g.quadrant, ret_1D: g.ret_1D, ret_1W: g.ret_1W, ret_1M: g.ret_1M,
    ret_3M: g.ret_3M, ret_6M: g.ret_6M, rel_3M: g.rel_3M, pct_above_ema20: g.pct_ema20, pct_above_ema50: g.pct_ema50,
    pct_near_52w_high: g.pct_near_high, vol_expansion: g.vol_exp, stocks_counted: g.n_eligible, stocks_in_group: g.n_total,
  }));
  const cellBg = (v: number | null) => (v == null ? undefined : { background: heatColor(v, 15, t.dark).bg, color: heatColor(v, 15, t.dark).fg });

  return (
    <Card>
      <CardHeader
        title="Group leaderboard" info="th_leaderboard"
        subtitle="Equal-weight group index vs the market. Score blends relative strength, internal breadth, RS momentum and volume expansion (0-100)."
        actions={<>
          <Segmented label="View" value={view} onChange={setView} options={[{ value: "table", label: "Table" }, { value: "map", label: "Heatmap" }]} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter groups" aria-label="Filter groups" className="h-8 w-36 rounded-md border border-line bg-surface px-2 text-xs" />
          <WithInfo k="th_low_n"><label className="flex items-center gap-1 text-xs text-ink-2"><input type="checkbox" checked={showLow} onChange={(e) => setShowLow(e.target.checked)} />show low-n</label></WithInfo>
          <Button size="sm" variant="outline" onClick={() => downloadCsv("theme_leaderboard.csv", exportRows)}>CSV</Button>
        </>}
      />
      <CardBody>
        {view === "map" ? (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <WithInfo k="th_heatmap"><span className="text-xs font-medium text-ink-2">Colour by</span></WithInfo>
              <Segmented<Metric> label="Metric" value={metric} onChange={setMetric} options={(Object.keys(METRIC_LABEL) as Metric[]).map((m) => ({ value: m, label: METRIC_LABEL[m] }))} />
              {metric === "ret" || metric === "rel" ? <Segmented<Period> label="Period" value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ value: p, label: p }))} /> : null}
              <span className="ml-auto flex items-center gap-2 text-[11px] text-ink-2">
                <span className="tabular">{legend.labels[0]}</span>
                <span className="h-2.5 w-40 rounded" style={{ background: legend.css }} aria-hidden />
                <span className="tabular">{legend.labels.at(-1)}</span>
                <span className="text-muted">tile size = stocks counted</span>
              </span>
            </div>
            <EChart option={option} height={560} ariaLabel={`Treemap of groups coloured by ${METRIC_LABEL[metric]}`}
              onEvents={{ click: ((p: { data?: { slug?: string } }) => { if (p.data?.slug) router.push(groupHref(p.data.slug)); }) as never }} />
          </>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1150px] text-xs">
              <thead className="border-b border-line text-left text-ink-2">
                <tr>
                  {th("rank", "#", false)}{th("name", "Group", false)}{th("score", "Score", false, undefined, "th_score")}
                  <Th info="th_quadrant">Rotation</Th>
                  {PERIODS.map((p) => th(`ret_${p}` as SortKey, p))}
                  {th("rel_3M", "3M vs mkt", true, undefined, "th_rel_3m")}
                  {th("pct_ema20", "%>EMA20", true, undefined, "th_pct_ema")}
                  {th("pct_ema50", "%>EMA50")}
                  {th("pct_near_high", "Near 52wH", true, undefined, "th_near_high")}
                  {th("vol_exp", "Vol exp.", true, undefined, "th_vol_exp")}
                  {th("n_eligible", "n", true, undefined, "th_n")}
                  <Th>60d</Th><Th>Leaders</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((g) => (
                  <tr key={g.slug} className="border-b border-line/60 hover:bg-surface-2">
                    <td className="py-1.5 pr-3 tabular text-ink-2">{g.rank ?? "–"} <Delta v={g.rank != null && g.rank_5d != null ? g.rank_5d - g.rank : null} /></td>
                    <td className="py-1.5 pr-3 font-medium"><Link className="hover:underline" href={groupHref(g.slug)}>{g.name}</Link>{g.low_n ? <span className="ml-1 text-[10px] text-muted">low n</span> : null}</td>
                    <td className="py-1.5 pr-3"><ScoreBar v={g.score} /></td>
                    <td className="py-1.5 pr-3"><QuadBadge q={g.quadrant} /></td>
                    {PERIODS.map((p) => {
                      const v = g[`ret_${p}` as const];
                      return <td key={p} className="px-1 py-1.5 text-right tabular" style={cellBg(v)}>{v == null ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`}</td>;
                    })}
                    <td className="py-1.5 pr-3 text-right"><Ret v={g.rel_3M} /></td>
                    <td className="py-1.5 pr-3 text-right tabular">{g.pct_ema20 == null ? "–" : `${g.pct_ema20.toFixed(0)}%`} <Delta v={g.pct_ema20 != null && g.pct_ema20_5d != null ? g.pct_ema20 - g.pct_ema20_5d : null} /></td>
                    <td className="py-1.5 pr-3 text-right tabular">{g.pct_ema50 == null ? "–" : `${g.pct_ema50.toFixed(0)}%`}</td>
                    <td className="py-1.5 pr-3 text-right tabular">{g.pct_near_high == null ? "–" : `${g.pct_near_high.toFixed(0)}%`}</td>
                    <td className="py-1.5 pr-3 text-right tabular">{g.vol_exp == null ? "–" : `${g.vol_exp.toFixed(2)}×`}</td>
                    <td className="py-1.5 pr-3 text-right tabular text-ink-2">{g.n_eligible}/{g.n_total}</td>
                    <td className="py-1.5 pr-3"><Spark values={g.spark} /></td>
                    <td className="py-1.5 pr-3 text-ink-2">{g.leaders.slice(0, 3).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 flex items-center gap-1 text-[11px] text-muted">Return cells are shaded by size (full colour at ±15%). <InfoTip k="th_quadrant" /> <span>Quadrant colours: </span>
              {Object.entries(QUAD_COLOR).map(([k, c]) => <span key={k} className="ml-1" style={{ color: c }}>● {k}</span>)}</p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
