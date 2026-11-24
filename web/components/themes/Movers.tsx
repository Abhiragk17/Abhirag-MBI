"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button, Segmented } from "@/components/ui/button";
import { downloadCsv } from "@/lib/format";
import type { GroupRow, StockRow, ThemesLatest, TopStock } from "@/lib/themes";
import type { GlossaryKey } from "@/lib/glossary";
import { groupHref, Ret, RoleBadge, Th } from "./shared";

const P4 = ["1D", "1W", "1M", "3M"] as const;
type P4T = (typeof P4)[number];
const RET_KEY: Record<P4T, "ret_1d" | "ret_5d" | "ret_21d" | "ret_63d"> = { "1D": "ret_1d", "1W": "ret_5d", "1M": "ret_21d", "3M": "ret_63d" };

function GroupMovers({ groups, period, side }: { groups: GroupRow[]; period: P4T; side: "gainers" | "losers" }) {
  const key = `ret_${period}` as const;
  const rows = useMemo(() => {
    const ok = groups.filter((g) => !g.low_n && g[key] != null);
    const s = [...ok].sort((a, b) => (b[key] as number) - (a[key] as number));
    return (side === "gainers" ? s : s.reverse()).slice(0, 12);
  }, [groups, key, side]);
  const maxAbs = Math.max(1, ...rows.map((g) => Math.abs(g[key] as number)));
  return (
    <ul className="space-y-1">
      {rows.map((g) => (
        <li key={g.slug} className="flex items-center gap-2 text-xs">
          <Link href={groupHref(g.slug)} className="w-52 shrink-0 truncate hover:underline" title={g.name}>{g.name}</Link>
          <span className="relative h-2 flex-1 rounded bg-surface-2">
            <span className="absolute inset-y-0 left-0 rounded" style={{ width: `${(Math.abs(g[key] as number) / maxAbs) * 100}%`, background: (g[key] as number) >= 0 ? "#0ca30c" : "#d03b3b" }} />
          </span>
          <Ret v={g[key]} className="w-14 text-right" />
        </li>
      ))}
    </ul>
  );
}

