"use client";

import { useEffect, useState } from "react";
import type { Quadrant } from "@/lib/themes";
import { QUAD_COLOR } from "@/lib/themes";
import { cn } from "@/lib/utils";
import type { GlossaryKey } from "@/lib/glossary";
import { InfoTip } from "@/components/ui/info";

/** Fetches one /api/themes/<kind> dataset; reloads when `version` changes (after a refresh job). */
export function useThemeData<T>(kind: string, version: number): { data: T | null; error: string | null; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    setLoading(true);
    fetch(`/api/themes/${kind}`, { cache: "no-store" })
      .then(async (r) => {
        const b = await r.json();
        if (!live) return;
        if (!r.ok) { setError(b.error ?? `HTTP ${r.status}`); setData(null); } else { setData(b as T); setError(null); }
      })
      .catch((e) => live && setError(String(e)))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [kind, version]);
  return { data, error, loading };
}

export function Ret({ v, digits = 1, className }: { v: number | null | undefined; digits?: number; className?: string }) {
  if (v == null) return <span className={cn("text-muted", className)}>–</span>;
  const color = v > 0 ? "var(--good-text)" : v < 0 ? "var(--critical)" : undefined;
  return <span className={cn("tabular", className)} style={{ color }}>{v > 0 ? "+" : v < 0 ? "−" : ""}{Math.abs(v).toFixed(digits)}%</span>;
}

export function QuadBadge({ q }: { q: Quadrant | string | null }) {
  if (!q) return <span className="text-muted">–</span>;
  const c = QUAD_COLOR[q as Quadrant] ?? "#898781";
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium" style={{ background: `${c}22`, color: c }}>
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: c }} />{q}
    </span>
  );
}

export function RoleBadge({ role }: { role: string }) {
  if (!role) return null;
  const map: Record<string, string> = { leader: "#008300", laggard: "#e34948", new: "#898781" };
  const c = map[role] ?? "#898781";
  return <span className="rounded px-1.5 py-0.5 text-[11px] font-medium" style={{ background: `${c}22`, color: c }}>{role}</span>;
}

export function ScoreBar({ v }: { v: number | null }) {
  if (v == null) return <span className="text-muted">–</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="relative h-1.5 w-14 overflow-hidden rounded bg-surface-2"><span className="absolute inset-y-0 left-0 rounded" style={{ width: `${v}%`, background: "#2a78d6" }} /></span>
      <span className="tabular w-8 text-right text-xs font-semibold">{v.toFixed(0)}</span>
    </span>
  );
}

export function Spark({ values, w = 70, h = 20 }: { values: (number | null)[]; w?: number; h?: number }) {
  const v = values.filter((x): x is number => x != null);
  if (v.length < 2) return <span className="inline-block" style={{ width: w, height: h }} />;
  const min = Math.min(...v), max = Math.max(...v);
  const pts = values.map((x, i) => (x == null ? null : `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((x - min) / (max - min || 1)) * (h - 4)).toFixed(1)}`)).filter(Boolean).join(" ");
  const up = v[v.length - 1] >= v[0];
  return (
    <svg width={w} height={h} aria-hidden className="inline-block align-middle">
      <polyline points={pts} fill="none" stroke={up ? "#0ca30c" : "#d03b3b"} strokeWidth={1.4} />
    </svg>
  );
}

export function Delta({ v, digits = 0 }: { v: number | null | undefined; digits?: number }) {
  if (v == null || Math.abs(v) < 0.5 * 10 ** -digits) return <span className="text-muted">·</span>;
  return <span className="tabular text-[11px]" style={{ color: v > 0 ? "var(--good-text)" : "var(--critical)" }}>{v > 0 ? "▲" : "▼"}{Math.abs(v).toFixed(digits)}</span>;
}

export function Th({ children, onClick, active, dir, right, title, info }: { children: React.ReactNode; onClick?: () => void; active?: boolean; dir?: 1 | -1; right?: boolean; title?: string; info?: GlossaryKey }) {
  return (
    <th title={title} onClick={onClick} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined} aria-sort={active ? (dir === 1 ? "ascending" : "descending") : "none"}
      className={cn("whitespace-nowrap py-1.5 pr-3 font-medium", onClick && "cursor-pointer select-none hover:text-ink", right && "text-right")}>
      <span className={cn("inline-flex items-center gap-1", right && "flex-row-reverse")}>
        <span>{children}{active ? (dir === 1 ? " ↑" : " ↓") : ""}</span>
        {info ? <InfoTip k={info} /> : null}
      </span>
    </th>
  );
}

/** Diverging red-neutral-green (or sequential blue) tile colour + readable label colour. */
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number) => {
  const x = hex(a), y = hex(b);
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(",")})`;
};
export function heatColor(v: number, lim: number, dark: boolean, mode: "div" | "seq" = "div"): { bg: string; fg: string } {
  if (mode === "seq") {
    const t = Math.min(Math.max(v / lim, 0), 1);
    const bg = dark ? mix("#262624", "#3987e5", t) : mix("#e8f0fb", "#184f95", t);
    return { bg, fg: t > 0.55 ? "#ffffff" : dark ? "#f0efec" : "#0b0b0b" };
  }
  const t = Math.min(Math.abs(v) / lim, 1);
  const neutral = dark ? "#2f2f2c" : "#ebeae4";
  const end = v >= 0 ? (dark ? "#1f9d3a" : "#0ca30c") : (dark ? "#c24444" : "#d03b3b");
  return { bg: mix(neutral, end, t), fg: t > 0.5 ? "#ffffff" : dark ? "#f0efec" : "#0b0b0b" };
}

export const groupHref = (slug: string) => `/themes/${slug}`;
