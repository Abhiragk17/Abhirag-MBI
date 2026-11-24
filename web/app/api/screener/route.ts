import { dataPath, readText } from "@/lib/server";

export const dynamic = "force-dynamic";

/** The pre-computed screener table (columnar JSON written by `python -m mbi screener`). */
export async function GET() {
  const text = await readText(dataPath("screener", "screener_latest.json"));
  if (text == null) {
    return Response.json({ error: "No screener data yet. Run `python -m mbi screener` or press Build data." }, { status: 404 });
  }
  return new Response(text, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
