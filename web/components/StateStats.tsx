"use client";

import { STATE_META, STATE_ORDER } from "@/lib/states";
import { stateStats } from "@/lib/series";
import type { Bucket, Ema, HistoryRow } from "@/lib/types";
import { fmtNum } from "@/lib/format";
import { downloadCsv } from "@/lib/format";
import { Button } from "./ui/button";
import { InfoTip } from "./ui/info";

export function StateStats({ rows, bucket, ema, raw }: { rows: HistoryRow[]; bucket: Bucket; ema: Ema; raw: boolean }) {
  const s = stateStats(rows, bucket, ema, raw);
  if (!s.total) return <p className="text-sm text-muted">No classified sessions in this range.</p>;
  const maxT = Math.max(1, ...STATE_ORDER.flatMap((a) => STATE_ORDER.map((b) => s.transitions[a][b])));
  return (
    <div className="flex flex-col gap-6">
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="py-1 pr-2 font-medium">State</th>
              <th className="py-1 pr-2 text-right font-medium">Days</th>
              <th className="py-1 pr-2 font-medium">Share</th>
              <th className="py-1 pr-2 text-right font-medium">Runs</th>
              <th className="py-1 pr-2 text-right font-medium">Avg run</th>
              <th className="py-1 text-right font-medium">Longest</th>
            </tr>
          </thead>
          <tbody>
            {STATE_ORDER.map((c) => {
              const b = s.byState[c];
              return (
                <tr key={c} className="border-b border-line/60">
                  <td className="py-1 pr-2">
                    <span className="mr-1.5 inline-block rounded px-1 text-[10px] font-bold text-white" style={{ background: STATE_META[c].color }}>{STATE_META[c].icon} {c}</span>
                    {STATE_META[c].short}
                  </td>
                  <td className="py-1 pr-2 text-right">{b.days}</td>
                  <td className="py-1 pr-2">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 rounded-sm bg-surface-2">
                        <div className="h-2 rounded-sm" style={{ width: `${b.pct}%`, background: STATE_META[c].color }} />
                      </div>
                      <span className="text-xs">{fmtNum(b.pct, 1)}%</span>
                    </div>
                  </td>
                  <td className="py-1 pr-2 text-right">{b.runs}</td>
                  <td className="py-1 pr-2 text-right">{b.runs ? fmtNum(b.avgRun, 1) : "–"}</td>
                  <td className="py-1 text-right">{b.longest || "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-1 text-xs text-muted">{s.total} classified sessions · {raw ? "raw" : "confirmed"} states</p>
      </div>
      <div className="overflow-x-auto">
        <div className="mb-1 flex items-center justify-between">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-ink-2">Transition matrix (row = from, column = to) <InfoTip k="transitions" /></span>
          <Button size="sm" variant="ghost" onClick={() => downloadCsv(`transitions_${bucket}_ema${ema}.csv`, STATE_ORDER.map((a) => ({ from: a, ...s.transitions[a] })))}>CSV</Button>
        </div>
        <table className="text-xs tabular">
          <thead>
            <tr>
              <th className="p-1" />
              {STATE_ORDER.map((c) => <th key={c} className="p-1 font-semibold" title={STATE_META[c].name}>{STATE_META[c].icon} {c}</th>)}
            </tr>
          </thead>
          <tbody>
            {STATE_ORDER.map((a) => (
              <tr key={a}>
                <th className="p-1 text-left font-semibold" title={STATE_META[a].name}>{STATE_META[a].icon} {a}</th>
                {STATE_ORDER.map((b) => {
                  const n = s.transitions[a][b];
                  const op = a === b ? 0 : n / maxT;
                  return (
                    <td key={b} className="h-8 w-10 border border-line text-center" style={{ background: a === b ? "var(--surface-2)" : `rgba(42,120,214,${(op * 0.7).toFixed(2)})`, color: op > 0.55 ? "#fff" : undefined }}>
                      {a === b ? "·" : n || ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
