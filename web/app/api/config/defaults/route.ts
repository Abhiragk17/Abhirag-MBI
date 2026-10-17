import { NextResponse } from "next/server";
import { runPython } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Defaults come from python's DEFAULT_CONFIG (single source of truth). */
export async function GET() {
  const py = await runPython(["print-config", "--defaults"], 60_000);
  if (py.code !== 0) return NextResponse.json({ error: py.error ?? py.stderr }, { status: 500 });
  return NextResponse.json({ config: JSON.parse(py.stdout) });
}
