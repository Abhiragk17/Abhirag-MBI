"use client";

import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info";
import type { GlossaryKey } from "@/lib/glossary";

interface ThemeCfg {
  min_traded_value: number; min_history: number; new_listing_sessions: number; winsor: number;
  min_group_size: number; min_stocks_per_day: number;
  rrg: { ratio_window: number; momentum_window: number; tail_step: number; history_sessions: number };
  weights: { rs: number; breadth: number; momentum: number; volume: number };
  emerging_lookback: number; thrust: { lookback: number; rise: number; level: number };
  corr_window: number; top_n: number; watchlist: { top_groups: number; stocks_per_group: number };
  aliases: Record<string, string>;
  [k: string]: unknown;
}

function Num({ label, value, onChange, step = 1, min, max, suffix }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string }) {
  return (
    <label className="flex flex-col gap-0.5 text-xs text-ink-2">
      {label}
      <span className="flex items-center gap-1">
        <input type="number" step={step} min={min} max={max} value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(Number(e.target.value))}
          className="h-8 w-28 rounded-md border border-line bg-surface px-2 text-sm text-ink tabular" />
        {suffix ? <span className="text-muted">{suffix}</span> : null}
      </span>
    </label>
  );
}

const H = ({ children, info }: { children: React.ReactNode; info: GlossaryKey }) => (
  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">{children}<InfoTip k={info} /></h3>
);

const countList = (text: string) => {
  const blocks = text.split("###").map((b) => b.trim()).filter(Boolean);
  const syms = new Set<string>();
  blocks.forEach((b) => (b.match(/NSE:[A-Za-z0-9_&-]+/gi) ?? []).forEach((s) => syms.add(s.toUpperCase())));
  return { groups: blocks.length, symbols: syms.size };
};

