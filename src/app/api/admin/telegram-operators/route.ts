import { NextResponse } from "next/server";
import {
  activateOperator,
  approveOperator,
  deactivateOperator,
  listOperators,
  rejectOperator,
  type TelegramOperator,
} from "@/lib/telegram-operators";

export const dynamic = "force-dynamic";

/**
 * Admin session already gates /api/admin/* via middleware.
 * Web admin acts as a synthetic OWNER actor for operator management.
 */
function webOwnerActor(): TelegramOperator {
  const owners = listOperators({ includeInactive: false }).filter((op) => op.role === "OWNER" && op.isActive);
  if (owners[0]) return owners[0];
  return {
    id: 0,
    telegramUserId: "web-admin",
    telegramChatId: "",
    displayName: "Web Admin",
    role: "OWNER",
    isActive: true,
    notifyRequests: false,
    notifyAppointments: false,
    notifyLeads: false,
    notifySla: false,
    notifyContent: false,
    notifyDailyBrief: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastSeenAt: null,
    approvedAt: null,
    approvedByOperatorId: null,
    deactivatedAt: null,
  };
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    operatorId?: number;
    action?: string;
    role?: string;
  } | null;
  if (!body?.operatorId || !body.action) {
    return NextResponse.json({ ok: false, error: "payload_invalid" }, { status: 400 });
  }
  const actor = webOwnerActor();
  const id = Number(body.operatorId);
  if (body.action === "approve") {
    const role = body.role === "OWNER" ? "OWNER" : "ADMIN";
    const result = approveOperator({ operatorId: id, role, actor });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.reason === "last_owner" ? "last_owner" : result.reason },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true });
  }
  if (body.action === "reject") {
    const result = rejectOperator({ operatorId: id, actor });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.reason }, { status: 400 });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "deactivate") {
    const result = deactivateOperator({ operatorId: id, actor });
    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.reason === "last_owner" ? "No se puede desactivar al último OWNER." : result.reason,
        },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true });
  }
  if (body.action === "activate") {
    const result = activateOperator({ operatorId: id, actor });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.reason }, { status: 400 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
}
