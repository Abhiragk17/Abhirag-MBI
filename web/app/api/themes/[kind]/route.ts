import { NextResponse } from "next/server";
import { dataPath, readJson } from "@/lib/server";

export const dynamic = "force-dynamic";

const FILES: Record<string, string> = {
  latest: "themes_latest.json", rrg: "themes_rrg.json", stocks: "themes_stocks.json",
  regime: "themes_regime.json", corr: "themes_corr.json", digest: "themes_digest.json",
};

export async function GET(_req: Request, { params }: { params: { kind: string } }) {
  const file = FILES[params.kind];
  if (!file) return NextResponse.json({ error: "unknown dataset" }, { status: 404 });
  const data = await readJson<unknown>(dataPath("themes", file));
  if (data == null) return NextResponse.json({ error: "not computed yet: run `python -m mbi themes`" }, { status: 404 });
  return NextResponse.json(data);
}
