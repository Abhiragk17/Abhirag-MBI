"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ScreenField } from "@/lib/screener";
import { cn } from "@/lib/utils";

/** Searchable, grouped field list (211 fields are too many for a plain <select>). */
export function FieldPicker({ fields, value, onChange, label, className, placeholder = "Choose a field" }: {
  fields: ScreenField[]; value: string | null; onChange: (key: string) => void; label: string; className?: string; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const current = fields.find((f) => f.key === value);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const groups = useMemo(() => {
    const t = q.trim().toLowerCase();
    const hit = fields.filter((f) => !t || f.label.toLowerCase().includes(t) || f.key.toLowerCase().includes(t) || f.group.toLowerCase().includes(t));
    const by = new Map<string, ScreenField[]>();
    hit.forEach((f) => by.set(f.group, [...(by.get(f.group) ?? []), f]));
    return Array.from(by.entries());
  }, [fields, q]);

  const pick = (k: string) => { onChange(k); setOpen(false); setQ(""); };

  return (
    <div ref={root} className={cn("relative", className)}>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={label} title={current?.desc}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-full items-center justify-between gap-2 rounded-md border border-line bg-surface px-2 text-left text-xs hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <span className="truncate">{current ? current.label : <span className="text-muted">{placeholder}</span>}</span>
        <span aria-hidden className="text-muted">▾</span>
      </button>
      {open ? (
        <div className="absolute left-0 top-9 z-50 w-[22rem] max-w-[90vw] rounded-md border border-line bg-surface shadow-lg">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search fields (e.g. RSI, 52W, SMA 200)…"
            aria-label="Search fields"
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "Enter" && groups[0]?.[1][0]) pick(groups[0][1][0].key);
            }}
            className="w-full rounded-t-md border-b border-line bg-surface px-2.5 py-2 text-xs outline-none" />
          <div role="listbox" aria-label={label} className="max-h-72 overflow-auto py-1">
            {groups.length === 0 ? <p className="px-3 py-3 text-xs text-muted">No field matches “{q}”.</p> : groups.map(([g, fs]) => (
              <div key={g}>
                <div className="sticky top-0 bg-surface-2 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-2">{g}</div>
                {fs.map((f) => (
                  <button key={f.key} role="option" aria-selected={f.key === value} type="button" onClick={() => pick(f.key)} title={f.desc}
                    className={cn("flex w-full items-center justify-between gap-2 px-3 py-1 text-left text-xs hover:bg-surface-2", f.key === value && "font-semibold")}>
                    <span className="truncate">{f.label}</span>
                    <span className="shrink-0 text-[10px] text-muted">{f.unit}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
