"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { fmtCell, signColor, type Indexed, type ScreenerData } from "@/lib/screener";
import { BUCKET_LABEL } from "@/lib/states";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Bucket } from "@/lib/types";

const PAGE = 100;

export function ResultsTable({ data, ix, hits, columns, sort, setSort, ema }: {
  data: ScreenerData; ix: Indexed; hits: number[]; columns: string[];
  sort: { key: string; dir: 1 | -1 }; setSort: (s: { key: string; dir: 1 | -1 }) => void; ema: number;
}) {
  const [shown, setShown] = useState(PAGE);
  const sorted = useMemo(() => {
    const ci = ix.col[sort.key];
    if (ci == null) return hits;
    const text = typeof data.rows[0]?.[ci] === "string" || sort.key === "symbol" || sort.key === "bucket" || sort.key === "group";
    return [...hits].sort((a, b) => {
      const va = data.rows[a][ci], vb = data.rows[b][ci];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;          // empty values always last
      if (vb == null) return -1;
      const d = text ? String(va).localeCompare(String(vb)) : (va as number) - (vb as number);
      return d * sort.dir;
    });
  }, [hits, data.rows, ix.col, sort]);

  const th = (key: string, label: string, right: boolean, title?: string) => (
    <th key={key} scope="col" title={title} tabIndex={0}
      aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
      onClick={() => setSort({ key, dir: sort.key === key ? ((-sort.dir) as 1 | -1) : key === "symbol" || key === "bucket" || key === "group" ? 1 : -1 })}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}
      className={cn("cursor-pointer select-none whitespace-nowrap bg-surface py-1.5 pr-3 font-medium hover:text-ink", right && "text-right")}>
      {label}{sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
    </th>
  );

  if (!hits.length) return <p className="py-6 text-center text-sm text-muted">No stocks match. Loosen a condition or widen the universe.</p>;
  return (
    <div>
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full text-sm tabular">
          <thead className="sticky top-0 z-10 text-left text-xs text-muted">
            <tr className="border-b border-line">
              {th("symbol", "Symbol", false)}
              {th("bucket", "Bucket", false)}
              {th("group", "Group", false)}
              {columns.map((k) => th(k, ix.field[k]?.label ?? k, true, ix.field[k]?.desc))}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, shown).map((i) => {
              const r = data.rows[i];
              const sym = r[ix.col.symbol] as string;
              return (
                <tr key={sym} className="border-b border-line/60 hover:bg-surface-2">
                  <td className="py-1 pr-3 font-medium"><Link className="hover:underline" href={`/stocks/${encodeURIComponent(sym)}?ema=${ema}`}>{sym}</Link></td>
                  <td className="py-1 pr-3 text-xs">{BUCKET_LABEL[r[ix.col.bucket] as Bucket] ?? r[ix.col.bucket] ?? "–"}</td>
                  <td className="max-w-[14rem] truncate py-1 pr-3 text-xs text-ink-2" title={String(r[ix.col.group] ?? "")}>{r[ix.col.group] ?? "–"}</td>
                  {columns.map((k) => {
                    const v = r[ix.col[k]], f = ix.field[k];
                    return <td key={k} className="py-1 pr-3 text-right" style={{ color: signColor(f, v) }}>{fmtCell(f, v)}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center gap-3 text-xs text-muted">
        <span>Showing {Math.min(shown, sorted.length)} of {sorted.length}</span>
        {shown < sorted.length ? <Button size="sm" variant="outline" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, sorted.length - shown)} more</Button> : null}
      </div>
    </div>
  );
}
