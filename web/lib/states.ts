import type { Bucket, Ema, HistoryRow, RegimeConfig, StateCode } from "./types";

/** The parts of regime_config.json the rule grid needs; mirrors classifier.DEFAULT_CONFIG. */
export type RuleGridConfig = Pick<RegimeConfig, "p_zones" | "vr_zones" | "table"> & { null_vr_zone?: string };
export const DEFAULT_RULES: RuleGridConfig = {
  p_zones: { L: 20, M: 40, H: 60, VH: 80 },
  vr_zones: { mid: 0.5, high: 1.0, extreme: 2.0 },
  table: {
    VH: { low: "EU", mid: "EU", high: "EU" },
    H: { low: "LD", mid: "BD", high: "BD" },
    M: { low: "LD", mid: { state: "LD", alt_state: "BD", alt_when: { vr_min: 0.7, dp_gt: 0 } }, high: "BD" },
    L: { low: { state: "LS", alt_state: "BR", alt_when: { dp_lt: 0 } }, mid: "BR", high: "BR" },
    VL: { low: "LS", mid: "BR", high: "PA" },
  },
  null_vr_zone: "high",
};
export const P_ZONE_ORDER = ["VL", "L", "M", "H", "VH"] as const;

/** Same edges as classifier.p_zone / vr_zone: lower edges inclusive. */
export function pZoneOf(p: number, cfg: RuleGridConfig): (typeof P_ZONE_ORDER)[number] {
  const z = cfg.p_zones;
  return p >= z.VH ? "VH" : p >= z.H ? "H" : p >= z.M ? "M" : p >= z.L ? "L" : "VL";
}
export function vrZoneOf(vr: number | null, cfg: RuleGridConfig): "low" | "mid" | "high" {
  if (vr == null) return (cfg.null_vr_zone as "low" | "mid" | "high") ?? "high";
  return vr >= cfg.vr_zones.high ? "high" : vr >= cfg.vr_zones.mid ? "mid" : "low";
}
export function pZoneWord(z: string): string {
  return { VH: "Very strong", H: "Strong", M: "Mixed", L: "Weak", VL: "Very weak" }[z] ?? z;
}

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
