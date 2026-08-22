import { enqueueOutbox, getOutboxByIdempotency, setEngineState } from "@/lib/automation-outbox";
import { getHomesteadDb, customerWhatsAppUrl } from "@/lib/service-requests";
import { adminChatIds, type TelegramButton } from "@/lib/content-telegram";
import { logInfo } from "@/lib/log";
import { agoLabel, isQuietHours, nextQuietEndIso, opsConfig, panamaParts } from "@/lib/ops-config";
import {
  commandCenterSummary,
  listRescueDue,
  listSlaDue,
  markRescueAlerted,
  markSlaAlerted,
  panamaToday,
  todayMetrics,
} from "@/lib/ops-store";
import { appointmentServiceLabel } from "@/lib/appointment-time";

function enqueueOpsAlert(input: {
  eventType: string;
  correlationId: string;
  idempotencyKey: string;
  text: string;
  keyboard: TelegramButton[][];
  priority: "INFO" | "ACTION" | "WARNING" | "CRITICAL";
}) {
  const chats = adminChatIds();
  if (!chats.length) return "";
  const nextAttemptAt = input.priority === "INFO" && isQuietHours() ? nextQuietEndIso() : undefined;
  return enqueueOutbox(getHomesteadDb(), {
    eventType: input.eventType,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    nextAttemptAt,
    data: {
      event: "ops.telegram.alert",
      priority: input.priority,
      text: input.text,
      keyboard: input.keyboard,
      chats,
    },
  });
}

function contactButtons(id: string, phone: string): TelegramButton[][] {
  const wa = customerWhatsAppUrl(phone);
  const row: TelegramButton[] = [];
  if (wa) row.push({ text: "💬 WhatsApp", url: wa });
  if (id.startsWith("HS-")) {
    row.push({
      text: "📞 Ficha",
      url: `${(process.env.NEXT_PUBLIC_SITE_URL || "https://homestead.lat").replace(/\/$/, "")}/admin/solicitudes/${id}`,
    });
  }
  return [
    row.length ? row : [{ text: "📞 Ver teléfono arriba", callback_data: `cc:v:${id}` }],
    [
      { text: "✅ Atendido", callback_data: `cc:c:${id}` },
      { text: "🕒 15 min", callback_data: `cc:z:${id}:15` },
    ],
    [
      { text: "🕒 30 min", callback_data: `cc:z:${id}:30` },
      { text: "🕒 1 h", callback_data: `cc:z:${id}:60` },
    ],
    [{ text: "⬅ Inicio", callback_data: "cc:h" }],
  ];
}

export function enqueueRescueAlerts() {
  const minutes = opsConfig().rescueAfterMinutes;
  const due = listRescueDue(minutes * 60_000);
  let n = 0;
  for (const lead of due) {
    if (!lead) continue;
    const cycle = markRescueAlerted(lead.leadId);
    if (!cycle) continue;
    const waited = agoLabel(lead.leadCreatedAt);
    const test = lead.isTest ? "TEST · no es un cliente real\n\n" : "";
    const name = lead.name && lead.name !== "Cliente web" ? `👤 ${lead.name}\n` : "";
    enqueueOpsAlert({
      eventType: "lead.rescue_eligible",
      correlationId: lead.leadId,
      idempotencyKey: `lead.rescue_eligible:${lead.leadId}:${cycle}`,
      priority: "ACTION",
      text: [
        "🔥 OPORTUNIDAD SIN CERRAR",
        "",
        test + name + `🛠 ${appointmentServiceLabel(lead.service, lead.problem)}`,
        lead.location ? `📍 ${lead.location}` : "",
        `🕐 Sin respuesta ${waited.toLowerCase()}`,
        "",
        "El cliente dejó un teléfono pero no terminó de agendar.",
        "",
        lead.leadId,
      ]
        .filter(Boolean)
        .join("\n"),
      keyboard: [
        ...contactButtons(lead.leadId, lead.phone).slice(0, 2),
        [
          { text: "🕒 1 h", callback_data: `cc:z:${lead.leadId}:60` },
          { text: "❌ Descartar", callback_data: `cc:x:${lead.leadId}` },
        ],
        [{ text: "⬅ Inicio", callback_data: "cc:h" }],
      ],
    });
    logInfo("lead_rescue_eligible", { correlationId: lead.leadId, attempt: cycle });
    n += 1;
  }
  return n;
}

