"use client";

import type { Ema } from "@/lib/types";
import { Segmented } from "./ui/button";

export function EmaSelector({ value, onChange }: { value: Ema; onChange: (e: Ema) => void }) {
  return (
    <Segmented<Ema>
      label="EMA length"
      value={value}
      onChange={onChange}
      options={[
        { value: 10, label: "EMA 10" },
        { value: 20, label: "EMA 20" },
        { value: 50, label: "EMA 50" },
      ]}
    />
  );
}
