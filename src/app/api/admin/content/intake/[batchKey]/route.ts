import { NextResponse } from "next/server";
import { requireAdminMutation, requireAdminSession } from "@/lib/control-auth";
import { listControlIntake, recoverControlIntake } from "@/lib/control-intake";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ batchKey: string }> },
) {
  const gate = await requireAdminSession();
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  const { batchKey } = await context.params;
  return NextResponse.json({ ok: true, items: listControlIntake(batchKey) });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ batchKey: string }> },
) {
  const gate = await requireAdminMutation(request);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  const { batchKey } = await context.params;
  const recovered = await recoverControlIntake(batchKey, "", "admin-web");
  return NextResponse.json({ ok: true, ...recovered });
}
