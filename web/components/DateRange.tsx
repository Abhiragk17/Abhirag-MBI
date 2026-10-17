"use client";

import type { RangeKey } from "@/lib/series";
import { Segmented } from "./ui/button";

export function DateRange({ value, onChange }: { value: RangeKey; onChange: (r: RangeKey) => void }) {
  return (
    <Segmented<RangeKey>
      label="Date range"
      value={value}
      onChange={onChange}
      options={(["1M", "3M", "6M", "1Y", "All"] as RangeKey[]).map((r) => ({ value: r, label: r }))}
    />
  );
}
