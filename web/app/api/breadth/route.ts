import { NextResponse } from "next/server";
import { loadHistory } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await loadHistory());
  } catch (e) {
    return NextResponse.json({ rows: [], source: "none", warnings: [`failed to read history: ${String(e)}`] });
  }
}
