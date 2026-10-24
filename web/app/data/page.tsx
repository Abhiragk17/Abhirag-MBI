"use client";

import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fmtDateTime } from "@/lib/format";
import type { DayStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const ST_COLOR: Record<string, string> = {
  ok: "var(--good)", recovered: "var(--warning)", fallback: "var(--warning)", partial: "var(--serious)", failed: "var(--critical)",
};
const ST_ICON: Record<string, string> = { ok: "●", recovered: "▲", fallback: "▲", partial: "◐", failed: "■" };

interface SplitInfo {
  validation: { checked_at: string; valid: { symbol: string; ex_date: string; factor: number; type: string }[]; issues: { index: number | null; reason: string; row: unknown }[] } | null;
}

export default function DataPage() {
  const { status, runJob } = useApp();
  const [splits, setSplits] = useState<SplitInfo | null>(null);
  const [log, setLog] = useState<{ file: string | null; text: string } | null>(null);
  const [onlyIssues, setOnlyIssues] = useState(true);
  const [stockSym, setStockSym] = useState("");

  useEffect(() => {
    fetch("/api/splits").then((r) => r.json()).then(setSplits).catch(() => setSplits(null));
    fetch("/api/log").then((r) => r.json()).then(setLog).catch(() => setLog(null));
  }, [status?.status?.updated_at]);

  const st = status?.status;
  const days = useMemo(() => Object.entries(st?.days ?? {}).sort((a, b) => b[0].localeCompare(a[0])) as [string, DayStatus][], [st]);
  const shown = onlyIssues ? days.filter(([, d]) => d.status !== "ok" || d.suspected_events?.length || d.errors?.length) : days;
  const counts = days.reduce<Record<string, number>>((m, [, d]) => ((m[d.status] = (m[d.status] ?? 0) + 1), m), {});
  const suspected = days.flatMap(([date, d]) => (d.suspected_events ?? []).map((e) => ({ date, ...e })));
  const run = st?.last_run;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Last job" info="last_job" />
          <CardBody className="text-sm">
            {run ? (
              <dl className="grid grid-cols-[110px_1fr] gap-y-1">
                <dt className="text-muted">Command</dt><dd className="font-mono text-xs">{run.command}</dd>
                <dt className="text-muted">Started</dt><dd>{fmtDateTime(run.started_at)}</dd>
                <dt className="text-muted">Finished</dt><dd>{fmtDateTime(run.finished_at)}</dd>
                <dt className="text-muted">Result</dt>
                <dd>{run.ok == null ? "running / interrupted" : run.ok ? <span><span style={{ color: "var(--good)" }}>●</span> ok</span> : <span><span style={{ color: "var(--critical)" }}>■</span> failed</span>}</dd>
                {run.summary ? (<><dt className="text-muted">Summary</dt><dd className="text-xs">{run.summary}</dd></>) : null}
                {run.error ? (<><dt className="text-muted">Error</dt><dd className="text-xs">{run.error}</dd></>) : null}
              </dl>
            ) : <p className="text-muted">No job has run yet.</p>}
            {run?.traceback ? <pre className="mt-2 max-h-40 overflow-auto rounded bg-surface-2 p-2 font-mono text-[11px]">{run.traceback}</pre> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => runJob("daily")} disabled={!!status?.job?.running}>Run daily</Button>
              <Button size="sm" variant="outline" onClick={() => runJob("recompute")} disabled={!!status?.job?.running}>Recompute from archive</Button>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Universe & calendar" info="universe_card" />
          <CardBody className="text-sm">
            {st?.universe ? (
              <dl className="grid grid-cols-[110px_1fr] gap-y-1">
                <dt className="text-muted">Version</dt><dd className="tabular">{st.universe.version} ({st.universe.age_days} days old)</dd>
                <dt className="text-muted">Ranks 1–750</dt><dd>{st.universe.source}</dd>
                <dt className="text-muted">Nanocap</dt><dd>{st.universe.nanocap_stale ? <span><span style={{ color: "var(--warning)" }}>▲</span> {st.universe.nanocap_note}</span> : st.universe.nanocap_note ?? "ranked"}</dd>
                {st.universe.counts ? (<><dt className="text-muted">Counts</dt><dd className="text-xs tabular">{Object.entries(st.universe.counts).map(([k, v]) => `${k} ${v}`).join(" · ")}</dd></>) : null}
              </dl>
            ) : <p className="text-muted">No universe built yet.</p>}
            {st?.universe?.warnings?.length ? <ul className="mt-2 list-disc pl-4 text-xs text-ink-2">{st.universe.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}
            <p className="mt-3 text-xs"><span className="text-muted">Holiday calendar:</span> {st?.calendar ? `${st.calendar.source}${st.calendar.note ? ` – ${st.calendar.note}` : ""}` : "–"}</p>
            <p className="mt-1 text-xs"><span className="text-muted">Network:</span> {st?.offline ? <span><span style={{ color: "var(--critical)" }}>■</span> offline since {fmtDateTime(st.offline_since)}</span> : "online at last refresh"}</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Downloads" info="downloads" />
          <CardBody className="flex flex-col gap-3 text-sm">
            <a className="underline" href="/api/download/history">breadth_history.csv (all indicator history)</a>
            <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (stockSym) window.location.href = `/api/download/stock/${encodeURIComponent(stockSym.toUpperCase())}`; }}>
              <input value={stockSym} onChange={(e) => setStockSym(e.target.value)} placeholder="Symbol, e.g. KOTAKBANK" aria-label="Symbol" className="h-8 w-48 rounded-md border border-line bg-surface px-2 text-xs" />
              <Button size="sm" variant="outline" type="submit">Raw OHLCV</Button>
              <Button size="sm" variant="ghost" type="button" onClick={() => stockSym && (window.location.href = `/api/download/stock/${encodeURIComponent(stockSym.toUpperCase())}?adjusted=1`)}>Split-adjusted</Button>
            </form>
            <p className="text-xs text-muted">Status counts: {Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(" · ") || "–"}</p>
          </CardBody>
        </Card>
      </div>

      <Card id="quality">
        <CardHeader title="Data quality · suspected unadjusted events" info="suspected" subtitle="close / previous close below 0.6 or above 1.6 with no split-list entry. Excluded from that day's counts." />
        <CardBody>
          {suspected.length ? (
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-sm tabular">
                <thead className="text-left text-xs text-muted"><tr className="border-b border-line"><th className="py-1 pr-3 font-medium">Date</th><th className="py-1 pr-3 font-medium">Symbol</th><th className="py-1 pr-3 font-medium">Bucket</th><th className="py-1 pr-3 text-right font-medium">Ratio</th><th className="py-1 font-medium">Hint</th></tr></thead>
                <tbody>
                  {suspected.map((e) => (
                    <tr key={`${e.date}-${e.symbol}`} className="border-b border-line/60">
                      <td className="py-1 pr-3">{e.date}</td><td className="py-1 pr-3 font-medium">{e.symbol}</td><td className="py-1 pr-3 text-xs">{e.bucket}</td>
                      <td className="py-1 pr-3 text-right">{e.ratio.toFixed(3)}</td>
                      <td className="py-1 text-xs">Add to split list? <code className="rounded bg-surface-2 px-1">{`{"symbol": "${e.symbol}", "ex_date": "${e.date}", "factor": ${(1 / e.ratio).toFixed(2)}, "type": "split"}`}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="No suspected events" reason="No unexplained price jumps in the stored days." />}
        </CardBody>
      </Card>

      <Card id="splits">
        <CardHeader title="Split list validation" info="split_list" subtitle={`data/config/split_adjustments.json · checked ${fmtDateTime(splits?.validation?.checked_at)}`} />
        <CardBody>
          {splits?.validation?.issues?.length ? (
            <ul className="mb-3 text-sm">
              {splits.validation.issues.map((i, k) => <li key={k}><span style={{ color: "var(--warning)" }}>▲</span> row {i.index ?? "?"}: {i.reason} <code className="text-xs text-ink-2">{JSON.stringify(i.row)}</code></li>)}
            </ul>
          ) : <p className="mb-3 text-sm"><span style={{ color: "var(--good)" }}>●</span> All rows valid.</p>}
          {splits?.validation?.valid?.length ? (
            <table className="text-sm tabular">
              <thead className="text-left text-xs text-muted"><tr className="border-b border-line"><th className="py-1 pr-4 font-medium">Symbol</th><th className="py-1 pr-4 font-medium">Ex-date</th><th className="py-1 pr-4 text-right font-medium">Factor</th><th className="py-1 font-medium">Type</th></tr></thead>
              <tbody>{splits.validation.valid.map((s) => <tr key={`${s.symbol}-${s.ex_date}`} className="border-b border-line/60"><td className="py-1 pr-4 font-medium">{s.symbol}</td><td className="py-1 pr-4">{s.ex_date}</td><td className="py-1 pr-4 text-right">{s.factor}</td><td className="py-1">{s.type}</td></tr>)}</tbody>
            </table>
          ) : <p className="text-sm text-muted">No splits loaded yet (the list is validated on the next compute).</p>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Per-day status log" info="day_log" subtitle="Source used, attempts, errors, missing and excluded symbols."
          actions={<label className="inline-flex items-center gap-1.5 text-xs text-ink-2"><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} className="accent-[#2a78d6]" />only days with issues</label>} />
        <CardBody>
          {!shown.length ? <EmptyState title={onlyIssues ? "No days with issues" : "No days logged"} /> : (
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full text-sm tabular">
                <thead className="sticky top-0 bg-surface text-left text-xs text-muted"><tr className="border-b border-line">
                  <th className="py-1 pr-3 font-medium">Date</th><th className="py-1 pr-3 font-medium">Status</th><th className="py-1 pr-3 font-medium">Source</th><th className="py-1 pr-3 text-right font-medium">Attempts</th><th className="py-1 pr-3 font-medium">Missing</th><th className="py-1 pr-3 font-medium">Excluded</th><th className="py-1 font-medium">Errors / notes</th>
                </tr></thead>
                <tbody>
                  {shown.map(([date, d]) => (
                    <tr key={date} className="border-b border-line/60 align-top">
                      <td className="py-1 pr-3">{date}{d.stale ? <span className="ml-1 text-[10px] text-muted">stale</span> : null}</td>
                      <td className="py-1 pr-3"><span style={{ color: ST_COLOR[d.status] }} aria-hidden>{ST_ICON[d.status]}</span> {d.status}</td>
                      <td className="py-1 pr-3 text-xs">{d.source ?? "–"}</td>
                      <td className="py-1 pr-3 text-right">{d.attempts}</td>
                      <td className="py-1 pr-3 text-xs" title={d.missing_symbols.join(", ")}>{d.missing_symbols.length ? `${d.missing_symbols.length}: ${d.missing_symbols.slice(0, 6).join(", ")}${d.missing_symbols.length > 6 ? "…" : ""}` : "–"}</td>
                      <td className="py-1 pr-3 text-xs" title={(d.excluded_symbols ?? []).map((e) => `${e.symbol} (${e.reason})`).join(", ")}>
                        {d.excluded_summary ? Object.entries(d.excluded_summary).map(([k, v]) => `${v} ${k}`).join("; ") : d.excluded_symbols?.length ?? "–"}
                      </td>
                      <td className="py-1 text-xs text-ink-2">{[...(d.errors ?? []), ...(d.notes ?? [])].join(" · ") || "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Recent events" info="events" subtitle="Recoveries, fallbacks and failures recorded by the NSE client and jobs." />
        <CardBody>
          {st?.events?.length ? (
            <ul className="max-h-64 overflow-auto font-mono text-xs">
              {[...st.events].reverse().slice(0, 100).map((e, i) => <li key={i} className="border-b border-line/50 py-0.5"><span className="text-muted">{e.ts}</span> <b>{e.kind}</b> {e.detail}</li>)}
            </ul>
          ) : <p className="text-sm text-muted">No events.</p>}
        </CardBody>
      </Card>

      <Card id="log">
        <CardHeader title="Run log" info="run_log" subtitle={log?.file ?? "no log file"} actions={<Button size="sm" variant="ghost" onClick={() => fetch("/api/log").then((r) => r.json()).then(setLog)}>Reload</Button>} />
        <CardBody>
          {status?.job?.lines?.length ? (
            <>
              <p className="mb-1 text-xs text-ink-2">Live output of {status.job.name}{status.job.running ? " (running)" : ""}:</p>
              <pre className="mb-3 max-h-56 overflow-auto rounded bg-surface-2 p-2 font-mono text-[11px]">{status.job.lines.slice(-80).join("\n")}</pre>
            </>
          ) : null}
          <pre className={cn("max-h-96 overflow-auto rounded bg-surface-2 p-2 font-mono text-[11px]", !log?.text && "text-muted")}>{log?.text || "No log yet."}</pre>
        </CardBody>
      </Card>
    </div>
  );
}
