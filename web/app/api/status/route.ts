import { NextResponse } from "next/server";
import { buildStatus, currentJob } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ ...(await buildStatus()), job: currentJob() });
  } catch (e) {
    return NextResponse.json({
      status: null, latestDate: null, badge: "error", badgeLabel: "Status unreadable",
      banners: [{ id: "status-err", level: "error", message: `Could not read data_status.json: ${String(e)}` }],
      warnings: [], generatedAt: new Date().toISOString(), job: currentJob(),
    });
  }
}
