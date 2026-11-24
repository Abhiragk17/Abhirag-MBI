import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { dataPath, runPython } from "@/lib/server";

export const dynamic = "force-dynamic";
const FILE = () => dataPath("config", "theme_config.json");

async function printConfig(defaults: boolean) {
  const py = await runPython(defaults ? ["print-theme-config", "--defaults"] : ["print-theme-config"], 60_000);
  if (py.code !== 0) return null;
  try { return JSON.parse(py.stdout); } catch { return null; }
}

/** The effective (validated, defaults-filled) config plus the shipped defaults. */
export async function GET() {
  const [config, defaults] = await Promise.all([printConfig(false), printConfig(true)]);
  if (!config || !defaults) return NextResponse.json({ error: "could not read the theme config (is python available?)" }, { status: 500 });
  return NextResponse.json({ config, defaults });
}

export async function PUT(req: Request) {
  let body: { config?: Record<string, unknown> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const cfg = body.config;
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return NextResponse.json({ error: "config must be an object" }, { status: 400 });
  const file = FILE();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(cfg, null, 2), "utf-8");
  await fs.rename(tmp, file);
  // python clamps out-of-range values on read; return what will actually be used
  const effective = await printConfig(false);
  return NextResponse.json({ ok: true, config: effective });
}
