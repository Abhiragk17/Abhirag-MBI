import "server-only";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import type { Banner, BreadthResponse, HistoryRow, StatusFile, StatusResponse } from "./types";

export const REPO_ROOT = process.env.MBI_ROOT ? path.resolve(process.env.MBI_ROOT) : path.resolve(process.cwd(), "..");
export const DATA_DIR = process.env.MBI_DATA_DIR ? path.resolve(process.env.MBI_DATA_DIR) : path.join(REPO_ROOT, "data");
export const PYTHON = process.env.MBI_PYTHON || (process.platform === "win32" ? "python" : "python3");

export const dataPath = (...p: string[]) => path.join(DATA_DIR, ...p);

export async function readText(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf-8");
  } catch {
    return null;
  }
}

export async function readJson<T>(p: string): Promise<T | null> {
  const t = await readText(p);
  if (t == null) return null;
  try {
    return JSON.parse(t) as T;
  } catch {
    return null;
  }
}

export function parseCsv<T>(text: string): { rows: T[]; ok: boolean } {
  const res = Papa.parse<T>(text, { header: true, dynamicTyping: true, skipEmptyLines: true });
  const fields = res.meta.fields ?? [];
  const ok = fields.includes("date") && fields.includes("bucket") && res.errors.filter((e) => e.type !== "FieldMismatch").length === 0;
  return { rows: res.data, ok };
}

function normaliseRows(rows: HistoryRow[]): HistoryRow[] {
  return rows
    .filter((r) => r && r.date && r.bucket)
    .map((r) => {
      const out = { ...r } as Record<string, unknown>;
      out.date = String(r.date).slice(0, 10);
      out.universe_version = r.universe_version == null ? null : String(r.universe_version);
      for (const k of Object.keys(out)) if (out[k] === "" || (typeof out[k] === "number" && Number.isNaN(out[k]))) out[k] = null;
      return out as unknown as HistoryRow;
    });
}

// ----------------------------------------------------------------------------- python

export interface PyResult { code: number | null; stdout: string; stderr: string; error?: string }

