"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Banner } from "@/lib/types";

const LEVEL = {
  info: { bar: "var(--muted)", icon: "ℹ", label: "Info" },
  warn: { bar: "var(--warning)", icon: "▲", label: "Warning" },
  partial: { bar: "var(--serious)", icon: "◐", label: "Partial" },
  error: { bar: "var(--critical)", icon: "■", label: "Error" },
} as const;

export function StatusBanner({ banners }: { banners: Banner[] }) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    try {
      setDismissed(JSON.parse(sessionStorage.getItem("mbi.dismissed") ?? "[]"));
    } catch { /* storage unavailable */ }
  }, []);
  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    try { sessionStorage.setItem("mbi.dismissed", JSON.stringify(next)); } catch { /* storage unavailable */ }
  };
  const visible = banners.filter((b) => !dismissed.includes(b.id));
  if (!visible.length) return null;
  return (
    <div className="mx-auto mt-3 flex max-w-[1500px] flex-col gap-2 px-4" role="status">
      {visible.map((b) => {
        const l = LEVEL[b.level];
        return (
          <div key={b.id} className="flex items-start gap-3 rounded-md border border-line bg-surface px-3 py-2 text-sm" style={{ borderLeft: `4px solid ${l.bar}` }}>
            <span aria-hidden style={{ color: l.bar }} className="mt-0.5">{l.icon}</span>
            <div className="min-w-0 flex-1">
              <span className="sr-only">{l.label}: </span>
              <span>{b.message}</span>
              {b.details?.length ? (
                <button className="ml-2 text-xs text-ink-2 underline" onClick={() => setExpanded(expanded === b.id ? null : b.id)}>
                  {expanded === b.id ? "hide details" : `details (${b.details.length})`}
                </button>
              ) : null}
              {b.link ? <Link href={b.link} className="ml-2 text-xs text-ink-2 underline">{b.link.includes("log") ? "View log" : "Open data page"}</Link> : null}
              {expanded === b.id && b.details ? (
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-2 font-mono text-xs text-ink-2">{b.details.join("\n")}</pre>
              ) : null}
            </div>
            <button aria-label="Dismiss" className="text-ink-2 hover:text-ink" onClick={() => dismiss(b.id)}>✕</button>
          </div>
        );
      })}
    </div>
  );
}
