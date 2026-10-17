"use client";

import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BUCKET_LABEL } from "@/lib/states";
import { downloadCsv, fmtInt, fmtNum } from "@/lib/format";
import type { Bucket, DayStatus, StockRow } from "@/lib/types";
import { ALL_BUCKETS } from "@/lib/types";
import { cn } from "@/lib/utils";

type SortKey = "symbol" | "bucket" | "rel_vol" | "close" | "volume" | "above";

export default function StocksPage() {
  const { status, ema, dataVersion } = useApp();
  const [date, setDate] = useState<string>("");
  const [dates, setDates] = useState<string[]>([]);
  const [rows, setRows] = useState<StockRow[] | null>(null);
  const [dayStatus, setDayStatus] = useState<DayStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [bucket, setBucket] = useState<Bucket>("ALL");
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"all" | "valid" | "excluded">("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "rel_vol", dir: -1 });

  useEffect(() => {
    fetch("/api/breadth", { cache: "no-store" }).then((r) => r.json()).then((b) => {
      const ds = Array.from(new Set<string>((b.rows ?? []).map((r: { date: string }) => r.date))).sort().reverse();
      setDates(ds);
      setDate((d) => d || ds[0] || "");
    });
  }, [dataVersion]);

  useEffect(() => {
    if (!date) return;
    setRows(null);
    setError(null);
    fetch(`/api/day/${date}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((b) => {
        setRows(b.rows ?? []);
        setDayStatus(b.status ?? null);
        setNote(b.note ?? null);
        if (b.error) setError(b.error);
      })
      .catch((e) => setError(String(e)));
  }, [date, dataVersion]);

  const view = useMemo(() => {
    if (!rows) return [];
    const ql = q.trim().toUpperCase();
    const out = rows.filter((r) =>
      (bucket === "ALL" || r.bucket === bucket) &&
      (!ql || r.symbol.includes(ql)) &&
      (show === "all" || (show === "valid" ? r.valid : !r.valid)));
    const key = sort.key;
    const val = (r: StockRow): number | string => {
      if (key === "symbol") return r.symbol;
      if (key === "bucket") return ALL_BUCKETS.indexOf(r.bucket);
      if (key === "above") return (r.above_ema10 ? 1 : 0) + (r.above_ema20 ? 1 : 0) + (r.above_ema50 ? 1 : 0);
      return (r[key] as number | null) ?? -Infinity;
    };
    return [...out].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
  }, [rows, bucket, q, show, sort]);

  const th = (key: SortKey, label: string, right = false) => (
    <th className={cn("cursor-pointer select-none py-1.5 pr-3 font-medium hover:text-ink", right && "text-right")}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : key === "symbol" ? 1 : -1 }))}
      aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      {label}{sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
    </th>
  );
  const nExcl = rows?.filter((r) => !r.valid).length ?? 0;

  return (
    <Card>
      <CardHeader
        title="Stocks"
        subtitle={`Per-stock inputs for ${date || "–"}. rel_vol = volume ÷ 20-session average (before today). Above/below uses split-adjusted closes.`}
        actions={
          <>
            <select aria-label="Session" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 rounded-md border border-line bg-surface px-2 text-xs tabular">
              {dates.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select aria-label="Bucket" value={bucket} onChange={(e) => setBucket(e.target.value as Bucket)} className="h-8 rounded-md border border-line bg-surface px-2 text-xs">
              {ALL_BUCKETS.map((b) => <option key={b} value={b}>{b === "ALL" ? "All buckets" : BUCKET_LABEL[b]}</option>)}
            </select>
            <select aria-label="Show" value={show} onChange={(e) => setShow(e.target.value as typeof show)} className="h-8 rounded-md border border-line bg-surface px-2 text-xs">
              <option value="all">All symbols</option>
              <option value="valid">Valid only</option>
              <option value="excluded">Excluded only ({nExcl})</option>
            </select>
            <input aria-label="Search symbol" placeholder="Symbol…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 w-32 rounded-md border border-line bg-surface px-2 text-xs" />
            <Button size="sm" variant="ghost" onClick={() => downloadCsv(`stocks_${date}.csv`, view as unknown as Record<string, unknown>[])}>CSV</Button>
          </>
        }
      />
      <CardBody>
        {dayStatus && dayStatus.status !== "ok" ? (
          <p className="mb-2 rounded bg-surface-2 px-2 py-1 text-xs">Data for this day: <b>{dayStatus.status}</b> · source {dayStatus.source ?? "?"}{dayStatus.notes?.length ? ` · ${dayStatus.notes.join("; ")}` : ""}</p>
        ) : null}
        {note ? <p className="mb-2 text-xs text-muted">{note}</p> : null}
        {error ? <EmptyState title="No per-stock data for this day" reason={error} /> : !rows ? (
          <div className="h-64 animate-pulse rounded bg-surface-2" />
        ) : !rows.length ? (
          <EmptyState title="No symbols" reason={status?.latestDate ? "The archive has no rows for this date." : "No data yet."} />
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full text-sm tabular">
              <thead className="sticky top-0 bg-surface text-left text-xs text-muted">
                <tr className="border-b border-line">
                  {th("symbol", "Symbol")}
                  {th("bucket", "Bucket")}
                  {th("close", "Close", true)}
                  {th("volume", "Volume", true)}
                  {th("rel_vol", "rel_vol", true)}
                  {th("above", "EMA 10 · 20 · 50")}
                  <th className="py-1.5 pr-3 font-medium">Status</th>
                  <th className="py-1.5 font-medium">Archive</th>
                </tr>
              </thead>
              <tbody>
                {view.map((r) => (
                  <tr key={r.symbol} className={cn("border-b border-line/60", !r.valid && "text-ink-2")}>
                    <td className="py-1 pr-3 font-medium">{r.symbol}</td>
                    <td className="py-1 pr-3 text-xs">{BUCKET_LABEL[r.bucket] ?? r.bucket}</td>
                    <td className="py-1 pr-3 text-right">{fmtNum(r.close)}{r.adj_factor && r.adj_factor !== 1 ? <span className="ml-1 text-[10px] text-muted" title="split-adjusted factor">÷{r.adj_factor}</span> : null}</td>
                    <td className="py-1 pr-3 text-right">{fmtInt(r.volume)}</td>
                    <td className="py-1 pr-3 text-right">
                      <span className={cn(r.rel_vol != null && r.rel_vol >= 1.5 && "font-semibold")}>{fmtNum(r.rel_vol)}</span>
                      {r.valid && r.rel_vol != null ? (r.rel_vol >= 1.5 ? <span className="ml-1 text-[10px]">▲ high</span> : r.rel_vol < 0.5 ? <span className="ml-1 text-[10px]">▼ low</span> : null) : null}
                    </td>
                    <td className="py-1 pr-3">
                      {r.valid ? (
                        <span className="inline-flex gap-1">
                          {([10, 20, 50] as const).map((e) => {
                            const up = r[`above_ema${e}`];
                            return (
                              <span key={e} title={`EMA${e}: ${fmtNum(r[`ema${e}`])}`}
                                className={cn("inline-flex w-[4.5rem] justify-center whitespace-nowrap rounded px-1 text-[11px]", e === ema ? "font-semibold" : "", up ? "bg-[#2a78d6]/15" : "bg-[#e34948]/15")}>
                                {up ? "▲ above" : "▼ below"}
                              </span>
                            );
                          })}
                        </span>
                      ) : <span className="text-xs text-muted">–</span>}
                    </td>
                    <td className="py-1 pr-3 text-xs">{r.valid ? "valid" : <span title="excluded from counts">excluded: {r.reason}</span>}</td>
                    <td className="py-1 text-xs"><a className="underline" href={`/api/download/stock/${encodeURIComponent(r.symbol)}`}>OHLCV</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">{view.length} of {rows.length} symbols shown · {nExcl} excluded from that day&apos;s counts</p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
