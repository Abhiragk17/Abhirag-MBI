"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/card";

export const StockChart = dynamic(() => import("./StockChartInner"), {
  ssr: false,
  loading: () => <Skeleton className="h-[calc(100vh-240px)] min-h-[520px]" label="Loading chart" />,
});
