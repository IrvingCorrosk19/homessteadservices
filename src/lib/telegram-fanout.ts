/**
 * Fan-out Telegram deliveries for a single business event.
 * Does NOT create extra HS rows or outbox business events.
 */
import { adminChatIds, sendTelegramMessage, type TelegramButton } from "@/lib/content-telegram";
import { incrementTelegramMetric } from "@/lib/telegram-operators";
import { logInfo } from "@/lib/log";

function n8nPrimaryChatId() {
  return (process.env.HOMESTEAD_TELEGRAM_CHAT_ID || "").trim();
}

export async function fanOutServiceRequestTelegram(data: Record<string, unknown>) {
  const requestId = String(data.requestId || data.correlationId || "");
  const presentation = data.presentation as { lines?: string[] } | undefined;
  const lines = presentation?.lines?.filter(Boolean) || [];
  const customer = data.customer as { name?: string; phone?: string } | undefined;
  const service = data.service as { type?: string; description?: string } | undefined;
  const text =
    lines.length > 0
      ? lines.join("\n")
      : [
          "📥 NUEVA SOLICITUD",
          "",
          requestId,
          customer?.name ? `👤 ${customer.name}` : "",
          service?.type ? `🛠 ${service.type}` : "",
          service?.description ? String(service.description).slice(0, 280) : "",
        ]
          .filter(Boolean)
          .join("\n");
  if (!text.trim()) return { sent: 0, skipped: true as const };

  const primary = n8nPrimaryChatId();
  const chats = adminChatIds("requests").filter((chat) => chat && chat !== primary);
  if (!chats.length) return { sent: 0, skipped: true as const };

  const actions = data.actions as { contactWhatsApp?: string | null; replyUrl?: string } | undefined;
  const keyboard: TelegramButton[][] = [];
  const row: TelegramButton[] = [];
  if (actions?.contactWhatsApp) row.push({ text: "💬 WhatsApp", url: actions.contactWhatsApp });
  if (actions?.replyUrl) row.push({ text: "📞 Ficha", url: actions.replyUrl });
  if (row.length) keyboard.push(row);
  if (requestId) {
    keyboard.push([
      { text: "✅ Atendido", callback_data: `cc:c:${requestId}` },
      { text: "🕒 15 min", callback_data: `cc:z:${requestId}:15` },
    ]);
    keyboard.push([{ text: "⬅ Inicio", callback_data: "cc:h" }]);
  }

  let sent = 0;
  let failed = 0;
  for (const chatId of chats) {
    try {
      const id = await sendTelegramMessage({ chatId, text, keyboard: keyboard.length ? keyboard : undefined });
      if (id) {
        sent += 1;
        incrementTelegramMetric("telegram_delivery_success");
      } else {
        failed += 1;
        incrementTelegramMetric("telegram_delivery_failure");
      }
    } catch {
      failed += 1;
      incrementTelegramMetric("telegram_delivery_failure");
    }
  }
  logInfo("TelegramFanoutDelivered", {
    correlationId: requestId,
    stage: "service_request.created",
    attempt: sent,
    contentJobId: failed ? `fail:${failed}` : undefined,
  });
  return { sent, failed, skipped: false as const };
}

export async function fanOutServiceRequestCancelledTelegram(data: Record<string, unknown>) {
  const requestId = String(data.requestId || data.correlationId || "");
  const service = String((data.service as string) || "");
  const reason = String((data.reason as string) || "");
  const reasonCategory = String((data.reasonCategory as string) || "");
  const cancelledAppointmentIds = Array.isArray(data.cancelledAppointmentIds)
    ? data.cancelledAppointmentIds.map(String).filter(Boolean)
    : [];
  const motivo =
    reason ||
    (reasonCategory === "NOT_PROVIDED" || !reasonCategory ? "No se registró un motivo" : reasonCategory);
  const text = [
    "❌ SOLICITUD CANCELADA",
    "",
    requestId,
    service ? `Servicio: ${service}` : "",
    `Motivo: ${motivo.slice(0, 160)}`,
    cancelledAppointmentIds.length
      ? `Cita asociada: ${cancelledAppointmentIds.join(", ")} cancelada`
      : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
  if (!text.trim() || !requestId) return { sent: 0, skipped: true as const };

  const chats = adminChatIds("requests");
  if (!chats.length) return { sent: 0, skipped: true as const };

  let sent = 0;
  let failed = 0;
  for (const chatId of chats) {
    try {
      const id = await sendTelegramMessage({ chatId, text });
      if (id) {
        sent += 1;
        incrementTelegramMetric("telegram_delivery_success");
      } else {
        failed += 1;
        incrementTelegramMetric("telegram_delivery_failure");
      }
    } catch {
      failed += 1;
      incrementTelegramMetric("telegram_delivery_failure");
    }
  }
  logInfo("TelegramFanoutDelivered", {
    correlationId: requestId,
    stage: "service_request.cancelled",
    attempt: sent,
    contentJobId: failed ? `fail:${failed}` : undefined,
  });
  return { sent, failed, skipped: false as const };
}