function StockList({ rows, period }: { rows: TopStock[]; period: P4T }) {
  const k = RET_KEY[period];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-xs">
        <thead className="border-b border-line text-left text-ink-2"><tr><Th>Stock</Th><Th>Group</Th><Th right>{period}</Th><Th right info="th_rs_stock">RS</Th><Th right info="th_rel_vol">Rel vol</Th><Th info="th_role">Role</Th></tr></thead>
        <tbody>
          {rows.slice(0, 15).map((s) => (
            <tr key={s.symbol} className="border-b border-line/60">
              <td className="py-1 pr-3 font-medium"><Link className="hover:underline" href={`/stocks/${encodeURIComponent(s.symbol)}`}>{s.symbol}</Link></td>
              <td className="max-w-[180px] truncate py-1 pr-3 text-ink-2" title={s.group}>{s.group}</td>
              <td className="py-1 pr-3 text-right"><Ret v={s[k]} /></td>
              <td className="py-1 pr-3 text-right tabular">{s.rs ?? "–"}</td>
              <td className="py-1 pr-3 text-right tabular">{s.rel_vol == null ? "–" : `${s.rel_vol.toFixed(1)}×`}</td>
              <td className="py-1 pr-3"><RoleBadge role={s.role} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Movers({ latest, stocks }: { latest: ThemesLatest; stocks: StockRow[] | null }) {
  const [period, setPeriod] = useState<P4T>("1D");
  const [side, setSide] = useState<"gainers" | "losers">("gainers");
  const [group, setGroup] = useState("");
  const [role, setRole] = useState<"" | "leader" | "laggard">("");
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<keyof StockRow>("rs");
  const [dir, setDir] = useState<1 | -1>(-1);

  const explorer = useMemo(() => {
    if (!stocks) return [];
    const ql = q.trim().toUpperCase();
    const f = stocks.filter((s) => s.liquid && !s.new && s.traded && (!group || s.group === group) && (!role || s.role === role) && (!ql || s.symbol.includes(ql)));
    return [...f].sort((a, b) => {
      const va = (a[sortKey] as number | string | null) ?? -Infinity, vb = (b[sortKey] as number | string | null) ?? -Infinity;
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
    }).slice(0, 150);
  }, [stocks, group, role, q, sortKey, dir]);

  const sortTh = (k: keyof StockRow, label: string, right = true, info?: GlossaryKey) => (
    <Th right={right} info={info} active={sortKey === k} dir={dir} onClick={() => { if (sortKey === k) setDir((d) => (-d) as 1 | -1); else { setSortKey(k); setDir(k === "symbol" || k === "group" ? 1 : -1); } }}>{label}</Th>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Top movers" info="th_movers" subtitle="Groups use the equal-weight index return. Stocks are liquid, not newly listed, and traded today."
          actions={<>
            <Segmented<P4T> label="Period" value={period} onChange={setPeriod} options={P4.map((p) => ({ value: p, label: p }))} />
            <Segmented label="Side" value={side} onChange={setSide} options={[{ value: "gainers", label: "Gainers" }, { value: "losers", label: "Losers" }]} />
          </>} />
        <CardBody>
          <div className="grid gap-6 lg:grid-cols-2">
            <div><h3 className="mb-2 text-xs font-semibold text-ink-2">Groups</h3><GroupMovers groups={latest.groups} period={period} side={side} /></div>
            <div><h3 className="mb-2 text-xs font-semibold text-ink-2">Stocks</h3><StockList rows={latest.top_stocks[side][period] ?? []} period={period} /></div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Stock explorer" info="th_explorer" subtitle="Leaders beat their group over 3 months with RS ≥ 70; laggards trail it with RS < 30. RS = percentile rank across all liquid theme stocks."
          actions={<>
            <select aria-label="Group" value={group} onChange={(e) => setGroup(e.target.value)} className="h-8 max-w-[220px] rounded-md border border-line bg-surface px-2 text-xs">
              <option value="">All groups</option>
              {latest.groups.map((g) => <option key={g.slug} value={g.name}>{g.name}</option>)}
            </select>
            <Segmented label="Role" value={role} onChange={setRole} options={[{ value: "", label: "All" }, { value: "leader", label: "Leaders" }, { value: "laggard", label: "Laggards" }]} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Symbol" aria-label="Symbol" className="h-8 w-24 rounded-md border border-line bg-surface px-2 text-xs" />
            <Button size="sm" variant="outline" onClick={() => downloadCsv("theme_stocks.csv", explorer as unknown as Record<string, unknown>[])}>CSV</Button>
          </>} />
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-xs">
              <thead className="border-b border-line text-left text-ink-2"><tr>
                {sortTh("symbol", "Stock", false)}{sortTh("group", "Group", false)}{sortTh("ret_1d", "1D")}{sortTh("ret_5d", "1W")}{sortTh("ret_21d", "1M")}{sortTh("ret_63d", "3M")}
                {sortTh("rs", "RS", true, "th_rs_stock")}{sortTh("rel_group_63d", "3M vs group", true, "th_vs_group")}{sortTh("from_high", "From 52wH", true, "th_near_high")}{sortTh("rel_vol", "Rel vol", true, "th_rel_vol")}<Th info="th_role">Role</Th>
              </tr></thead>
              <tbody>
                {explorer.map((s) => (
                  <tr key={s.symbol} className="border-b border-line/60 hover:bg-surface-2">
                    <td className="py-1 pr-3 font-medium"><Link className="hover:underline" href={`/stocks/${encodeURIComponent(s.symbol)}`}>{s.symbol}</Link></td>
                    <td className="max-w-[200px] truncate py-1 pr-3 text-ink-2" title={s.group}>{s.group}</td>
                    <td className="py-1 pr-3 text-right"><Ret v={s.ret_1d} /></td><td className="py-1 pr-3 text-right"><Ret v={s.ret_5d} /></td>
                    <td className="py-1 pr-3 text-right"><Ret v={s.ret_21d} /></td><td className="py-1 pr-3 text-right"><Ret v={s.ret_63d} /></td>
                    <td className="py-1 pr-3 text-right tabular">{s.rs ?? "–"}</td>
                    <td className="py-1 pr-3 text-right"><Ret v={s.rel_group_63d} /></td>
                    <td className="py-1 pr-3 text-right"><Ret v={s.from_high} /></td>
                    <td className="py-1 pr-3 text-right tabular">{s.rel_vol == null ? "–" : `${s.rel_vol.toFixed(1)}×`}</td>
                    <td className="py-1 pr-3"><RoleBadge role={s.role} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!stocks ? <p className="py-4 text-center text-xs text-muted">Loading…</p> : explorer.length === 150 ? <p className="py-2 text-center text-xs text-muted">Showing the first 150. Narrow the filters to see more.</p> : null}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
