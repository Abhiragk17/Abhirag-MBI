"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info";
import { Button } from "@/components/ui/button";
import { STATE_META } from "@/lib/states";
import type { RegimeConfig, StateCode } from "@/lib/types";

interface Preview { rows: number; changed: Record<string, number>; changed_dates: Record<string, number>; by_bucket: Record<string, Record<string, number>>; distribution: Record<string, Record<string, number>>; error?: string }

function Num({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <label className="flex flex-col gap-0.5 text-xs text-ink-2">
      {label}
      <input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-8 w-28 rounded-md border border-line bg-surface px-2 text-sm text-ink tabular" />
    </label>
  );
}

export default function ConfigPage() {
  const { ema, runJob, status } = useApp();
  const [cfg, setCfg] = useState<RegimeConfig | null>(null);
  const [saved, setSaved] = useState<RegimeConfig | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [rawJson, setRawJson] = useState("");

  const load = () => fetch("/api/config", { cache: "no-store" }).then((r) => r.json()).then((b) => { setCfg(b.config); setSaved(b.config); setRawJson(JSON.stringify(b.config, null, 2)); });
  useEffect(() => { load(); }, []);

  // live preview (debounced)
  useEffect(() => {
    if (!cfg) return;
    const id = setTimeout(() => {
      fetch("/api/config/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: cfg }) })
        .then((r) => r.json()).then(setPreview).catch((e) => setPreview({ error: String(e) } as Preview));
    }, 500);
    return () => clearTimeout(id);
  }, [cfg]);

  if (!cfg) return <EmptyState title="Loading config…" />;
  const set = (fn: (c: RegimeConfig) => void) => {
    const next = structuredClone(cfg);
    fn(next);
    setCfg(next);
    setRawJson(JSON.stringify(next, null, 2));
  };
  const save = async (andRecompute: boolean) => {
    setBusy(true);
    const r = await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: cfg }) });
    const b = await r.json();
    setBusy(false);
    if (!r.ok) { setMsg(`Save failed: ${b.error}`); return; }
    setSaved(cfg);
    setMsg(andRecompute ? "Saved. Reclassifying history…" : "Saved. Run a recompute to apply it to the stored history.");
    if (andRecompute) await runJob("reclassify");
  };
  const resetToDefaults = async () => {
    const d = await fetch("/api/config/defaults").then((r) => r.json()).catch(() => null);
    if (!d?.config) { setMsg("Could not load defaults"); return; }
    setCfg(d.config);
    setRawJson(JSON.stringify(d.config, null, 2));
    setMsg("Defaults loaded (not saved yet). Check the preview, then Save.");
  };
  const dirty = JSON.stringify(cfg) !== JSON.stringify(saved);
  const cellText = (cell: unknown) => typeof cell === "string" ? cell : `${(cell as { state: string }).state} / ${(cell as { alt_state: string }).alt_state}*`;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="Market situation thresholds" info="cfg_thresholds" subtitle="data/config/regime_config.json · starting defaults that need calibration (spec 7.4). Lower zone edges are inclusive."
          actions={
            <>
              <Button size="sm" variant="ghost" onClick={resetToDefaults}>Reset to defaults</Button>
              <Button size="sm" variant="outline" disabled={!dirty || busy} onClick={() => save(false)}>Save</Button>
              <Button size="sm" disabled={busy || !!status?.job?.running} onClick={() => save(true)}>Save & reclassify history</Button>
            </>
          } />
        <CardBody className="flex flex-col gap-5">
          {msg ? <p className="rounded bg-surface-2 px-2 py-1 text-sm">{msg}</p> : null}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">P zones (% above EMA) – lower edges <InfoTip k="p_zones" /></h3>
            <div className="flex flex-wrap gap-3">
              {(["L", "M", "H", "VH"] as const).map((k) => <Num key={k} label={`${k} from`} value={cfg.p_zones[k]} onChange={(v) => set((c) => { c.p_zones[k] = v; })} />)}
            </div>
          </section>
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">VR zones – lower edges <InfoTip k="vr_zones" /></h3>
            <div className="flex flex-wrap gap-3">
              <Num label="mid from" step={0.05} value={cfg.vr_zones.mid} onChange={(v) => set((c) => { c.vr_zones.mid = v; })} />
              <Num label="high from" step={0.05} value={cfg.vr_zones.high} onChange={(v) => set((c) => { c.vr_zones.high = v; })} />
              <Num label="extreme from" step={0.1} value={cfg.vr_zones.extreme} onChange={(v) => set((c) => { c.vr_zones.extreme = v; })} />
            </div>
          </section>
          <section className="flex flex-wrap gap-8">
            <div>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">Panic override <InfoTip k="panic" /></h3>
              <label className="mb-2 flex items-center gap-1.5 text-xs"><input type="checkbox" checked={cfg.overrides.panic.enabled} onChange={(e) => set((c) => { c.overrides.panic.enabled = e.target.checked; })} /> enabled</label>
              <div className="flex gap-3">
                <Num label="VR ≥" step={0.1} value={cfg.overrides.panic.vr_min} onChange={(v) => set((c) => { c.overrides.panic.vr_min = v; })} />
                <Num label="and P <" value={cfg.overrides.panic.p_max} onChange={(v) => set((c) => { c.overrides.panic.p_max = v; })} />
              </div>
            </div>
            <div>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">Euphoria override <InfoTip k="euphoria" /></h3>
              <label className="mb-2 flex items-center gap-1.5 text-xs"><input type="checkbox" checked={cfg.overrides.euphoria.enabled} onChange={(e) => set((c) => { c.overrides.euphoria.enabled = e.target.checked; })} /> enabled</label>
              <Num label="P ≥" value={cfg.overrides.euphoria.p_min} onChange={(v) => set((c) => { c.overrides.euphoria.p_min = v; })} />
            </div>
            <div>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">Trend & smoothing <InfoTip k="trend_smoothing" /></h3>
              <label className="mb-2 flex items-center gap-1.5 text-xs"><input type="checkbox" checked={cfg.trend.enabled} onChange={(e) => set((c) => { c.trend.enabled = e.target.checked; })} /> use dP trend input</label>
              <div className="flex gap-3">
                <Num label="dP window (sessions)" value={cfg.trend.dp_window} onChange={(v) => set((c) => { c.trend.dp_window = Math.max(1, Math.round(v)); })} />
                <Num label="confirm_days" value={cfg.confirm_days} onChange={(v) => set((c) => { c.confirm_days = Math.max(1, Math.round(v)); })} />
              </div>
            </div>
          </section>
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">Decision table (edit cells in the JSON below) <InfoTip k="decision_table" /></h3>
            <div className="overflow-x-auto">
              <table className="text-sm">
                <thead><tr className="text-xs text-muted"><th className="p-1 text-left">P zone</th><th className="p-1">VR low</th><th className="p-1">VR mid</th><th className="p-1">VR high</th></tr></thead>
                <tbody>
                  {(["VH", "H", "M", "L", "VL"] as const).map((pz) => (
                    <tr key={pz}>
                      <th className="p-1 text-left text-xs">{pz}</th>
                      {(["low", "mid", "high"] as const).map((vz) => {
                        const cell = cfg.table[pz]?.[vz];
                        const base = (typeof cell === "string" ? cell : (cell as { state: string })?.state) as StateCode;
                        return <td key={vz} className="border border-line p-1 text-center text-xs font-semibold" style={{ background: base ? `${STATE_META[base].color}22` : undefined }}>{cell ? cellText(cell) : "–"}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-xs text-muted">* conditional cell: switches to the second state when its <code>alt_when</code> condition holds.</p>
            </div>
          </section>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Live preview" info="live_preview" subtitle="How many stored day × bucket states would change if this config were applied (classifier run by python on the current history)." />
        <CardBody>
          {preview?.error ? <p className="text-sm">Preview failed: {preview.error}</p> : !preview ? <p className="text-sm text-muted">Computing…</p> : (
            <div className="grid gap-4 md:grid-cols-3">
              {(["10", "20", "50"] as const).map((e) => (
                <div key={e} className={`rounded-md border p-3 ${String(ema) === e ? "border-ink" : "border-line"}`}>
                  <div className="text-xs text-muted">EMA{e}</div>
                  <div className="text-2xl font-semibold tabular">{preview.changed?.[e] ?? 0}</div>
                  <div className="text-xs text-ink-2">rows change state, on {preview.changed_dates?.[e] ?? 0} dates (of {preview.rows} rows)</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {Object.entries(preview.distribution?.[e] ?? {}).map(([s, n]) => (
                      <span key={s} className="rounded px-1 text-[10px] font-bold text-white" style={{ background: STATE_META[s as StateCode]?.color ?? "#888" }}>{s} {n}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Raw JSON" info="raw_json" subtitle="Full config, including the decision table and volume-ratio regime bands." actions={
          <Button size="sm" variant="outline" onClick={() => { try { const p = JSON.parse(rawJson); setCfg(p); setMsg(null); } catch (e) { setMsg(`Invalid JSON: ${String(e)}`); } }}>Apply JSON</Button>
        } />
        <CardBody>
          <textarea value={rawJson} onChange={(e) => setRawJson(e.target.value)} spellCheck={false} className="h-96 w-full rounded-md border border-line bg-surface-2 p-2 font-mono text-xs" aria-label="Config JSON" />
        </CardBody>
      </Card>
    </div>
  );
}