export function runPython(args: string[], timeoutMs = 120_000): Promise<PyResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let done = false;
    let child;
    try {
      child = spawn(PYTHON, ["-m", "mbi", ...args], { cwd: REPO_ROOT, env: { ...process.env, MBI_DATA_DIR: DATA_DIR, PYTHONIOENCODING: "utf-8" }, windowsHide: true });
    } catch (e) {
      resolve({ code: null, stdout, stderr, error: String(e) });
      return;
    }
    const timer = setTimeout(() => {
      if (!done) {
        child.kill();
        resolve({ code: null, stdout, stderr, error: `timed out after ${timeoutMs / 1000}s` });
        done = true;
      }
    }, timeoutMs);
    child.stdout.on("data", (b: Buffer) => (stdout += b.toString("utf-8")));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString("utf-8")));
    child.on("error", (e: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr, error: `could not start ${PYTHON}: ${e.message}` });
    });
    child.on("close", (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

// ----------------------------------------------------------------------------- background jobs

export interface Job {
  id: string;
  name: string;
  args: string[];
  startedAt: string;
  finishedAt: string | null;
  running: boolean;
  exitCode: number | null;
  error: string | null;
  lines: string[];
}

const g = globalThis as unknown as { __mbiJobs?: { current: Job | null; history: Job[] } };
g.__mbiJobs ??= { current: null, history: [] };
const jobs = g.__mbiJobs;

export function currentJob(): Job | null {
  return jobs.current ?? jobs.history[0] ?? null;
}

export function startJob(name: string, args: string[]): { job: Job; alreadyRunning: boolean } {
  if (jobs.current?.running) return { job: jobs.current, alreadyRunning: true };
  const job: Job = {
    id: `${Date.now()}`, name, args, startedAt: new Date().toISOString(), finishedAt: null,
    running: true, exitCode: null, error: null, lines: [],
  };
  jobs.current = job;
  const push = (chunk: Buffer) => {
    for (const line of chunk.toString("utf-8").split(/\r?\n/)) if (line.trim()) job.lines.push(line);
    if (job.lines.length > 400) job.lines.splice(0, job.lines.length - 400);
  };
  const finish = (code: number | null, err: string | null) => {
    if (!job.running) return;
    job.running = false;
    job.exitCode = code;
    job.error = err;
    job.finishedAt = new Date().toISOString();
    jobs.history.unshift(job);
    jobs.history = jobs.history.slice(0, 10);
  };
  try {
    const child = spawn(PYTHON, ["-m", "mbi", ...args], {
      cwd: REPO_ROOT, env: { ...process.env, MBI_DATA_DIR: DATA_DIR, PYTHONIOENCODING: "utf-8" }, windowsHide: true,
    });
    child.stdout.on("data", push);
    child.stderr.on("data", push);
    child.on("error", (e) => finish(null, `could not start "${PYTHON} -m mbi": ${e.message}`));
    child.on("close", (code) => finish(code, code === 0 ? null : `exited with code ${code}`));
  } catch (e) {
    finish(null, `could not start "${PYTHON} -m mbi": ${String(e)}`);
  }
  return { job, alreadyRunning: false };
}

// ----------------------------------------------------------------------------- history

export async function loadHistory(): Promise<BreadthResponse> {
  const warnings: string[] = [];
  const csv = await readText(dataPath("breadth", "breadth_history.csv"));
  if (csv != null) {
    const { rows, ok } = parseCsv<HistoryRow>(csv);
    if (ok) return { rows: normaliseRows(rows), source: "csv", warnings };
    warnings.push("breadth_history.csv is corrupt; loaded the parquet copy instead");
  } else if (await readText(dataPath("breadth", "breadth_history.parquet")) != null) {
    warnings.push("breadth_history.csv is missing; loaded the parquet copy instead");
  } else {
    return { rows: [], source: "none", warnings };
  }
  // Fallback: python reads parquet (store.read_history falls back automatically)
  const py = await runPython(["export-history"], 60_000);
  if (py.code === 0) {
    const { rows, ok } = parseCsv<HistoryRow>(py.stdout);
    if (ok) return { rows: normaliseRows(rows), source: "parquet", warnings };
  }
  const latest = await readJson<{ rows: Record<string, HistoryRow> }>(dataPath("breadth", "breadth_latest.json"));
  if (latest?.rows) {
    warnings.push("history unavailable; showing only the latest day from breadth_latest.json");
    return { rows: normaliseRows(Object.values(latest.rows)), source: "latest_json", warnings };
  }
  warnings.push("no readable breadth history file");
  return { rows: [], source: "none", warnings };
}

// ----------------------------------------------------------------------------- status

const SOURCE_LABEL: Record<string, string> = {
  nse_bhavcopy: "NSE bhavcopy", nse_api: "NSE historical API", yfinance: "yfinance", cache: "cache", demo: "synthetic demo data",
};
export const sourceLabel = (s: string | null | undefined) => (s ? SOURCE_LABEL[s] ?? s : "unknown");

export async function buildStatus(): Promise<StatusResponse> {
  const status = await readJson<StatusFile>(dataPath("meta", "data_status.json"));
  const hist = await loadHistory();
  const latestDate = hist.rows.length ? hist.rows.map((r) => r.date).sort().at(-1)! : null;
  const banners: Banner[] = [];
  const warnings = [...hist.warnings];
  let badge: StatusResponse["badge"] = "ok";
  let badgeLabel = "Data OK";
  const bump = (lvl: StatusResponse["badge"], label: string) => {
    const rank = { ok: 0, warn: 1, partial: 2, error: 3 } as const;
    if (rank[lvl] > rank[badge]) {
      badge = lvl;
      badgeLabel = label;
    }
  };

  if (!status && !hist.rows.length) {
    bump("warn", "No data yet");
    banners.push({ id: "nodata", level: "info", message: "No data yet. Run `python -m mbi backfill --from 2025-01-01` (or `python -m mbi demo` for synthetic data), then refresh.", link: "/data" });
  }
  if (hist.warnings.length) {
    bump("warn", "Fallback file");
    banners.push({ id: "histfile", level: "warn", message: hist.warnings.join("; "), link: "/data" });
  }
  if (status) {
    const run = status.last_run;
    if (run && run.ok === false) {
      bump("error", "Job failed");
      banners.push({ id: `run-${run.started_at}`, level: "error", message: `The last job (${run.command}) failed: ${run.error ?? "unknown error"}. Earlier data is intact.`, details: run.traceback ? [run.traceback] : undefined, link: "/data#log" });
    }
    if (status.offline) {
      bump("error", "Offline / stale");
      banners.push({ id: `offline-${status.offline_since}`, level: "error", message: `Offline: showing data as of ${latestDate ?? "–"}. NSE could not be reached on the last refresh.`, link: "/data" });
    }
    const day = latestDate ? status.days?.[latestDate] : undefined;
    if (day) {
      if (day.stale) bump("error", "Stale");
      if (day.status === "failed") {
        bump("error", "Failed");
        banners.push({ id: `failed-${latestDate}`, level: "error", message: `Data for ${latestDate} failed to load: ${(day.errors ?? []).join("; ")}`, link: "/data" });
      } else if (day.status === "partial") {
        bump("partial", "Partial");
        banners.push({ id: `partial-${latestDate}`, level: "partial", message: `${latestDate} is partial: ${day.missing_symbols.length} symbol(s) missing and excluded from counts (shown as n_valid / n_universe).`, details: day.missing_symbols.slice(0, 60), link: "/data" });
      } else if (day.status === "fallback") {
        bump("warn", "Fallback source");
        banners.push({ id: `fallback-${latestDate}`, level: "warn", message: `${latestDate}: Day built from fallback source ${(day.fallback_sources ?? [day.source]).map(sourceLabel).join(" + ")}.`, details: day.missing_symbols.length ? day.missing_symbols.slice(0, 60) : undefined, link: "/data" });
      } else if (day.status === "recovered") {
        bump("warn", "Recovered");
        banners.push({ id: `recovered-${latestDate}`, level: "warn", message: `${latestDate}: NSE refused the first request(s); recovered after re-warming the session.`, details: day.recovered_events, link: "/data" });
      }
      if (day.suspected_events?.length) {
        banners.push({ id: `suspect-${latestDate}`, level: "warn", message: `${day.suspected_events.length} suspected unadjusted price event(s) on ${latestDate} were excluded. Add them to the split list?`, details: day.suspected_events.map((e) => `${e.symbol}: ${e.hint}`), link: "/data#quality" });
      }
    }
    const u = status.universe;
    if (u) {
      if (u.source && !["nse_index_csv", "universe_history", "previous_version"].includes(u.source)) {
        banners.push({ id: `uni-${u.version}-${u.source}`, level: u.source === "demo" ? "info" : "warn", message: `Universe ${u.version} (${u.age_days} days old) built from ${u.source}.`, link: "/data" });
      }
      if (u.nanocap_stale || (u.nanocap_note ?? "").startsWith("provisional")) {
        bump("warn", "Universe stale");
        banners.push({ id: `nano-${u.version}`, level: "warn", message: u.nanocap_note ?? "Nanocap list is stale", link: "/data" });
      }
      if (u.age_days > 200) banners.push({ id: `uniage-${u.version}`, level: "warn", message: `Universe version ${u.version} is ${u.age_days} days old; run \`python -m mbi universe --refresh\`.` });
    }
    if (status.calendar && status.calendar.source !== "nse" && status.calendar.note) {
      banners.push({ id: `cal-${status.calendar.source}`, level: "info", message: `Holiday calendar: ${status.calendar.note}.` });
    }
  }
  const splits = await readJson<{ issues: { reason: string }[] }>(dataPath("meta", "split_validation.json"));
  if (splits?.issues?.length) {
    warnings.push(...splits.issues.map((i) => `split list: ${i.reason}`));
    banners.push({ id: `splits-${splits.issues.length}`, level: "warn", message: `${splits.issues.length} split-list row(s) were invalid and skipped.`, details: splits.issues.map((i) => i.reason), link: "/data#splits" });
  }
  return { status, latestDate, badge, badgeLabel, banners, warnings, generatedAt: new Date().toISOString() };
}
