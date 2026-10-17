import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { dataPath, readJson, runPython } from "@/lib/server";

export const dynamic = "force-dynamic";
const FILE = () => dataPath("config", "regime_config.json");

export async function GET() {
  let cfg = await readJson<Record<string, unknown>>(FILE());
  if (!cfg) {
    await runPython(["print-config"], 60_000); // writes the defaults
    cfg = await readJson<Record<string, unknown>>(FILE());
  }
  return NextResponse.json({ config: cfg });
}

export async function PUT(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const cfg = body.config as Record<string, unknown> | undefined;
  if (!cfg || typeof cfg !== "object" || !cfg.p_zones || !cfg.vr_zones || !cfg.table) {
    return NextResponse.json({ error: "config must include p_zones, vr_zones and table" }, { status: 400 });
  }
  const file = FILE();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(cfg, null, 2), "utf-8");
  await fs.rename(tmp, file);
  return NextResponse.json({ ok: true });
}
