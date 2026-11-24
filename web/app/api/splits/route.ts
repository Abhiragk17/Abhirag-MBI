import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { dataPath, readJson } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const validation = await readJson(dataPath("meta", "split_validation.json"));
  const list = await readJson(dataPath("config", "split_adjustments.json"));
  return NextResponse.json({ validation, list });
}

/** Append one split to split_adjustments.json. The caller then recomputes to apply it. */
export async function POST(req: Request) {
  let body: { symbol?: unknown; ex_date?: unknown; factor?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const symbol = String(body.symbol ?? "").trim().toUpperCase();
  const exDate = String(body.ex_date ?? "").trim();
  const factor = Number(body.factor);
  if (!/^[A-Z0-9&\-_.]{1,30}$/.test(symbol)) return NextResponse.json({ error: "bad symbol" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exDate) || Number.isNaN(Date.parse(`${exDate}T00:00:00Z`))) {
    return NextResponse.json({ error: "ex_date must be YYYY-MM-DD" }, { status: 400 });
  }
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) {
    return NextResponse.json({ error: "factor must be a positive number other than 1" }, { status: 400 });
  }

  const file = dataPath("config", "split_adjustments.json");
  const list = (await readJson<Record<string, unknown>[]>(file)) ?? [];
  if (!Array.isArray(list)) return NextResponse.json({ error: "split_adjustments.json is not a list" }, { status: 500 });
  if (list.some((r) => String(r.symbol).toUpperCase() === symbol && r.ex_date === exDate)) {
    return NextResponse.json({ error: `${symbol} on ${exDate} is already in the split list` }, { status: 409 });
  }
  list.push({ symbol, ex_date: exDate, factor, type: "split" });
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(list, null, 2), "utf-8");
  await fs.rename(tmp, file);
  return NextResponse.json({ ok: true, count: list.length });
}
