"use client";

import { useEffect, useMemo, useState } from "react";
import { BUCKET_LABEL, STATE_META } from "@/lib/states";
import { fmtDelta, fmtNum, fmtPct, downloadCsv } from "@/lib/format";
import { indexRows } from "@/lib/series";
import type { Ema, HistoryRow, StateCode } from "@/lib/types";
import { ALL_BUCKETS } from "@/lib/types";
import { Button } from "./ui/button";

function StateChip({ s }: { s: StateCode | null }) {
  if (!s) return <span className="text-muted">–</span>;
  return <span className="rounded px-1 text-[10px] font-bold text-white" style={{ background: STATE_META[s].color }} title={STATE_META[s].name}>{STATE_META[s].icon} {s}</span>;
}

export function CompareDays({ rows, ema }: { rows: HistoryRow[]; ema: Ema }) {
  const { by, dates } = useMemo(() => indexRows(rows), [rows]);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  useEffect(() => {
    if (!dates.length) return;
    setB((x) => (x && dates.includes(x) ? x : dates.at(-1)!));
    setA((x) => (x && dates.includes(x) ? x : dates[Math.max(0, dates.length - 6)]));
  }, [dates]);
  if (!dates.length) return <p className="text-sm text-muted">No history to compare.</p>;

  const metrics: { key: string; label: string; get: (r: HistoryRow) => number | null; fmt: (v: number | null) => string; d: number }[] = [
    { key: "vr", label: "Volume ratio", get: (r) => r.vol_ratio, fmt: (v) => (v == null ? "null" : fmtNum(v)), d: 2 },
    { key: "p", label: `% > EMA${ema}`, get: (r) => r[`pct_ema${ema}`], fmt: (v) => fmtPct(v), d: 1 },
    { key: "hi", label: "N high", get: (r) => r.n_high, fmt: (v) => fmtNum(v, 0), d: 0 },
    { key: "lo", label: "N low", get: (r) => r.n_low, fmt: (v) => fmtNum(v, 0), d: 0 },
    { key: "nv", label: "n_valid", get: (r) => r.n_valid, fmt: (v) => fmtNum(v, 0), d: 0 },
  ];
  const exportRows = ALL_BUCKETS.map((bk) => {
    const ra = by[a]?.[bk];
    const rb = by[b]?.[bk];
    const o: Record<string, unknown> = { bucket: bk };
    for (const m of metrics) {
      const va = ra ? m.get(ra) : null;
      const vb = rb ? m.get(rb) : null;
      o[`${m.label} @${a}`] = va;
      o[`${m.label} @${b}`] = vb;
      o[`${m.label} Δ`] = va != null && vb != null ? +(vb - va).toFixed(3) : null;
    }
    o[`state @${a}`] = ra?.[`state_ema${ema}`];
    o[`state @${b}`] = rb?.[`state_ema${ema}`];
    return o;
  });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <label className="text-xs text-ink-2" htmlFor="cmp-a">Day A</label>
        <select id="cmp-a" value={a} onChange={(e) => setA(e.target.value)} className="rounded border border-line bg-surface px-2 py-1 text-sm tabular">
          {dates.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <label className="text-xs text-ink-2" htmlFor="cmp-b">Day B</label>
        <select id="cmp-b" value={b} onChange={(e) => setB(e.target.value)} className="rounded border border-line bg-surface px-2 py-1 text-sm tabular">
          {dates.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => downloadCsv(`compare_${a}_${b}.csv`, exportRows)}>CSV</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="py-1 pr-3 font-medium">Bucket</th>
              <th className="py-1 pr-3 font-medium">State A → B</th>
              {metrics.map((m) => <th key={m.key} className="py-1 pr-3 text-right font-medium">{m.label}<div className="font-normal">A · B · Δ</div></th>)}
            </tr>
          </thead>
          <tbody>
            {ALL_BUCKETS.map((bk) => {
              const ra = by[a]?.[bk];
              const rb = by[b]?.[bk];
              return (
                <tr key={bk} className="border-b border-line/60">
                  <td className="py-1 pr-3 font-medium">{BUCKET_LABEL[bk]}</td>
                  <td className="py-1 pr-3"><StateChip s={(ra?.[`state_ema${ema}`] as StateCode) ?? null} /> → <StateChip s={(rb?.[`state_ema${ema}`] as StateCode) ?? null} /></td>
                  {metrics.map((m) => {
                    const va = ra ? m.get(ra) : null;
                    const vb = rb ? m.get(rb) : null;
                    return (
                      <td key={m.key} className="py-1 pr-3 text-right">
                        <span className="text-ink-2">{m.fmt(va)}</span> · <span>{m.fmt(vb)}</span>{" "}
                        <span className="text-xs text-ink-2">{va != null && vb != null ? fmtDelta(vb - va, m.d) : ""}</span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
