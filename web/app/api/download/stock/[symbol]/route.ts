import { runPython } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { symbol: string } }) {
  const sym = decodeURIComponent(params.symbol).toUpperCase();
  if (!/^[A-Z0-9&\-_.]{1,30}$/.test(sym)) return new Response("bad symbol", { status: 400 });
  const adjusted = new URL(req.url).searchParams.get("adjusted") === "1";
  const py = await runPython(["export-stock", sym, ...(adjusted ? ["--adjusted"] : [])], 120_000);
  if (py.code !== 0) return new Response(py.error ?? `no archived data for ${sym}`, { status: 404 });
  return new Response(py.stdout, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${sym}${adjusted ? "_adjusted" : ""}_ohlcv.csv"`,
    },
  });
}
