import { NextResponse } from "next/server";
import { dataPath, readJson } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const validation = await readJson(dataPath("meta", "split_validation.json"));
  const list = await readJson(dataPath("config", "split_adjustments.json"));
  return NextResponse.json({ validation, list });
}
