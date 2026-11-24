import { NextResponse } from "next/server";
import { dataPath, parseCsv, readJson, readText, runPython } from "@/lib/server";

interface DayRow {
  symbol: string; ema10: number | null; ema20: number | null; ema50: number | null;
  above_ema10: unknown; above_ema20: unknown; above_ema50: unknown; rel_vol: number | null; valid: unknown; reason: string | null;
}
const truthy = (v: unknown) => v === true || v === "True" || v === "true" || v === 1;

/** Breadth inputs for this stock on `date` (the same flags the dashboard counts), if that day's table is built. */
async function snapshot(sym: string, date: string) {
  const text = await readText(dataPath("breadth", "days", date.slice(0, 4), `${date}.csv`));
  if (text == null) return null;
  const row = parseCsv<DayRow>(text).rows.find((x) => x.symbol === sym);
  if (!row) return null;
  return {
    date,
    ema10: row.ema10, ema20: row.ema20, ema50: row.ema50,
    above: { 10: truthy(row.above_ema10), 20: truthy(row.above_ema20), 50: truthy(row.above_ema50) },
    relVol: row.rel_vol, valid: truthy(row.valid), reason: row.reason ?? "",
  };
}

/** Thematic group the stock belongs to, if it is in the themes list. */
async function groupOf(sym: string) {
  const stocks = await readJson<{ stocks: { symbol: string; group: string }[] }>(dataPath("themes", "themes_stocks.json"));
  const name = stocks?.stocks.find((s) => s.symbol === sym)?.group;
  if (!name) return null;
  const latest = await readJson<{ groups: { name: string; slug: string }[] }>(dataPath("themes", "themes_latest.json"));
  const slug = latest?.groups.find((g) => g.name === name)?.slug;
  return slug ? { name, slug } : null;
}

export const dynamic = "force-dynamic";

interface Row {
  date: string; bucket: string;
  adj_open: number | null; adj_high: number | null; adj_low: number | null; adj_close: number | null; adj_volume: number | null;
  adj_factor: number | null;
}

// split-adjusted prices carry float noise; round to paise
const px = (v: number) => Math.round(v * 100) / 100;

// export-stock loads the whole price archive (~1 s), so keep recent answers briefly
const cache = new Map<string, { at: number; body: unknown }>();
const TTL_MS = 5 * 60_000;

/** Split-adjusted daily bars for one symbol, shaped for trading-chart-react. */
export async function GET(_req: Request, { params }: { params: { symbol: string } }) {
  const sym = decodeURIComponent(params.symbol).toUpperCase();
  if (!/^[A-Z0-9&\-_.]{1,30}$/.test(sym)) return NextResponse.json({ error: "bad symbol" }, { status: 400 });

  const hit = cache.get(sym);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.body);

  const py = await runPython(["export-stock", sym, "--adjusted"], 120_000);
  if (py.code !== 0) return NextResponse.json({ error: py.error ?? `no archived data for ${sym}` }, { status: 404 });
  const { rows } = parseCsv<Row>(py.stdout);

  const bars: { time: number; open: number; high: number; low: number; close: number; volume: number }[] = [];
  const events: { time: number; type: "split"; label: string }[] = [];
  let prevFactor: number | null = null;
  for (const r of rows) {
    const { adj_open: o, adj_high: h, adj_low: l, adj_close: c } = r;
    if (!r.date || o == null || h == null || l == null || c == null) continue;
    const time = Math.floor(Date.parse(`${r.date.slice(0, 10)}T00:00:00Z`) / 1000);
    bars.push({ time, open: px(o), high: px(h), low: px(l), close: px(c), volume: Math.round(r.adj_volume ?? 0) });
    // the adjustment factor steps at a split's ex-date
    if (prevFactor != null && r.adj_factor != null && Math.abs(r.adj_factor - prevFactor) > 1e-9) {
      events.push({ time, type: "split", label: `Split adj. ×${(prevFactor / r.adj_factor).toFixed(2)}` });
    }
    prevFactor = r.adj_factor;
  }
  if (!bars.length) return NextResponse.json({ error: `no usable bars for ${sym}` }, { status: 404 });

  const lastDate = String(rows.at(-1)?.date ?? "").slice(0, 10);
  const [snap, group] = await Promise.all([snapshot(sym, lastDate), groupOf(sym)]);
  const body = { symbol: sym, bucket: rows.at(-1)?.bucket ?? null, bars, events, snapshot: snap, group };
  cache.set(sym, { at: Date.now(), body });
  return NextResponse.json(body);
}
