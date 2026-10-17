export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return "–";
  return v.toFixed(digits);
}
export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v)) return "–";
  return `${v.toFixed(digits)}%`;
}
export function fmtDelta(v: number | null | undefined, digits = 1, suffix = ""): string {
  if (v == null || Number.isNaN(v)) return "";
  const s = v > 0 ? "+" : v < 0 ? "−" : "±";
  return `${s}${Math.abs(v).toFixed(digits)}${suffix}`;
}
export function fmtInt(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "–";
  return Math.round(v).toLocaleString("en-IN");
}
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}
export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (!rows.length) return "";
  const cols = columns ?? Object.keys(rows[0]);
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[], columns?: string[]) {
  const blob = new Blob([toCsv(rows, columns)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
