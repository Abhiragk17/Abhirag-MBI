"use client";

import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Card, CardBody, CardHeader, EmptyState, Skeleton } from "@/components/ui/card";
import { Button, Segmented } from "@/components/ui/button";
import { FieldPicker } from "@/components/scanner/FieldPicker";
import { ConditionRow } from "@/components/scanner/ConditionRow";
import { ResultsTable } from "@/components/scanner/ResultsTable";
import { downloadCsv } from "@/lib/format";
import {
  BUCKET_ORDER, DEFAULT_COLUMNS, PRESETS, blankCondition, emptyScan, fmtCell, indexData, isActive, loadSaved, runScan, storeSaved,
  type Condition, type Saved, type Scan, type ScreenerData,
} from "@/lib/screener";
import { BUCKET_LABEL } from "@/lib/states";
import type { Bucket } from "@/lib/types";
import { cn } from "@/lib/utils";

const LS_SCAN = "mbi.scan.current", LS_COLS = "mbi.scan.columns";
const sel = "h-8 rounded-md border border-line bg-surface px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export default function ScannerPage() {
  const { ema, dataVersion, runJob, status } = useApp();
  const [data, setData] = useState<ScreenerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<Scan>(emptyScan);
  const [columns, setColumns] = useState<string[]>(DEFAULT_COLUMNS);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "rs_rating", dir: -1 });
  const [saved, setSaved] = useState<Saved[]>([]);
  const [name, setName] = useState("");
  const [presetNote, setPresetNote] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // per-viewer conveniences: last scan, chosen columns, saved scans
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(LS_SCAN) ?? "null");
      if (s?.conditions && s?.universe) setScan(s);
      const c = JSON.parse(localStorage.getItem(LS_COLS) ?? "null");
      if (Array.isArray(c) && c.length) setColumns(c);
    } catch { /* storage unavailable */ }
    setSaved(loadSaved());
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(LS_SCAN, JSON.stringify(scan)); localStorage.setItem(LS_COLS, JSON.stringify(columns)); } catch { /* storage unavailable */ }
  }, [scan, columns, hydrated]);

  useEffect(() => {
    let live = true;
    setError(null);
    fetch("/api/screener", { cache: "no-store" })
      .then(async (r) => {
        const b = await r.json();
        if (!live) return;
        if (!r.ok) { setData(null); setError(b.error ?? `HTTP ${r.status}`); } else setData(b);
      })
      .catch((e) => live && setError(String(e)));
    return () => { live = false; };
  }, [dataVersion]);

  const ix = useMemo(() => (data ? indexData(data) : null), [data]);
  const hits = useMemo(() => (data && ix ? runScan(data, ix, scan) : []), [data, ix, scan]);
  const shownCols = useMemo(() => {
    if (!ix) return columns;
    const extra = scan.conditions.flatMap((c) => [c.field, c.vsField ?? ""]).filter((k) => k && ix.field[k] && !columns.includes(k));
    return [...columns, ...Array.from(new Set(extra))];
  }, [columns, scan.conditions, ix]);

  if (error) {
    return (
      <div className="mx-auto mt-10 flex max-w-lg flex-col items-center gap-3">
        <EmptyState title="Screener data not built yet" reason={error} className="w-full" />
        <Button variant="outline" onClick={() => runJob("screener")} disabled={!!status?.job?.running}>Build screener data</Button>
      </div>
    );
  }
  if (!data || !ix) return <Skeleton className="h-64" label="Loading screener" />;

  const patch = (id: string, p: Partial<Condition>) => setScan((s) => ({ ...s, conditions: s.conditions.map((c) => (c.id === id ? { ...c, ...p } : c)) }));
  const activeN = scan.conditions.filter((c) => isActive(c, ix)).length;
  const u = scan.universe;
  const setU = (p: Partial<Scan["universe"]>) => setScan((s) => ({ ...s, universe: { ...s.universe, ...p } }));
  const rowObjects = hits.map((i) => {
    const r = data.rows[i];
    const o: Record<string, unknown> = { symbol: r[ix.col.symbol], bucket: r[ix.col.bucket], group: r[ix.col.group] };
    shownCols.forEach((k) => { o[ix.field[k]?.label ?? k] = r[ix.col[k]]; });
    return o;
  });

  const save = () => {
    const n = name.trim();
    if (!n) return;
    const next = [...saved.filter((s) => s.name !== n), { name: n, scan, columns }];
    setSaved(next); storeSaved(next); setName("");
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Scanner"
          subtitle={`${data.n_stocks} stocks · technical data as of ${data.date} · ${data.fields.length} fields · ${data.n_sessions} sessions of history (since ${data.archive_start})`}
          actions={
            <>
              <Button size="sm" variant="outline" onClick={() => runJob("screener")} disabled={!!status?.job?.running} title="Runs python -m mbi screener">Rebuild data</Button>
            </>
          }
        />
        <CardBody>
          <div className="mb-3">
            <p className="mb-1.5 text-xs font-medium text-ink-2">Ready-made scans</p>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button key={p.id} type="button" title={p.desc}
                  onClick={() => { setScan((s) => ({ ...s, match: p.match ?? "all", conditions: p.build() })); setPresetNote(`${p.label}: ${p.desc}`); }}
                  className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                  {p.label}
                </button>
              ))}
            </div>
            {presetNote ? <p className="mt-1.5 text-xs text-ink-2">{presetNote}</p> : null}
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-2.5 py-2 text-xs">
            <span className="font-medium text-ink-2">Universe</span>
            <span role="group" aria-label="Buckets" className="flex flex-wrap gap-1">
              {BUCKET_ORDER.map((b) => {
                const on = u.buckets.includes(b);
                return (
                  <button key={b} type="button" aria-pressed={on}
                    onClick={() => setU({ buckets: on ? u.buckets.filter((x) => x !== b) : [...u.buckets, b] })}
                    className={cn("rounded border px-2 py-0.5", on ? "border-ink bg-ink text-page" : "border-line bg-surface hover:bg-surface-2")}>
                    {BUCKET_LABEL[b as Bucket] ?? b}
                  </button>
                );
              })}
            </span>
            <select aria-label="Theme group" value={u.group} onChange={(e) => setU({ group: e.target.value })} className={cn(sel, "max-w-[14rem]")}>
              <option value="">All groups</option>
              {ix.groups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <label className="inline-flex items-center gap-1.5">Min traded value (₹ Cr/day)
              <input inputMode="decimal" aria-label="Minimum traded value" value={u.minTv} onChange={(e) => setU({ minTv: e.target.value })} className={cn(sel, "w-16 text-right tabular")} />
            </label>
            <label className="inline-flex items-center gap-1.5"><input type="checkbox" className="accent-accent" checked={u.tradedOnly} onChange={(e) => setU({ tradedOnly: e.target.checked })} />Traded on latest session</label>
            <label className="inline-flex items-center gap-1.5" title="Hides stocks whose price jumped more than -40% / +60% in one day within the last year: almost always an unadjusted split or bonus that would distort returns and RS.">
              <input type="checkbox" className="accent-accent" checked={u.cleanOnly !== false} onChange={(e) => setU({ cleanOnly: e.target.checked })} />Exclude unadjusted price jumps (1Y)
            </label>
            <label className="inline-flex items-center gap-1.5"><input type="checkbox" className="accent-accent" checked={u.breadthOnly} onChange={(e) => setU({ breadthOnly: e.target.checked })} />Valid for breadth only</label>
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="text-xs font-medium text-ink-2">Conditions</p>
            <Segmented<"all" | "any"> label="Match" value={scan.match} onChange={(m) => setScan((s) => ({ ...s, match: m }))}
              options={[{ value: "all", label: "Match all" }, { value: "any", label: "Match any" }]} />
            <Button size="sm" variant="outline" onClick={() => setScan((s) => ({ ...s, conditions: [...s.conditions, blankCondition()] }))}>+ Add condition</Button>
            {scan.conditions.length ? <Button size="sm" variant="ghost" onClick={() => { setScan((s) => ({ ...s, conditions: [] })); setPresetNote(null); }}>Clear</Button> : null}
          </div>
          <div className="flex flex-col gap-1.5">
            {scan.conditions.length === 0 ? (
              <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-xs text-muted">
                No conditions yet: every stock in the universe is listed. Pick a ready-made scan above or add a condition.
              </p>
            ) : scan.conditions.map((c) => (
              <ConditionRow key={c.id} c={c} fields={data.fields} ix={ix} onChange={(p) => patch(c.id, p)}
                onRemove={() => setScan((s) => ({ ...s, conditions: s.conditions.filter((x) => x.id !== c.id) }))} />
            ))}
          </div>
          {scan.conditions.length > activeN ? <p className="mt-1.5 text-xs text-muted">{scan.conditions.length - activeN} condition(s) have no value yet and are ignored.</p> : null}

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs">
            <span className="font-medium text-ink-2">Saved scans</span>
            <select aria-label="Load a saved scan" value="" className={sel}
              onChange={(e) => { const s = saved.find((x) => x.name === e.target.value); if (s) { setScan(s.scan); setColumns(s.columns); setPresetNote(null); } }}>
              <option value="">{saved.length ? "Load…" : "None yet"}</option>
              {saved.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
            <input aria-label="Name for this scan" placeholder="Name this scan" value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") save(); }} className={cn(sel, "w-40")} />
            <Button size="sm" variant="outline" onClick={save} disabled={!name.trim()}>Save</Button>
            {saved.length ? (
              <select aria-label="Delete a saved scan" value="" className={sel}
                onChange={(e) => { const next = saved.filter((x) => x.name !== e.target.value); setSaved(next); storeSaved(next); }}>
                <option value="">Delete…</option>
                {saved.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
            ) : null}
            <span className="text-muted">Saved in this browser.</span>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`${hits.length} stock${hits.length === 1 ? "" : "s"} match`}
          subtitle={`${activeN} active condition${activeN === 1 ? "" : "s"} · ${scan.match === "all" ? "all must match" : "any can match"} · click a symbol for its chart`}
          actions={
            <>
              <FieldPicker className="w-44" fields={data.fields} value={null} label="Add a column" placeholder="+ Add column"
                onChange={(k) => setColumns((c) => (c.includes(k) ? c : [...c, k]))} />
              <Button size="sm" variant="ghost" onClick={() => setColumns(DEFAULT_COLUMNS)}>Reset columns</Button>
              <Button size="sm" variant="ghost" onClick={() => downloadCsv(`scan_${data.date}.csv`, rowObjects)}>CSV</Button>
            </>
          }
        />
        <CardBody>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {columns.map((k) => (
              <span key={k} className="inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[11px]">
                {ix.field[k]?.label ?? k}
                <button type="button" aria-label={`Remove column ${ix.field[k]?.label ?? k}`} className="text-muted hover:text-ink" onClick={() => setColumns((c) => c.filter((x) => x !== k))}>×</button>
              </span>
            ))}
          </div>
          <ResultsTable data={data} ix={ix} hits={hits} columns={shownCols} sort={sort} setSort={setSort} ema={ema} />
          <p className="mt-3 text-[11px] text-muted">
            Benchmarks are equal-weight proxies built from this archive (no index data): Market = {data.bench.mkt?.members} stocks, Largecap = {data.bench.lc?.members} stocks.
            1M market return {fmtCell(undefined, data.bench.mkt?.returns["1m"] ?? null)}%.
            3Y/5Y fields stay empty until the archive is long enough; &quot;all-time&quot; means since {data.archive_start}.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
