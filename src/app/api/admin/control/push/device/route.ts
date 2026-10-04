import { NextResponse } from "next/server";
import { parseAdminSessionNonce } from "@/lib/admin-auth";
import { requireAdminMutation, requireAdminSession, readAdminSessionToken } from "@/lib/control-auth";
import {
  controlPushStatusPublic,
  registerControlPushDevice,
  revokeControlPushDevice,
} from "@/lib/control-push";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await requireAdminSession(request);
  if (!session.ok) return NextResponse.json({ ok: false, error: session.error }, { status: session.status });
  return NextResponse.json({ ok: true, push: controlPushStatusPublic() });
}

export async function POST(request: Request) {
  const gate = await requireAdminMutation(request);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  const body = (await request.json().catch(() => null)) as {
    token?: string;
    platform?: string;
  } | null;
  const token = await readAdminSessionToken(request);
  const nonce = token ? parseAdminSessionNonce(token)?.nonce || "" : "";
  const result = registerControlPushDevice({
    token: String(body?.token || ""),
    platform: String(body?.platform || "android"),
    sessionNonce: nonce,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    subjectId: result.subjectId,
    env: result.env,
    push: controlPushStatusPublic(),
  });
}

export async function DELETE(request: Request) {
  const gate = await requireAdminMutation(request);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  const body = (await request.json().catch(() => null)) as { token?: string } | null;
  revokeControlPushDevice(String(body?.token || ""));
  return NextResponse.json({ ok: true });
}
