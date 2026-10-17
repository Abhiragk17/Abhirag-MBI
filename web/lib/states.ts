import type { Bucket, Ema, HistoryRow, StateCode } from "./types";

/** Fixed state palette (validated: normal-vision floor passes; CVD sits in the 6-8 band,
 * so every state mark also carries its letter code - colour is never the only cue). */
export const STATE_META: Record<StateCode, { name: string; short: string; color: string; icon: string; meaning: string; focus: string }> = {
  BD: { name: "Bullish Domination", short: "Bullish", color: "#008300", icon: "▲", meaning: "Stocks move upward easily", focus: "Breakouts, gaps, strong-structure reversal setups" },
  LD: { name: "Lack of Demand", short: "No demand", color: "#eda100", icon: "◇", meaning: "No strong demand; stocks fail to follow through", focus: "Intraday breakouts, shorting gaps, reversals and pullbacks" },
  EU: { name: "Euphoria / Overheated Market", short: "Euphoria", color: "#6250d6", icon: "✦", meaning: "Highly extended market; breakouts may fail", focus: "Parabolic shorts, gap-up shorts, playing the index trend" },
  BR: { name: "Bearish Domination", short: "Bearish", color: "#e34948", icon: "▼", meaning: "Majority of stocks are falling", focus: "Short setups, stocks entering stage 4" },
  LS: { name: "Lack of Supply", short: "No supply", color: "#5598e7", icon: "◆", meaning: "Sellers pausing after a strong decline", focus: "Resilient stocks that are not falling further; breakouts from strong structures" },
  PA: { name: "Panic / Overheated Decline", short: "Panic", color: "#8a2b4a", icon: "✖", meaning: "Oversold, bottoming situation", focus: "Reversals; parabolic long setups in strong-structure or declining stocks" },
};
export const STATE_ORDER: StateCode[] = ["EU", "BD", "LD", "LS", "BR", "PA"];

/** Categorical slots in fixed order (reference palette); ALL wears the primary ink. */
export const BUCKET_COLORS: Record<Bucket, { light: string; dark: string }> = {
  ALL: { light: "#0b0b0b", dark: "#f0efec" },
  LARGECAP: { light: "#2a78d6", dark: "#3987e5" },
  MIDCAP: { light: "#eb6834", dark: "#d95926" },
  SMALLCAP: { light: "#1baf7a", dark: "#199e70" },
  MICROCAP: { light: "#eda100", dark: "#c98500" },
  NANOCAP: { light: "#e87ba4", dark: "#d55181" },
};
export const EMA_COLORS: Record<Ema, { light: string; dark: string }> = {
  10: { light: "#2a78d6", dark: "#3987e5" },
  20: { light: "#eb6834", dark: "#d95926" },
  50: { light: "#1baf7a", dark: "#199e70" },
};

export const BUCKET_LABEL: Record<Bucket, string> = {
  ALL: "ALL (1000)",
  LARGECAP: "Largecap",
  MIDCAP: "Midcap",
  SMALLCAP: "Smallcap",
  MICROCAP: "Microcap",
  NANOCAP: "Nanocap",
};

export const REGIME_LABEL: Record<string, string> = {
  extreme_low: "Extreme low demand / fear",
  choppy: "Choppy and muted",
  improving: "Improving, tradable",
  building: "Building demand",
  high_demand: "High-demand phase",
  extreme: "Extreme excess / climax",
  no_low_volume: "No low-volume stocks (ratio undefined)",
};

export function stateOf(r: HistoryRow, ema: Ema, raw = false): StateCode | null {
  return (raw ? r[`state_raw_ema${ema}`] : r[`state_ema${ema}`]) as StateCode | null;
}
export function pctOf(r: HistoryRow, ema: Ema): number | null {
  return r[`pct_ema${ema}`];
}

export function ruleText(rule: string | null | undefined): string {
  if (!rule) return "no data";
  if (rule === "override:panic") return "Panic override (VR ≥ extreme and P low)";
  if (rule === "override:euphoria") return "Euphoria override (P very high)";
  if (rule === "no_data") return "no valid stocks";
  const m = rule.match(/^table:(\w+)x(\w+)(:alt)?$/);
  if (m) return `${m[1]} × ${m[2]}${m[3] ? " (trend condition met)" : ""}`;
  return rule;
}

export function explain(r: HistoryRow, ema: Ema, raw = false): string {
  const p = pctOf(r, ema);
  const vr = r.vol_ratio;
  const s = stateOf(r, ema, true);
  const conf = stateOf(r, ema, false);
  const dp = r[`dp_ema${ema}`];
  const parts = [
    `P(EMA${ema}) = ${p == null ? "n/a" : p.toFixed(1) + "%"}`,
    `VR = ${vr == null ? "null (treated as high)" : vr.toFixed(2)}`,
  ];
  if (dp != null) parts.push(`dP = ${dp >= 0 ? "+" : ""}${dp.toFixed(1)}`);
  let txt = `${parts.join(", ")}, rule: ${ruleText(r[`rule_ema${ema}`])} → ${s ? STATE_META[s].short : "n/a"}`;
  if (!raw && conf && s && conf !== s) txt += ` (confirmed state still ${STATE_META[conf].short}; waiting for confirmation)`;
  return txt;
}
