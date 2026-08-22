import { NextResponse } from "next/server";
import { JOB_ID_PATTERN } from "@/lib/job-config";
import { approveMarketingUsage, completeServiceJob, getServiceJob, startServiceJob } from "@/lib/job-store";
import { markRecoveryContacted } from "@/lib/post-service";

export const runtime = "nodejs";

type Params = { params: Promise<{ jobId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { jobId } = await params;
  if (!JOB_ID_PATTERN.test(jobId)) return NextResponse.json({ ok: false }, { status: 400 });
  const job = getServiceJob(jobId);
  if (!job) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.json({ ok: true, job });
}

export async function PATCH(request: Request, { params }: Params) {
  const { jobId } = await params;
  if (!JOB_ID_PATTERN.test(jobId)) return NextResponse.json({ ok: false }, { status: 400 });
  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  const action = String(body?.action || "");
  if (action === "start") {
    const result = startServiceJob(jobId, "admin");
    return NextResponse.json({ ok: result.ok, status: result.job?.status, already: result.already });
  }
  if (action === "complete") {
    const result = completeServiceJob(jobId, "admin");
    return NextResponse.json({ ok: result.ok, status: result.job?.status, already: result.already });
  }
  if (action === "recovery_contacted") {
    const result = markRecoveryContacted(jobId, "admin");
    const job = getServiceJob(jobId);
    return NextResponse.json({ ok: result.ok, status: job?.status, already: result.already });
  }
  if (action === "approve_marketing") {
    approveMarketingUsage(jobId, "admin");
    const job = getServiceJob(jobId);
    return NextResponse.json({ ok: true, status: job?.status });
  }
  return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
}
