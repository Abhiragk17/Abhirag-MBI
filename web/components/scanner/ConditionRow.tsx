"use client";

import { OPS, type Condition, type Indexed, type Op, type ScreenField } from "@/lib/screener";
import { FieldPicker } from "./FieldPicker";
import { Button } from "@/components/ui/button";

/** A sensible field to compare against: price fields vs the 50D SMA, other fields vs a same-unit sibling. */
function defaultVs(f: ScreenField | undefined, fields: ScreenField[]): string {
  if (!f || f.unit === "₹") return "sma_50d";
  return fields.find((x) => x.unit === f.unit && x.kind === "num" && x.key !== f.key)?.key ?? "sma_50d";
}

const input = "h-8 rounded-md border border-line bg-surface px-2 text-xs tabular focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function ConditionRow({ c, fields, ix, onChange, onRemove }: {
  c: Condition; fields: ScreenField[]; ix: Indexed; onChange: (patch: Partial<Condition>) => void; onRemove: () => void;
}) {
  const f = ix.field[c.field];
  const flag = f?.kind === "flag";
  const numeric = fields.filter((x) => x.kind === "num");
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-line/70 bg-surface px-2 py-1.5">
      <FieldPicker className="w-56" fields={fields} value={c.field} label="Field" onChange={(key) => {
        const k = ix.field[key];
        onChange({ field: key, op: k?.kind === "flag" ? "=" : c.op === "=" && ix.field[c.field]?.kind === "flag" ? ">=" : c.op, value: k?.kind === "flag" ? "1" : c.value, vsField: null });
      }} />
      {flag ? (
        <select aria-label="Value" value={c.value || "1"} onChange={(e) => onChange({ op: "=", value: e.target.value })} className={input}>
          <option value="1">is true (yes)</option>
          <option value="0">is false (no)</option>
        </select>
      ) : (
        <>
          <select aria-label="Operator" value={c.op} onChange={(e) => onChange({ op: e.target.value as Op })} className={input}>
            {OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {c.vsField !== null && c.op !== "between" ? (
            <>
              <input aria-label="Multiplier" inputMode="decimal" value={c.mult} onChange={(e) => onChange({ mult: e.target.value })} className={`${input} w-16 text-right`} />
              <span className="text-xs text-muted">×</span>
              <FieldPicker className="w-48" fields={numeric} value={c.vsField || null} label="Compare to field" onChange={(k) => onChange({ vsField: k })} />
              {f && ix.field[c.vsField]?.unit !== f.unit ? (
                <span className="text-[11px]" style={{ color: "var(--warning)" }} title="The two fields use different units, so the comparison may not mean what you expect.">
                  ▲ units differ ({f.unit} vs {ix.field[c.vsField]?.unit})
                </span>
              ) : null}
            </>
          ) : (
            <>
              <input aria-label="Value" inputMode="decimal" placeholder={f ? f.unit : "value"} value={c.value} onChange={(e) => onChange({ value: e.target.value })} className={`${input} w-24 text-right`} />
              {c.op === "between" ? (
                <>
                  <span className="text-xs text-muted">and</span>
                  <input aria-label="Upper value" inputMode="decimal" value={c.value2} onChange={(e) => onChange({ value2: e.target.value })} className={`${input} w-24 text-right`} />
                </>
              ) : null}
            </>
          )}
          {c.op !== "between" ? (
            <button type="button" className="text-xs text-ink-2 underline hover:text-ink" title="Compare against another field (e.g. Close > 1.3 × 52W low)"
              onClick={() => onChange(c.vsField === null ? { vsField: defaultVs(f, numeric), mult: "1" } : { vsField: null })}>
              {c.vsField === null ? "vs field" : "vs number"}
            </button>
          ) : null}
        </>
      )}
      {f ? <span className="hidden min-w-0 flex-1 truncate text-[11px] text-muted xl:inline" title={f.desc}>{f.desc}</span> : null}
      <Button size="sm" variant="ghost" className="ml-auto" aria-label="Remove condition" onClick={onRemove}>✕</Button>
    </div>
  );
}
