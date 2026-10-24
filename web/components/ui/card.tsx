import * as React from "react";
import { cn } from "@/lib/utils";
import type { GlossaryKey } from "@/lib/glossary";
import { InfoTip } from "./info";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-line bg-surface", className)} {...props} />;
}

export function CardHeader({
  title, subtitle, actions, info, className,
}: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; info?: GlossaryKey; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-2 px-4 pt-3", className)}>
      <div className="min-w-0">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">{title}{info ? <InfoTip k={info} /> : null}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-ink-2">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 pb-4 pt-2", className)} {...props} />;
}

export function EmptyState({ title, reason, className }: { title: string; reason?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-[120px] flex-col items-center justify-center rounded-md border border-dashed border-line px-4 py-6 text-center", className)}>
      <p className="text-sm font-medium text-ink-2">{title}</p>
      {reason ? <p className="mt-1 max-w-md text-xs text-muted">{reason}</p> : null}
    </div>
  );
}
