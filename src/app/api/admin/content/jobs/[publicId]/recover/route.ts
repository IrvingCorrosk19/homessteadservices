import { NextResponse } from "next/server";
import { requireAdminMutation } from "@/lib/control-auth";
import { recoverControlJob } from "@/lib/control-intake";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ publicId: string }> },
) {
  const gate = await requireAdminMutation(request);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }
  const { publicId } = await context.params;
  const result = await recoverControlJob(publicId);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
