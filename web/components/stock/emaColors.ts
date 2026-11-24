/** One colour per EMA length, shared by the chart lines and the status chips above it. */
export const EMA_COLORS = { 10: "#22c55e", 20: "#2a78d6", 50: "#eab308", 200: "#ef4444" } as const;
export const EMA_LENGTHS = [10, 20, 50, 200] as const;