export function ThemeConfig() {
  const { runJob, status } = useApp();
  const [cfg, setCfg] = useState<ThemeCfg | null>(null);
  const [saved, setSaved] = useState<ThemeCfg | null>(null);
  const [defaults, setDefaults] = useState<ThemeCfg | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState("");
  const [savedList, setSavedList] = useState("");
  const [customList, setCustomList] = useState(false);
  const [newAlias, setNewAlias] = useState({ from: "", to: "" });

  const load = async () => {
    try {
      const r = await fetch("/api/themes/config", { cache: "no-store" });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? `HTTP ${r.status}`);
      setCfg(b.config); setSaved(b.config); setDefaults(b.defaults);
      const l = await fetch("/api/themes/list", { cache: "no-store" }).then((x) => x.json());
      setList(l.text); setSavedList(l.text); setCustomList(!!l.custom);
      setErr(null);
    } catch (e) { setErr(String(e)); }
  };
  useEffect(() => { load(); }, []);

  const running = !!status?.job?.running;
  const dirtyCfg = useMemo(() => JSON.stringify(cfg) !== JSON.stringify(saved), [cfg, saved]);
  const dirtyList = list !== savedList;
  const stats = useMemo(() => countList(list), [list]);
  const wsum = cfg ? cfg.weights.rs + cfg.weights.breadth + cfg.weights.momentum + cfg.weights.volume : 0;

  if (err) return <EmptyState title="Could not load theme settings" reason={err} />;
  if (!cfg || !defaults) return <EmptyState title="Loading theme settings…" />;

  const set = (fn: (c: ThemeCfg) => void) => { const n = structuredClone(cfg); fn(n); setCfg(n); };
  const int = (v: number) => Math.max(1, Math.round(v));

  const save = async (recompute: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      if (dirtyList) {
        const rl = await fetch("/api/themes/list", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: list }) });
        const bl = await rl.json();
        if (!rl.ok) throw new Error(bl.error ?? "could not save the group list");
        setSavedList(list); setCustomList(true);
      }
      const r = await fetch("/api/themes/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: cfg }) });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? "could not save");
      if (b.config) { setCfg(b.config); setSaved(b.config); } else setSaved(cfg);
      setMsg(recompute ? "Saved. Recomputing themes…" : "Saved. Press “Recompute themes” on the Themes page (or here) to apply it.");
      if (recompute) await runJob("themes");
    } catch (e) { setMsg(`Save failed: ${String(e)}`); }
    setBusy(false);
  };
  const resetCfg = () => { setCfg(structuredClone(defaults)); setMsg("Defaults loaded (not saved yet). Review, then Save."); };
  const resetList = async () => {
    if (!window.confirm("Replace the group list with the original file shipped with the app? Your edited list will be removed.")) return;
    await fetch("/api/themes/list", { method: "DELETE" });
    const l = await fetch("/api/themes/list", { cache: "no-store" }).then((x) => x.json());
    setList(l.text); setSavedList(l.text); setCustomList(false);
    setMsg("Group list reset to the original file. Recompute themes to apply it.");
  };
  const aliases = Object.entries(cfg.aliases ?? {});

  return (
    <Card>
      <span id="themes" className="relative -top-16 block" />
      <CardHeader title="Themes & sector rotation" subtitle="data/config/theme_config.json and data/config/themes.txt · changes apply on the next recompute."
        actions={<>
          <Button size="sm" variant="ghost" onClick={resetCfg}>Reset to defaults</Button>
          <Button size="sm" variant="outline" disabled={(!dirtyCfg && !dirtyList) || busy} onClick={() => save(false)}>Save</Button>
          <Button size="sm" disabled={busy || running} onClick={() => save(true)}>Save & recompute themes</Button>
        </>} />
      <CardBody className="flex flex-col gap-6">
        {msg ? <p className="rounded bg-surface-2 px-2 py-1 text-sm">{msg}</p> : null}

        <section>
          <H info="cfgth_liquidity">Liquidity filter</H>
          <Num label="Min 20-day median traded value" suffix="lakh ₹ / day" step={5} min={0} value={Math.round(cfg.min_traded_value / 1e5)} onChange={(v) => set((c) => { c.min_traded_value = Math.max(0, v) * 1e5; })} />
          <p className="mt-1 text-[11px] text-muted">{(cfg.min_traded_value / 1e7).toFixed(2)} crore. Default {defaults.min_traded_value / 1e5} lakh.</p>
        </section>

        <section>
          <H info="cfgth_history">History and new listings</H>
          <div className="flex flex-wrap gap-3">
            <Num label="Min history to count" suffix="sessions" min={2} value={cfg.min_history} onChange={(v) => set((c) => { c.min_history = int(v); })} />
            <Num label="Tag as “new” if younger than" suffix="sessions" min={1} value={cfg.new_listing_sessions} onChange={(v) => set((c) => { c.new_listing_sessions = int(v); })} />
          </div>
        </section>

        <section>
          <H info="cfgth_winsor">Daily return clip</H>
          <Num label="Clip each stock&apos;s daily move at ±" suffix="%" step={1} min={1} max={90} value={Math.round(cfg.winsor * 100)} onChange={(v) => set((c) => { c.winsor = Math.min(Math.max(v, 1), 90) / 100; })} />
        </section>

        <section>
          <H info="cfgth_min_size">Group size limits</H>
          <div className="flex flex-wrap gap-3">
            <Num label="Min counted stocks to rank a group" min={1} value={cfg.min_group_size} onChange={(v) => set((c) => { c.min_group_size = int(v); })} />
            <Num label="Min counted stocks per day" min={1} value={cfg.min_stocks_per_day} onChange={(v) => set((c) => { c.min_stocks_per_day = int(v); })} />
          </div>
        </section>

        <section>
          <H info="cfgth_rrg">Rotation graph windows</H>
          <div className="flex flex-wrap gap-3">
            <Num label="RS-Ratio window" suffix="sessions" min={5} value={cfg.rrg.ratio_window} onChange={(v) => set((c) => { c.rrg.ratio_window = int(v); })} />
            <Num label="RS-Momentum window" suffix="sessions" min={1} value={cfg.rrg.momentum_window} onChange={(v) => set((c) => { c.rrg.momentum_window = int(v); })} />
            <Num label="Tail step" suffix="sessions" min={1} value={cfg.rrg.tail_step} onChange={(v) => set((c) => { c.rrg.tail_step = int(v); })} />
            <Num label="History kept" suffix="sessions" min={20} value={cfg.rrg.history_sessions} onChange={(v) => set((c) => { c.rrg.history_sessions = int(v); })} />
          </div>
        </section>

        <section>
          <H info="cfgth_weights">Leadership score weights</H>
          <div className="flex flex-wrap gap-3">
            {([["rs", "Relative strength"], ["breadth", "Breadth"], ["momentum", "RS momentum"], ["volume", "Volume expansion"]] as const).map(([k, label]) => (
              <Num key={k} label={label} min={0} step={5} value={cfg.weights[k]}
                suffix={wsum > 0 ? `${((cfg.weights[k] / wsum) * 100).toFixed(0)}%` : ""} onChange={(v) => set((c) => { c.weights[k] = Math.max(0, v); })} />
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted">Only the ratios matter; the percentages show each component&apos;s share of the score.</p>
        </section>

        <section>
          <H info="cfgth_alerts">Alert thresholds</H>
          <div className="flex flex-wrap gap-3">
            <Num label="Emerging / losing look-back" suffix="sessions" min={1} value={cfg.emerging_lookback} onChange={(v) => set((c) => { c.emerging_lookback = int(v); })} />
            <Num label="Thrust: within" suffix="sessions" min={1} value={cfg.thrust.lookback} onChange={(v) => set((c) => { c.thrust.lookback = int(v); })} />
            <Num label="Thrust: % > EMA20 rises by" suffix="points" min={1} value={cfg.thrust.rise} onChange={(v) => set((c) => { c.thrust.rise = Math.max(1, v); })} />
            <Num label="Thrust: to at least" suffix="%" min={1} max={100} value={cfg.thrust.level} onChange={(v) => set((c) => { c.thrust.level = Math.min(100, Math.max(1, v)); })} />
          </div>
        </section>

        <section>
          <H info="cfgth_misc">Correlation, lists and watchlist</H>
          <div className="flex flex-wrap gap-3">
            <Num label="Correlation window" suffix="sessions" min={10} value={cfg.corr_window} onChange={(v) => set((c) => { c.corr_window = int(v); })} />
            <Num label="Rows in top-stock lists" min={5} value={cfg.top_n} onChange={(v) => set((c) => { c.top_n = int(v); })} />
            <Num label="Watchlist: groups" min={1} value={cfg.watchlist.top_groups} onChange={(v) => set((c) => { c.watchlist.top_groups = int(v); })} />
            <Num label="Watchlist: stocks per group" min={1} value={cfg.watchlist.stocks_per_group} onChange={(v) => set((c) => { c.watchlist.stocks_per_group = int(v); })} />
          </div>
        </section>

        <section>
          <H info="cfgth_aliases">Symbol aliases</H>
          {aliases.length ? (
            <ul className="mb-2 flex flex-wrap gap-2">
              {aliases.map(([k, v]) => (
                <li key={k} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2 py-1 text-xs">
                  <code>{k}</code> → <code>{v}</code>
                  <button aria-label={`Remove alias ${k}`} className="text-muted hover:text-ink" onClick={() => set((c) => { delete c.aliases[k]; })}>✕</button>
                </li>
              ))}
            </ul>
          ) : <p className="mb-2 text-xs text-muted">No manual aliases. Symbols with _ are already tried as & and - automatically.</p>}
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-0.5 text-xs text-ink-2">Symbol in the group list
              <input value={newAlias.from} onChange={(e) => setNewAlias({ ...newAlias, from: e.target.value })} placeholder="M_M" className="h-8 w-36 rounded-md border border-line bg-surface px-2 text-sm text-ink" /></label>
            <label className="flex flex-col gap-0.5 text-xs text-ink-2">NSE symbol in the archive
              <input value={newAlias.to} onChange={(e) => setNewAlias({ ...newAlias, to: e.target.value })} placeholder="M&M" className="h-8 w-36 rounded-md border border-line bg-surface px-2 text-sm text-ink" /></label>
            <Button size="sm" variant="outline" disabled={!newAlias.from.trim() || !newAlias.to.trim()}
              onClick={() => { set((c) => { c.aliases[newAlias.from.trim().toUpperCase()] = newAlias.to.trim().toUpperCase(); }); setNewAlias({ from: "", to: "" }); }}>Add alias</Button>
          </div>
        </section>

        <section>
          <H info="cfgth_list">Group list</H>
          <p className="mb-2 text-xs text-ink-2">
            <b>{stats.groups}</b> groups · <b>{stats.symbols}</b> symbols · {customList || dirtyList ? "using your edited list" : "using the original file"}
            {dirtyList ? <span className="ml-1 text-muted">(unsaved)</span> : null}
          </p>
          <textarea value={list} onChange={(e) => setList(e.target.value)} spellCheck={false} aria-label="Group list"
            className="h-72 w-full rounded-md border border-line bg-surface-2 p-2 font-mono text-xs" />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!customList} onClick={resetList}>Reset to original list</Button>
            <span className="self-center text-[11px] text-muted">Format: <code>###GROUP NAME,NSE:SYMBOL,NSE:SYMBOL</code>, one group per line.</span>
          </div>
        </section>
      </CardBody>
    </Card>
  );
}