export function enqueueSlaAlerts() {
  let n = 0;
  for (const row of listSlaDue("first")) {
    if (!markSlaAlerted(row.public_id, "first")) continue;
    enqueueOpsAlert({
      eventType: "sla.first_response",
      correlationId: row.public_id,
      idempotencyKey: `sla.first:${row.public_id}`,
      priority: "WARNING",
      text: [
        "⏱ SOLICITUD PENDIENTE",
        "",
        row.is_test ? "TEST · no es un cliente real" : "",
        row.public_id,
        appointmentServiceLabel(row.service, row.message),
        `${opsConfig().slaFirstMinutes} min sin atención.`,
      ]
        .filter((line) => line !== "")
        .join("\n"),
      keyboard: contactButtons(row.public_id, row.phone),
    });
    n += 1;
  }
  for (const row of listSlaDue("escalation")) {
    if (!markSlaAlerted(row.public_id, "escalation")) continue;
    enqueueOpsAlert({
      eventType: "sla.escalation",
      correlationId: row.public_id,
      idempotencyKey: `sla.escalation:${row.public_id}`,
      priority: "WARNING",
      text: [
        "⚠️ SOLICITUD REQUIERE ATENCIÓN",
        "",
        row.is_test ? "TEST · no es un cliente real" : "",
        row.public_id,
        appointmentServiceLabel(row.service, row.message),
        `${opsConfig().slaEscalationMinutes} min sin atender.`,
      ]
        .filter((line) => line !== "")
        .join("\n"),
      keyboard: [
        [{ text: "✅ Atendido", callback_data: `cc:c:${row.public_id}` }],
        [{ text: "⬅ Inicio", callback_data: "cc:h" }],
      ],
    });
    n += 1;
  }
  return n;
}

export function enqueueDailyBrief(force = false) {
  const cfg = opsConfig();
  const parts = panamaParts();
  if (!force && parts.hour !== cfg.dailyBriefHour) return 0;
  if (!adminChatIds().length) return 0;
  const ymd = panamaToday().ymd;
  const key = `daily.brief:${ymd}`;
  if (getOutboxByIdempotency(key)) return 0;
  const snap = commandCenterSummary(false);
  const metrics = todayMetrics(false);
  enqueueOpsAlert({
    eventType: "daily.brief.ready",
    correlationId: ymd,
    idempotencyKey: key,
    priority: "INFO",
    text: [
      "☀️ HOMESTEAD — BUENOS DÍAS",
      "",
      "Hoy tienes:",
      "",
      `📅 ${snap.appointmentsToday} citas`,
      `🔥 ${snap.rescue} oportunidades por atender`,
      `📥 ${snap.pendingRequests} solicitudes nuevas pendientes`,
      `🔧 ${snap.jobsActive} trabajos`,
      snap.serviceRecovery ? `🚨 ${snap.serviceRecovery} cliente requiere seguimiento` : "",
      `📸 ${snap.contentPending + snap.contentCandidates} contenidos pendientes`,
      "",
      `Solicitudes hoy: ${metrics.requests}`,
    ]
      .filter((line) => line !== "")
      .join("\n"),
    keyboard: [[{ text: "🏠 Abrir Command Center", callback_data: "cc:h" }]],
  });
  setEngineState("last_daily_brief_at", new Date().toISOString());
  return 1;
}

export function runOpsEngine() {
  const rescue = enqueueRescueAlerts();
  const sla = enqueueSlaAlerts();
  const brief = enqueueDailyBrief();
  setEngineState("last_ops_engine_at", new Date().toISOString());
  return { rescue, sla, brief };
}
