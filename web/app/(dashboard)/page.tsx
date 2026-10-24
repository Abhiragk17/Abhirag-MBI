"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Button, Segmented } from "@/components/ui/button";
import { MarketStateCard } from "@/components/MarketStateCard";
import { StateStats } from "@/components/StateStats";
import { DateRange } from "@/components/DateRange";
import { CompareDays } from "@/components/CompareDays";
import { KpiTile } from "@/components/charts/KpiTile";
import { BucketToggles, VolumeRatioChart } from "@/components/charts/VolumeRatioChart";
import { InfoTip, WithInfo } from "@/components/ui/info";
import { EmaBreadthChart } from "@/components/charts/EmaBreadthChart";
import { SmallMultiples } from "@/components/charts/SmallMultiples";
import { Heatmap } from "@/components/charts/Heatmap";
import { StateTimeline } from "@/components/charts/StateTimeline";
import { StateMap } from "@/components/charts/StateMap";
import { chartTokens, ZoomState } from "@/components/charts/EChart";
import { BUCKET_LABEL } from "@/lib/states";
import { bucketSeries, filterRange, indexRows, RangeKey } from "@/lib/series";
import { downloadCsv } from "@/lib/format";
import type { BreadthResponse, Bucket, HistoryRow, RegimeConfig } from "@/lib/types";
import { ALL_BUCKETS } from "@/lib/types";

const BucketPicker = ({ value, onChange }: { value: Bucket; onChange: (b: Bucket) => void }) => (
  <select
    aria-label="Bucket"
    value={value}
    onChange={(e) => onChange(e.target.value as Bucket)}
    className="h-8 rounded-md border border-line bg-surface px-2 text-xs"
  >
    {ALL_BUCKETS.map((b) => <option key={b} value={b}>{BUCKET_LABEL[b]}</option>)}
  </select>
);

