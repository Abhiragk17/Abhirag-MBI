"use client";

import Link from "next/link";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { WithInfo } from "@/components/ui/info";
import type { GlossaryKey } from "@/lib/glossary";
import type { ThemesLatest } from "@/lib/themes";
import { groupHref, QuadBadge, Ret } from "./shared";

function Block({ title, hint, empty, children, count, info }: { info: GlossaryKey; title: string; hint: string; empty: string; children: React.ReactNode; count: number }) {
  return (
    <Card>
      <CardHeader info={info} title={<>{title} <span className="ml-1 rounded bg-surface-2 px-1.5 text-xs tabular text-ink-2">{count}</span></>} subtitle={hint} />
      <CardBody>{count ? <ul className="space-y-1.5 text-xs">{children}</ul> : <EmptyState title={empty} className="min-h-[72px]" />}</CardBody>
    </Card>
  );
}

export function Alerts({ latest }: { latest: ThemesLatest }) {
  const d = latest.digest;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader info="th_digest" title={`Daily digest · ${d.date}`}
          subtitle={d.market_state ? `Market state (EMA20, all stocks): ${d.market_state}` : undefined}
          actions={<>
            <a href="/api/themes/export/digest"><Button size="sm" variant="outline">Digest .md</Button></a>
            <a href="/api/themes/export/digest-json"><Button size="sm" variant="outline">Digest .json</Button></a>
            <WithInfo k="th_watchlist"><a href="/api/themes/export/watchlist"><Button size="sm" variant="outline">Watchlist .txt</Button></a></WithInfo>
          </>} />
        <CardBody>
          <div className="grid gap-6 lg:grid-cols-3">
            <div>
              <h3 className="mb-2 text-xs font-semibold text-ink-2">Leading groups</h3>
              <ol className="space-y-1.5 text-xs">
                {d.leaders.map((g, i) => (
                  <li key={g.slug} className="flex items-center gap-2">
                    <span className="w-4 tabular text-muted">{i + 1}</span>
                    <Link href={groupHref(g.slug)} className="min-w-0 flex-1 truncate font-medium hover:underline">{g.name}</Link>
                    <QuadBadge q={g.quadrant} /><Ret v={g.ret_1M} />
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold text-ink-2">Leader stocks in those groups</h3>
              <ul className="space-y-1.5 text-xs">
                {d.top_stocks.map((s) => (
                  <li key={s.symbol} className="flex items-center gap-2"><b className="w-24 truncate">{s.symbol}</b><span className="min-w-0 flex-1 truncate text-ink-2">{s.group}</span><Ret v={s.ret_21d} /><span className="w-8 text-right tabular text-muted">{s.rs}</span></li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold text-ink-2">Weakest groups</h3>
              <ul className="space-y-1.5 text-xs">
                {d.worst_groups.map((g) => (
                  <li key={g.slug} className="flex items-center gap-2"><Link href={groupHref(g.slug)} className="min-w-0 flex-1 truncate hover:underline">{g.name}</Link><QuadBadge q={g.quadrant} /><Ret v={g.ret_1M} /></li>
                ))}
              </ul>
            </div>
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Block info="th_emerging" title="Emerging themes" hint={`Moved from Improving or Lagging into Leading in the last ${latest.config.emerging_lookback} sessions.`} empty="None right now" count={latest.emerging.length}>
          {latest.emerging.map((e) => (
            <li key={e.slug} className="flex items-center gap-2">
              <Link href={groupHref(e.slug)} className="min-w-0 flex-1 truncate font-medium hover:underline">{e.name}</Link>
              <span className="text-muted">from {e.from}, {e.days_in_leading}d</span><Ret v={e.ret_1M} />
            </li>
          ))}
        </Block>
        <Block info="th_deteriorating" title="Losing leadership" hint="Was Leading within the window and has now slipped to Weakening or Lagging." empty="None right now" count={latest.deteriorating.length}>
          {latest.deteriorating.map((e) => (
            <li key={e.slug} className="flex items-center gap-2">
              <Link href={groupHref(e.slug)} className="min-w-0 flex-1 truncate font-medium hover:underline">{e.name}</Link>
              <QuadBadge q={e.now} /><span className="text-muted">{e.left_leading_days_ago}d ago</span><Ret v={e.ret_1M} />
            </li>
          ))}
        </Block>
        <Block info="th_thrust" title="Breadth thrusts" hint={`% of stocks above EMA20 rose ${latest.config.thrust.rise}+ points in ${latest.config.thrust.lookback} sessions to ${latest.config.thrust.level}%+.`} empty="None right now" count={latest.thrusts.length}>
          {latest.thrusts.map((e) => (
            <li key={e.slug} className="flex items-center gap-2">
              <Link href={groupHref(e.slug)} className="min-w-0 flex-1 truncate font-medium hover:underline">{e.name}</Link>
              <span className="tabular text-ink-2">{e.from.toFixed(0)}% → <b className="text-ink">{e.pct_ema20.toFixed(0)}%</b></span><span className="text-muted">n={e.n_eligible}</span>
            </li>
          ))}
        </Block>
      </div>
    </div>
  );
}
