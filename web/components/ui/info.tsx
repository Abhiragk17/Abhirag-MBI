"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GLOSSARY, type GlossaryKey } from "@/lib/glossary";
import { cn } from "@/lib/utils";

const W = 300;

/** Small "i" that shows a glossary entry on hover, focus or tap. The popover is portalled
 * to <body> with fixed positioning so cards with overflow never clip it.
 * Pass focusable={false} when nested inside another interactive element (e.g. a tile button). */
export function InfoTip({ k, focusable = true, className }: { k: GlossaryKey; focusable?: boolean; className?: string }) {
  const entry = GLOSSARY[k];
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean } | null>(null);

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const x = Math.min(Math.max(8, r.left + r.width / 2 - W / 2), window.innerWidth - W - 8);
    const above = r.bottom + 200 > window.innerHeight && r.top > 200;
    setPos({ x, y: above ? r.top - 6 : r.bottom + 6, above });
  };
  const hide = () => setPos(null);

  return (
    <>
      <span
        ref={ref}
        role={focusable ? "button" : undefined}
        tabIndex={focusable ? 0 : undefined}
        aria-label={`About: ${entry.title}`}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(e) => e.key === "Escape" && hide()}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (pos) hide(); else show();
        }}
        className={cn(
          "inline-flex h-3.5 w-3.5 shrink-0 cursor-help select-none items-center justify-center rounded-full border border-current align-middle font-serif text-[9px] font-bold italic leading-none text-muted transition-colors hover:text-ink focus-visible:text-ink focus-visible:outline-none",
          className,
        )}
      >
        i
      </span>
      {pos
        ? createPortal(
            <div
              role="tooltip"
              style={{ position: "fixed", left: pos.x, top: pos.y, width: W, transform: pos.above ? "translateY(-100%)" : undefined }}
              className="pointer-events-none z-[100] rounded-md border border-line bg-surface p-3 text-left text-xs font-normal normal-case tracking-normal text-ink shadow-lg"
            >
              <div className="mb-1 text-[13px] font-semibold">{entry.title}</div>
              <p className="text-ink-2">{entry.what}</p>
              {"read" in entry && entry.read ? (
                <p className="mt-2"><span className="font-semibold">How to read: </span><span className="text-ink-2">{entry.read}</span></p>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** A label followed by its info tip, kept on one line. */
export function WithInfo({ k, children, focusable, className }: { k: GlossaryKey; children: React.ReactNode; focusable?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {children}
      <InfoTip k={k} focusable={focusable} />
    </span>
  );
}
