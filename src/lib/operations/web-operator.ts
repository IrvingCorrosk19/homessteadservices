/**
 * Web admin → Operations AI operator bridge.
 * Session is already gated by hs_admin cookie; tools still check TelegramPermission.
 */
import { listOperators, type TelegramOperator } from "@/lib/telegram-operators";

const WEB_OPERATOR_ID = -1;

export function resolveWebOperationsOperator(): TelegramOperator {
  const owners = listOperators({ includeInactive: false }).filter((op) => op.role === "OWNER" && op.isActive);
  if (owners[0]) return owners[0];
  return {
    id: WEB_OPERATOR_ID,
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

export function webOperatorSessionKey(operator: TelegramOperator): string {
  return operator.id === WEB_OPERATOR_ID ? "web-admin" : String(operator.telegramUserId);
}