export default function Dashboard() {
  const { ema, dataVersion, dark } = useApp();
  const [data, setData] = useState<BreadthResponse | null>(null);
  const [cfg, setCfg] = useState<RegimeConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("6M");
  const [zoom, setZoomState] = useState<ZoomState | null>(null);
  const [bucket, setBucket] = useState<Bucket>("ALL");
  const [raw, setRaw] = useState(false);
  const [log, setLog] = useState(true);
  const [emaView, setEmaView] = useState<"single" | "multiples">("single");
  const [heatMetric, setHeatMetric] = useState<"pct" | "vr">("pct");
  const [vrBuckets, setVrBucketsState] = useState<Bucket[]>(["ALL"]);

  // per-viewer convenience: remember which buckets the volume chart draws
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem("mbi.vrBuckets") ?? "null");
      if (Array.isArray(v)) setVrBucketsState(ALL_BUCKETS.filter((b) => v.includes(b)));
    } catch { /* storage unavailable */ }
  }, []);
  const setVrBuckets = useCallback((v: Bucket[]) => {
    setVrBucketsState(v);
    try { localStorage.setItem("mbi.vrBuckets", JSON.stringify(v)); } catch { /* storage unavailable */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/breadth", { cache: "no-store" }).then((r) => r.json() as Promise<BreadthResponse>),
      fetch("/api/config", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ config: null })),
    ])
      .then(([b, c]) => {
        if (cancelled) return;
        setData(b);
        setCfg(c.config ?? null);
        setError(null);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [dataVersion]);

  const setZoom = useCallback((z: ZoomState | null) => setZoomState(z), []);
  useEffect(() => setZoomState(null), [range]);

  const all = useMemo(() => data?.rows ?? [], [data]);
  const rows = useMemo(() => filterRange(all, range), [all, range]);
  const { dates } = useMemo(() => indexRows(rows), [rows]);
  const latest = useMemo(() => {
    const { by, dates: d } = indexRows(all);
    return d.length ? by[d.at(-1)!] ?? {} : {};
  }, [all]);
  const t = useMemo(() => chartTokens(dark), [dark]);
  const zoomedRows = useCallback((rs: HistoryRow[]) => (zoom ? rs.filter((r) => r.date >= zoom.start && r.date <= zoom.end) : rs), [zoom]);

  if (error) return <EmptyState title="Could not load breadth history" reason={error} />;
  if (!data) return <div className="h-64 animate-pulse rounded-lg bg-surface-2" />;
  if (!all.length) {
    return (
      <EmptyState
        title="No breadth history yet"
        reason={
          <>
            {data.warnings.join("; ") || "breadth_history.csv has no rows."} Run <code>python -m mbi backfill --from 2025-01-01</code> (real NSE data)
            or <code>python -m mbi demo</code> (synthetic data), then press Refresh.
          </>
        }
        className="min-h-[300px]"
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <MarketStateCard latest={latest} bucket={bucket} ema={ema} raw={raw} setRaw={setRaw} cfg={cfg} />

      <div className="-mb-2 flex items-center gap-1.5 text-xs text-ink-2">
        <WithInfo k="buckets">Buckets · click a tile to select it</WithInfo>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {ALL_BUCKETS.map((b) => (
          <KpiTile key={b} bucket={b} series={bucketSeries(all, b)} ema={ema} selected={b === bucket} onSelect={() => setBucket(b)} dark={dark} />
        ))}
      </div>

      <div className="sticky top-[52px] z-30 -mx-4 flex flex-wrap items-center gap-3 border-y border-line bg-page/95 px-4 py-2 backdrop-blur">
        <DateRange value={range} onChange={setRange} />
        <InfoTip k="range" />
        <WithInfo k="bucket_picker" className="text-xs text-ink-2">Bucket for single-bucket charts</WithInfo>
        <BucketPicker value={bucket} onChange={setBucket} />
        <span className="text-xs text-ink-2 tabular">
          {zoom ? `Zoom ${zoom.start} → ${zoom.end}` : `${dates[0] ?? ""} → ${dates.at(-1) ?? ""}`} · {dates.length} sessions
        </span>
        {zoom ? <Button size="sm" variant="ghost" onClick={() => setZoom(null)}>Reset zoom</Button> : null}
        <span className="ml-auto text-xs text-muted">Drag or scroll on any chart to zoom; all charts follow.</span>
      </div>

      <Card>
        <CardHeader
          title="Volume ratio"
          info="vr_chart"
          subtitle="Stocks on heavy volume ÷ stocks on light volume, per bucket. Above 1 = active, above 2 = climax, below 0.5 = quiet."
          actions={
            <>
              <Segmented<"lin" | "log"> label="Y scale" value={log ? "log" : "lin"} onChange={(v) => setLog(v === "log")} options={[{ value: "lin", label: "Linear" }, { value: "log", label: "Log" }]} />
              <Button size="sm" variant="ghost" onClick={() => downloadCsv(`volume_ratio_${range}.csv`, zoomedRows(rows).map((r) => ({ date: r.date, bucket: r.bucket, vol_ratio: r.vol_ratio, vol_regime: r.vol_regime, n_high: r.n_high, n_low: r.n_low, n_valid: r.n_valid, data_quality: r.data_quality })))}>CSV</Button>
            </>
          }
        />
        <CardBody>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <BucketToggles value={vrBuckets} onChange={setVrBuckets} dark={dark} />
            <InfoTip k="vr_buckets" />
            <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted">Lower panel follows the bucket picker <InfoTip k="hl_bars" /></span>
          </div>
          <VolumeRatioChart rows={rows} t={t} zoom={zoom} setZoom={setZoom} log={log} barBucket={bucket} visible={vrBuckets} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`% of stocks above EMA${ema} · ${emaView === "single" ? BUCKET_LABEL[bucket] : "all buckets"}`}
          info="ema_chart"
          subtitle={`Change the EMA with the header selector. Shaded: ≥ 80% overheated, < 20% oversold.`}
          actions={
            <>
              <Segmented<"single" | "multiples"> label="View" value={emaView} onChange={setEmaView} options={[{ value: "single", label: "One bucket" }, { value: "multiples", label: "Small multiples" }]} />
              <Button size="sm" variant="ghost" onClick={() => downloadCsv(`pct_above_ema_${range}.csv`, zoomedRows(rows).filter((r) => emaView === "multiples" || r.bucket === bucket).map((r) => ({ date: r.date, bucket: r.bucket, pct_ema10: r.pct_ema10, pct_ema20: r.pct_ema20, pct_ema50: r.pct_ema50, n_above_ema10: r.n_above_ema10, n_above_ema20: r.n_above_ema20, n_above_ema50: r.n_above_ema50, n_valid: r.n_valid })))}>CSV</Button>
            </>
          }
        />
        <CardBody>
          {emaView === "single" ? (
            <EmaBreadthChart rows={rows} bucket={bucket} ema={ema} t={t} zoom={zoom} setZoom={setZoom} dates={dates} />
          ) : (
            <SmallMultiples rows={rows} ema={ema} t={t} zoom={zoom} setZoom={setZoom} />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`Market situation timeline · EMA${ema}`}
          info="timeline"
          subtitle={`${raw ? "Raw" : "Confirmed"} state per bucket per day. Letter codes appear when zoomed to ≤ 70 sessions.`}
          actions={<Button size="sm" variant="ghost" onClick={() => downloadCsv(`states_ema${ema}_${range}.csv`, zoomedRows(rows).map((r) => ({ date: r.date, bucket: r.bucket, state: r[`state_ema${ema}`], state_raw: r[`state_raw_ema${ema}`], rule: r[`rule_ema${ema}`], days_in_state: r[`days_in_state_ema${ema}`], p: r[`pct_ema${ema}`], vr: r.vol_ratio })))}>CSV</Button>}
        />
        <CardBody>
          <StateTimeline rows={rows} ema={ema} raw={raw} t={t} zoom={zoom} setZoom={setZoom} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Heatmap · days × buckets"
          info="heatmap"
          subtitle={heatMetric === "pct" ? `Cells coloured by % above EMA${ema}.` : "Cells coloured by volume ratio (log scale, grey = 1.0)."}
          actions={
            <>
              <Segmented<"pct" | "vr"> label="Heatmap metric" value={heatMetric} onChange={setHeatMetric} options={[{ value: "pct", label: `% > EMA${ema}` }, { value: "vr", label: "Volume ratio" }]} />
              <Button size="sm" variant="ghost" onClick={() => downloadCsv(`heatmap_${heatMetric}_${range}.csv`, zoomedRows(rows).map((r) => ({ date: r.date, bucket: r.bucket, value: heatMetric === "pct" ? r[`pct_ema${ema}`] : r.vol_ratio })))}>CSV</Button>
            </>
          }
        />
        <CardBody>
          <Heatmap rows={rows} ema={ema} metric={heatMetric} t={t} zoom={zoom} setZoom={setZoom} />
        </CardBody>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader title={`State map · ${BUCKET_LABEL[bucket]}`} info="state_map" subtitle={`VR vs % above EMA${ema}. Trail = last 10 sessions; slider replays history.`}
            actions={<BucketPicker value={bucket} onChange={setBucket} />} />
          <CardBody>
            <StateMap rows={rows} bucket={bucket} ema={ema} t={t} cfg={cfg} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={`State statistics · ${BUCKET_LABEL[bucket]}`} info="state_stats" subtitle={`${range} range · EMA${ema}`} />
          <CardBody>
            <StateStats rows={zoomedRows(rows)} bucket={bucket} ema={ema} raw={raw} />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Compare days" info="compare_days" subtitle="Pick two sessions; differences are B − A." />
        <CardBody>
          <CompareDays rows={all} ema={ema} />
        </CardBody>
      </Card>
    </div>
  );
}
