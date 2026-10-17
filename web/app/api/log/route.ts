import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { dataPath, readJson, readText } from "@/lib/server";
import type { StatusFile } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const st = await readJson<StatusFile>(dataPath("meta", "data_status.json"));
  let rel = st?.last_run?.log_file ?? null;
  if (!rel) {
    try {
      const files = (await fs.readdir(dataPath("meta", "logs"))).filter((f) => f.endsWith(".log")).sort();
      if (files.length) rel = `meta/logs/${files.at(-1)}`;
    } catch {
      /* no logs yet */
    }
  }
  if (!rel) return NextResponse.json({ file: null, text: "" });
  const full = path.resolve(dataPath(), rel);
  if (!full.startsWith(path.resolve(dataPath()))) return NextResponse.json({ error: "bad path" }, { status: 400 });
  const text = (await readText(full)) ?? "";
  return NextResponse.json({ file: rel, text: text.slice(-60_000) });
}
