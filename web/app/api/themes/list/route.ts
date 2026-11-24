import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { dataPath, readText, REPO_ROOT } from "@/lib/server";

export const dynamic = "force-dynamic";
const CUSTOM = () => dataPath("config", "themes.txt");
const BUNDLED = () => path.join(REPO_ROOT, "Indian_Micro_Sector_Themes.txt");

/** One group per line for editing: ###NAME,NSE:A,NSE:B */
const pretty = (t: string) => t.split("###").map((b) => b.trim().replace(/,+$/, "")).filter(Boolean).map((b) => `###${b.replace(/\s*\n\s*/g, "")}`).join("\n");

export async function GET() {
  const custom = await readText(CUSTOM());
  const text = custom ?? (await readText(BUNDLED())) ?? "";
  return NextResponse.json({ text: pretty(text), custom: custom != null });
}

export async function PUT(req: Request) {
  let body: { text?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const text = typeof body.text === "string" ? body.text : "";
  const groups = text.split("###").map((b) => b.trim()).filter(Boolean);
  if (!groups.length || !groups.every((g) => /NSE:/i.test(g))) {
    return NextResponse.json({ error: "every group needs a name and at least one NSE:SYMBOL" }, { status: 400 });
  }
  await fs.mkdir(path.dirname(CUSTOM()), { recursive: true });
  const tmp = `${CUSTOM()}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, text, "utf-8");
  await fs.rename(tmp, CUSTOM());
  return NextResponse.json({ ok: true, groups: groups.length });
}

/** Go back to the list shipped with the repo. */
export async function DELETE() {
  await fs.rm(CUSTOM(), { force: true });
  return NextResponse.json({ ok: true });
}
