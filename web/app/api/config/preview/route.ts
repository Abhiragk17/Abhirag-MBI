import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runPython } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.config) return NextResponse.json({ error: "missing config" }, { status: 400 });
  const tmp = path.join(os.tmpdir(), `mbi-preview-${Date.now()}.json`);
  await fs.writeFile(tmp, JSON.stringify(body.config), "utf-8");
  try {
    const py = await runPython(["classify-preview", "--config", tmp], 60_000);
    if (py.code !== 0) {
      return NextResponse.json({ error: py.error ?? py.stderr.trim().split("\n").at(-1) }, { status: 500 });
    }
    return NextResponse.json(JSON.parse(py.stdout));
  } finally {
    fs.unlink(tmp).catch(() => undefined);
  }
}
