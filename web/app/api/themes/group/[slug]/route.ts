import { NextResponse } from "next/server";
import { dataPath, readJson } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  if (!/^[a-z0-9-]+$/.test(params.slug)) return NextResponse.json({ error: "bad group" }, { status: 400 });
  const data = await readJson<unknown>(dataPath("themes", "groups", `${params.slug}.json`));
  if (data == null) return NextResponse.json({ error: "group not found" }, { status: 404 });
  return NextResponse.json(data);
}
