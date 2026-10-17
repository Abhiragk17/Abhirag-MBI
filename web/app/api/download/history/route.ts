import { dataPath, readText } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const text = await readText(dataPath("breadth", "breadth_history.csv"));
  if (text == null) return new Response("breadth_history.csv not found", { status: 404 });
  return new Response(text, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="breadth_history.csv"',
    },
  });
}
