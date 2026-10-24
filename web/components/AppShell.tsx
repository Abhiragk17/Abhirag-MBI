"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Ema, StatusResponse } from "@/lib/types";
import { EMAS } from "@/lib/types";
import { fmtDateTime } from "@/lib/format";
import { Button } from "./ui/button";
import { EmaSelector } from "./EmaSelector";
import { StatusBadge } from "./StatusBadge";
import { StatusBanner } from "./StatusBanner";
import { cn } from "@/lib/utils";
import { InfoTip, WithInfo } from "./ui/info";

export interface JobInfo {
  id: string; name: string; running: boolean; exitCode: number | null; error: string | null;
  startedAt: string; finishedAt: string | null; lines: string[];
}
type FullStatus = StatusResponse & { job: JobInfo | null };

interface Ctx {
  ema: Ema;
  setEma: (e: Ema) => void;
  status: FullStatus | null;
  reloadStatus: () => Promise<void>;
  dataVersion: number;
  runJob: (job: string) => Promise<void>;
  dark: boolean;
}
const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside AppShell");
  return c;
};

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/stocks", label: "Stocks" },
  { href: "/data", label: "Data & Quality" },
  { href: "/config", label: "Config" },
];

function parseEma(v: string | null): Ema | null {
  const n = Number(v);
  return (EMAS as number[]).includes(n) ? (n as Ema) : null;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlEma = parseEma(params.get("ema"));
  const [ema, setEmaState] = useState<Ema>(urlEma ?? 20);
  const [status, setStatus] = useState<FullStatus | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [dark, setDark] = useState(false);
  const lastJob = useRef<string | null>(null);

  // EMA: URL wins, then localStorage, then 20
  useEffect(() => {
    if (urlEma) {
      setEmaState(urlEma);
      try { localStorage.setItem("mbi.ema", String(urlEma)); } catch { /* storage unavailable */ }
      return;
    }
    let stored: Ema | null = null;
    try { stored = parseEma(localStorage.getItem("mbi.ema")); } catch { /* storage unavailable */ }
    const e = stored ?? 20;
    setEmaState(e);
    const sp = new URLSearchParams(params.toString());
    sp.set("ema", String(e));
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlEma, pathname]);

  const setEma = useCallback((e: Ema) => {
    setEmaState(e);
    try { localStorage.setItem("mbi.ema", String(e)); } catch { /* storage unavailable */ }
    const sp = new URLSearchParams(params.toString());
    sp.set("ema", String(e));
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  }, [params, pathname, router]);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("mbi.theme", next ? "dark" : "light"); } catch { /* storage unavailable */ }
  };

  const reloadStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/status", { cache: "no-store" });
      const s = (await r.json()) as FullStatus;
      setStatus(s);
      const j = s.job;
      if (j && !j.running && lastJob.current === j.id) {
        lastJob.current = null;
        setDataVersion((v) => v + 1);
      }
    } catch (e) {
      setStatus({
        status: null, latestDate: null, badge: "error", badgeLabel: "Server unreachable",
        banners: [{ id: "srv", level: "error", message: `Could not reach the app server: ${String(e)}` }],
        warnings: [], generatedAt: new Date().toISOString(), job: null,
      });
    }
  }, []);

  useEffect(() => {
    reloadStatus();
  }, [reloadStatus]);
  const running = !!status?.job?.running;
  useEffect(() => {
    const t = setInterval(reloadStatus, running ? 1500 : 30000);
    return () => clearInterval(t);
  }, [reloadStatus, running]);

  const runJob = useCallback(async (job: string) => {
    try {
      const r = await fetch("/api/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job }) });
      const body = await r.json();
      if (body.job) lastJob.current = body.job.id;
    } catch (e) {
      console.error(e);
    }
    await reloadStatus();
  }, [reloadStatus]);

  const ctx = useMemo(() => ({ ema, setEma, status, reloadStatus, dataVersion, runJob, dark }), [ema, setEma, status, reloadStatus, dataVersion, runJob, dark]);
  const uni = status?.status?.universe;
  const job = status?.job;

  return (
    <AppCtx.Provider value={ctx}>
      <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
          <Link href={`/?ema=${ema}`} className="text-sm font-bold tracking-tight">Market Breadth · India</Link>
          <nav className="flex flex-wrap gap-1">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={`${n.href}?ema=${ema}`}
                className={cn("rounded px-2 py-1 text-sm", pathname === n.href ? "bg-surface-2 font-semibold" : "text-ink-2 hover:bg-surface-2")}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex flex-wrap items-center gap-3 text-xs text-ink-2">
            <WithInfo k="session" className="tabular"><span>Session <b className="text-ink">{status?.latestDate ?? "–"}</b></span></WithInfo>
            <span className="hidden lg:inline-flex"><WithInfo k="universe" className="tabular"><span>Universe <b className="text-ink">{uni?.version ?? "–"}</b></span></WithInfo></span>
            <span className="hidden tabular xl:inline">Refreshed {fmtDateTime(status?.status?.last_run?.finished_at)}</span>
            <WithInfo k="data_status"><StatusBadge level={status?.badge ?? "ok"} label={status?.badgeLabel ?? "Loading"} /></WithInfo>
            <WithInfo k="ema_selector"><EmaSelector value={ema} onChange={setEma} /></WithInfo>
            <Button size="sm" variant="outline" onClick={() => runJob("daily")} disabled={running} title="Runs python -m mbi daily">
              {running ? "Refreshing…" : "Refresh data"}
            </Button>
            <InfoTip k="refresh" className="-ml-2" />
            <Button size="sm" variant="ghost" onClick={toggleTheme} aria-label="Toggle dark mode">{dark ? "☀" : "☾"}</Button>
          </div>
        </div>
        {job && (job.running || (job.finishedAt && Date.now() - new Date(job.finishedAt).getTime() < 120_000)) ? (
          <div className={cn("border-t border-line px-4 py-1 text-xs", job.error ? "bg-[#d03b3b]/10" : "bg-surface-2")}>
            <div className="mx-auto flex max-w-[1500px] items-center gap-2">
              <span className="font-semibold">{job.running ? `Running ${job.name}…` : job.error ? `${job.name} failed: ${job.error}` : `${job.name} finished`}</span>
              <span className="truncate font-mono text-ink-2">{job.lines.at(-1) ?? ""}</span>
              {!job.running && job.error ? <Link className="ml-auto underline" href="/data#log">View log</Link> : null}
            </div>
          </div>
        ) : null}
      </header>
      <StatusBanner banners={status?.banners ?? []} />
      <main className="mx-auto max-w-[1500px] px-4 py-4">{children}</main>
    </AppCtx.Provider>
  );
}
