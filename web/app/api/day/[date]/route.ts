import { NextResponse } from "next/server";
import { dataPath, parseCsv, readJson, readText, runPython } from "@/lib/server";
import type { StatusFile, StockRow } from "@/lib/types";

export const dynamic = "force-dynamic";

const toBool = (v: unknown) => v === true || v === "True" || v === "true" || v === 1;

export async function GET(_req: Request, { params }: { params: { date: string } }) {
  const date = params.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "bad date" }, { status: 400 });
  const file = dataPath("breadth", "days", date.slice(0, 4), `${date}.csv`);
  let text = await readText(file);
  let note: string | null = null;
  if (text == null) {
    const py = await runPython(["day-detail", "--date", date], 120_000);
    if (py.code !== 0) {
      return NextResponse.json({
        date, rows: [], status: null,
        error: py.error ?? (py.stderr.trim().split("\n").at(-1) || "no archived data for this date"),
      });
    }
    note = "computed on demand from the archive";
    text = await readText(file);
  }
  const { rows } = parseCsv<Record<string, unknown>>(text ?? "");
  const out: StockRow[] = rows.map((r) => ({
    ...(r as unknown as StockRow),
    symbol: String(r.symbol),
    above_ema10: toBool(r.above_ema10),
    above_ema20: toBool(r.above_ema20),
    above_ema50: toBool(r.above_ema50),
    valid: toBool(r.valid),
    reason: r.reason == null ? "" : String(r.reason),
  }));
  const st = await readJson<StatusFile>(dataPath("meta", "data_status.json"));
  return NextResponse.json({ date, rows: out, status: st?.days?.[date] ?? null, note });
}
