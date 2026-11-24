import { dataPath, readText } from "@/lib/server";

export const dynamic = "force-dynamic";

const FILES: Record<string, { file: string; type: string; download: string }> = {
  watchlist: { file: "watchlist_leaders.txt", type: "text/plain", download: "theme_leaders_watchlist.txt" },
  digest: { file: "themes_digest.md", type: "text/markdown", download: "theme_digest.md" },
  "digest-json": { file: "themes_digest.json", type: "application/json", download: "theme_digest.json" },
};

export async function GET(_req: Request, { params }: { params: { name: string } }) {
  const f = FILES[params.name];
  if (!f) return new Response("unknown export", { status: 404 });
  const text = await readText(dataPath("themes", f.file));
  if (text == null) return new Response("not computed yet: run `python -m mbi themes`", { status: 404 });
  return new Response(text, { headers: { "Content-Type": `${f.type}; charset=utf-8`, "Content-Disposition": `attachment; filename="${f.download}"` } });
}
