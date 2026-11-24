"use client";

import { useState } from "react";
import { useApp } from "@/components/AppShell";
import { Card, CardBody, EmptyState, Skeleton } from "@/components/ui/card";
import { Button, Segmented } from "@/components/ui/button";
import { InfoTip, WithInfo } from "@/components/ui/info";
import { chartTokens } from "@/components/charts/EChart";
import { Alerts } from "@/components/themes/Alerts";
import { Leaderboard } from "@/components/themes/Leaderboard";
import { Movers } from "@/components/themes/Movers";
import { CorrelationPanel, RegimePanel } from "@/components/themes/RegimeCorr";
import { RotationGraph } from "@/components/themes/RotationGraph";
import { Ret, useThemeData } from "@/components/themes/shared";
import type { CorrData, RegimeData, RrgData, StockRow, ThemesLatest } from "@/lib/themes";
import { PERIODS } from "@/lib/themes";

type Tab = "leaderboard" | "rotation" | "movers" | "alerts" | "regime";

export default function ThemesPage() {
  const { dataVersion, dark, runJob, status } = useApp();
  const t = chartTokens(dark);
  const [tab, setTab] = useState<Tab>("leaderboard");
  const latest = useThemeData<ThemesLatest>("latest", dataVersion);
  const rrg = useThemeData<RrgData>("rrg", dataVersion);
  const stocks = useThemeData<{ stocks: StockRow[] }>("stocks", dataVersion);
  const regime = useThemeData<RegimeData>("regime", dataVersion);
  const corr = useThemeData<CorrData>("corr", dataVersion);
  const running = !!status?.job?.running;

  if (latest.loading && !latest.data) return <Skeleton className="h-64" label="Loading themes" />;
  if (!latest.data || !latest.data.groups.length) {
    return (
      <EmptyState title="No theme data yet" reason={latest.error ?? latest.data?.note ?? "Run python -m mbi themes, or press the button."}
        className="mx-auto mt-10 max-w-lg" />
    );
  }
  const d = latest.data;
  const cov = d.coverage;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-1.5 text-lg font-bold tracking-tight">Themes &amp; sector rotation <InfoTip k="th_page" /></h1>
          <p className="text-xs text-ink-2">
            {cov.groups} groups · {cov.stocks} stocks ({cov.eligible_today} counted today, {cov.new} newly listed) · as of <b className="text-ink">{d.date}</b>
            {cov.unmapped.length ? <> · {cov.unmapped.length} symbol(s) not in the archive</> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <WithInfo k="th_market_bar"><span className="text-ink-2">Market (equal weight):</span></WithInfo>
          {PERIODS.map((p) => <span key={p}>{p} <Ret v={d.bench[`ret_${p}`]} /></span>)}
          <WithInfo k="th_recompute"><Button size="sm" variant="outline" disabled={running} onClick={() => runJob("themes")}>{running ? "Running…" : "Recompute themes"}</Button></WithInfo>
        </div>
      </div>

      <Segmented<Tab> label="Section" value={tab} onChange={setTab} options={[
        { value: "leaderboard", label: "Leaderboard" }, { value: "rotation", label: "Rotation (RRG)" }, { value: "movers", label: "Movers" },
        { value: "alerts", label: `Alerts & digest (${d.emerging.length + d.deteriorating.length + d.thrusts.length})` }, { value: "regime", label: "Regime & correlation" }]} />

      {tab === "leaderboard" ? <Leaderboard groups={d.groups} t={t} /> : null}
      {tab === "rotation" ? (rrg.data ? <RotationGraph rrg={rrg.data} t={t} /> : <EmptyState title="Loading rotation data" reason={rrg.error ?? undefined} />) : null}
      {tab === "movers" ? <Movers latest={d} stocks={stocks.data?.stocks ?? null} /> : null}
      {tab === "alerts" ? <Alerts latest={d} /> : null}
      {tab === "regime" ? (
        <div className="space-y-4">
          <RegimePanel regime={regime.data} dark={dark} />
          <CorrelationPanel corr={corr.data && "order" in corr.data ? corr.data : null} t={t} />
        </div>
      ) : null}
      <Card><CardBody className="text-[11px] text-ink-2">
        Groups are equal-weight indices of stocks with a 20-day median traded value of at least ₹{(d.config.min_traded_value / 1e5).toFixed(0)} lakh and 20+ sessions of history.
        Daily returns are clipped at ±20% and suspected unadjusted splits are dropped. Groups with fewer than {d.config.min_group_size} counted stocks are hidden from rankings.
        Thresholds, score weights and the group list are editable on the <a className="underline" href="/config#themes">Config page</a>.
      </CardBody></Card>
    </div>
  );
}
