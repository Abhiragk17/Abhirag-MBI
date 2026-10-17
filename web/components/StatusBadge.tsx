import Link from "next/link";

const STYLE = {
  ok: { color: "var(--good)", icon: "●" },
  warn: { color: "var(--warning)", icon: "▲" },
  partial: { color: "var(--serious)", icon: "◐" },
  error: { color: "var(--critical)", icon: "■" },
} as const;

/** green = ok, yellow = recovered/fallback, orange = partial, red = failed/stale.
 * Icon + label always accompany the colour. */
export function StatusBadge({ level, label }: { level: keyof typeof STYLE; label: string }) {
  const s = STYLE[level];
  return (
    <Link
      href="/data"
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2 py-0.5 text-xs font-medium text-ink hover:bg-surface-2"
      title="Data status - open Data & Quality"
    >
      <span aria-hidden style={{ color: s.color }}>{s.icon}</span>
      {label}
    </Link>
  );
}
