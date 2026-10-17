"use client";

import { useState } from "react";
import { STATE_META } from "@/lib/states";
import type { StateCode } from "@/lib/types";
import { cn } from "@/lib/utils";

/** A state chip: colour + icon + letter code + name, never colour alone. The info
 * button opens an "explain" popover with the values and the rule that fired. */
export function StateBadge({
  state, explainText, size = "md", showName = true, className,
}: { state: StateCode | null | undefined; explainText?: string; size?: "sm" | "md" | "lg"; showName?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  if (!state) {
    return <span className={cn("inline-flex items-center rounded border border-dashed border-line px-2 py-0.5 text-xs text-muted", className)}>no state</span>;
  }
  const m = STATE_META[state];
  const pad = size === "lg" ? "px-3 py-1.5 text-base" : size === "sm" ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-1 text-sm";
  return (
    <span className={cn("relative inline-flex items-center", className)}>
      <span
        className={cn("inline-flex items-center gap-1.5 rounded-md font-semibold text-white", pad)}
        style={{ background: m.color }}
        title={explainText ? `${m.name}\n${explainText}` : m.name}
      >
        <span aria-hidden>{m.icon}</span>
        <span className="tabular">{state}</span>
        {showName ? <span className="font-medium">· {m.short}</span> : null}
      </span>
      {explainText ? (
        <>
          <button
            type="button"
            aria-label="Explain this state"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-line text-[10px] text-ink-2 hover:bg-surface-2"
          >
            ?
          </button>
          {open ? (
            <span
              role="dialog"
              className="absolute left-0 top-full z-30 mt-1 w-72 rounded-md border border-line bg-surface p-3 text-xs font-normal text-ink shadow-lg"
              onClick={() => setOpen(false)}
            >
              <span className="mb-1 block font-semibold">{m.name}</span>
              <span className="block text-ink-2">{explainText}</span>
            </span>
          ) : null}
        </>
      ) : null}
    </span>
  );
}
