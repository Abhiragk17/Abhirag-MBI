import { NextResponse } from "next/server";
import { currentJob, startJob } from "@/lib/server";

export const dynamic = "force-dynamic";

const JOBS: Record<string, string[]> = {
  daily: ["daily"],
  offline: ["daily", "--offline"],
  recompute: ["recompute"],
  reclassify: ["recompute", "--states-only"],
};

export async function GET() {
  return NextResponse.json({ job: currentJob() });
}

export async function POST(req: Request) {
  let name = "daily";
  try {
    const body = await req.json();
    if (body?.job) name = String(body.job);
  } catch {
    /* no body: default job */
  }
  const args = JOBS[name];
  if (!args) return NextResponse.json({ error: `unknown job ${name}` }, { status: 400 });
  const { job, alreadyRunning } = startJob(name, args);
  return NextResponse.json({ job, alreadyRunning }, { status: job.error && !job.running ? 500 : 202 });
}
