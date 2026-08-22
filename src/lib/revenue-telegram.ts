import { marketingBaseline } from "@/lib/marketing-engine";
import { contactRegion, alertPhone } from "@/lib/phone";
import { isAutoFollowUp, isRevenueDryRun, revenueConfig } from "@/lib/revenue-score";
import {
  APPOINTMENT_STATUS_LABELS,
  appointmentNoticeKey,
  appointmentReminderConfig,
  appointmentServiceLabel,
  businessYmd,
  dueReminderOffset,
  formatAppointmentClock,
  formatAppointmentDay,
  formatRemaining,
  reminderEligibleStatus,
  zonedLocalToUtcMs,
} from "@/lib/appointment-time";
import { adminChatIds, sendTelegramMessage, type TelegramButton } from "@/lib/content-telegram";
import { customerWhatsAppUrl } from "@/lib/service-requests";
import { contact, site } from "@/lib/site";
import { logError, logInfo } from "@/lib/log";
import {
  acceptQuote,
  addRevenueEvent,
  backfillFromServiceRequests,
  clearOperatorPending,
  completeJob,
  createAppointment,
  createJobFromLead,
  createQuoteDraft,
  getLead,
  getOperatorPending,
  latestAppointment,
  claimAppointmentNotice,
  getAppointment,
  listReminderAppointments,
  releaseAppointmentNotice,
  rescheduleAppointment,
  listLeads,
  listUnattendedHotLeads,
  markHotReminded,
  markLeadAlerted,
  markLeadHumanAction,
  markQuoteSent,
  nextBestActions,
  pendingFollowUps,
  revenueSnapshot,
  setAppointmentStatus,
  setOperatorPending,
  setPipeline,
  snoozeHotLead,
  stopFollowUps,
  weeklyFunnel,
} from "@/lib/revenue-store";

export function formatHoy() {
  backfillFromServiceRequests();
  const snap = revenueSnapshot();
  const nba = nextBestActions();
  const marketing = marketingBaseline();
  const dry = isRevenueDryRun() ? "DRY RUN · no se envían mensajes a clientes" : "ASSISTED";
  return [
    "HOMESTEAD · HOY",
    dry,
    `AUTO FOLLOW-UP: ${isAutoFollowUp() ? "ON" : "DISABLED"}`,
    "",
    `Leads calientes: ${snap.hot}`,
    `Seguimientos pendientes: ${snap.followups}`,
    `Cotizaciones abiertas: ${snap.quotes}`,
    `Citas propuestas: ${snap.scheduled}`,
    `Reseñas elegibles: ${snap.reviews}`,
    `Mantenimientos abiertos: ${snap.maintenance}`,
    "",
    `Cola de contenido lista: ${marketing.ready}`,
    marketing.queueLow ? "Pocas piezas listas para publicar." : "",
    "",
    "Prioridad:",
    ...nba.slice(0, 3).map((item, index) => `${index + 1}. ${item.type}${item.leadId ? ` · ${item.leadId}` : ""}\n${item.why}`),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function formatLeads(kind: "all" | "hot") {
  backfillFromServiceRequests();
  const leads = kind === "hot" ? listLeads({ temperature: "HOT", limit: 10 }) : listLeads({ limit: 10 });
  if (!leads.length) return kind === "hot" ? "No hay leads calientes abiertos." : "Aún no hay leads en el motor. Las solicitudes HS existentes se incorporan al abrir /hoy.";
  return leads
    .map((lead) => {
      if (!lead) return "";
      return `${lead.leadId} · ${lead.temperature} · ${lead.stage}\n${lead.name} · ${lead.service || "servicio"}\n${lead.problem.slice(0, 140)}\nSiguiente: ${lead.nextAction}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

export function formatFollowups() {
  const rows = pendingFollowUps();
  if (!rows.length) return "No hay seguimientos pendientes. AUTO FOLLOW-UP permanece DISABLED.";
  return rows
    .map(
      (row) =>
        `${row.lead_id} · ${row.reason}\n${row.name}\nProgramado: ${row.scheduled_at}\nSugerido (no enviado):\n${row.suggested_message}`,
    )
    .join("\n\n");
}

export function formatQuotes() {
  backfillFromServiceRequests();
  const leads = listLeads({ limit: 30 }).filter((lead) => lead && lead.quoteId);
  if (!leads.length) return "No hay cotizaciones. Usa el lead y crea borrador: precio manual, nunca IA.";
  return leads
    .map((lead) => `${lead!.quoteId} · ${lead!.leadId} · ${lead!.stage}`)
    .join("\n");
}

export function formatVentas() {
  const funnel = weeklyFunnel();
  const quoteToWon = funnel.quoteToWon === null ? "n/d" : `${funnel.quoteToWon}%`;
  const leadToWon = funnel.leadToWon === null ? "n/d" : `${funnel.leadToWon}%`;
  return [
    "HOMESTEAD · VENTAS",
    `Leads: ${funnel.leads}`,
    `Ganados: ${funnel.won}`,
    `Cotizado (solo si hay total manual): ${funnel.quotedRevenue}`,
    `Cobrado (solo si hay pago registrado): ${funnel.collectedRevenue}`,
    `Lead→ganado: ${leadToWon}`,
    `Cotización→ganado: ${quoteToWon}`,
    "Sin spend de campañas no se calcula ROI.",
  ].join("\n");
}

export function formatQueHago() {
  const nba = nextBestActions();
  return [
    "¿Qué debo hacer ahora para vender más?",
    "",
    ...nba.map((item, index) => `${index + 1}. ${item.type}${item.leadId ? ` (${item.leadId})` : ""}\n${item.why}\nSi esperas: ${item.ifWait}`),
  ].join("\n\n");
}

export type RevenueCallbackResult = {
  text: string;
  keyboard?: Array<Array<TelegramButton>>;
  mutated: boolean;
};

function serviceLabel(service: string, problem = "") {
  return appointmentServiceLabel(service, problem);
}

function panamaYmd(addDays = 0) {
  return businessYmd(new Date(), addDays);
}

function commercialWindow() {
  return `${revenueConfig.businessHours.start}–${revenueConfig.businessHours.end} ${revenueConfig.businessHours.timezone}`;
}

function customerDraftMessage(lead: NonNullable<ReturnType<typeof getLead>>, date: string, time: string) {
  return `Perfecto, podemos coordinar la visita para el ${date} a las ${time}. ¿Te funciona ese horario?`;
}

export function formatLeadAlert(lead: NonNullable<ReturnType<typeof getLead>>) {
  const test = lead.isTest ? "\nTEST · no es un cliente real\n" : "";
  const preference =
    lead.preferredDate || lead.preferredTimeWindow
      ? [lead.preferredDate, lead.preferredTimeWindow].filter(Boolean).join(" · ")
      : "Sin preferencia aún";
  return [
    "━━━━━━━━━━━━━━━━━━━━━━",
    "🔥 HOMESTEAD · NUEVO LEAD",
    "━━━━━━━━━━━━━━━━━━━━━━",
    test,
    "👤 Cliente:",
    lead.name || "Cliente web",
    "",
    "🛠 Servicio:",
    serviceLabel(lead.service, lead.problem),
    "",
    "📝 Necesidad:",
    lead.problem.slice(0, 280) || "Sin detalle",
    "",
    "📍 Zona:",
    lead.location || "No indicada",
    "",
    "📞 Contacto:",
    alertPhone(lead.phone),
    "",
    "🕐 Preferencia:",
    preference,
    "",
    "🌐 Origen:",
    lead.source === "WEBSITE_AI_CHAT" ? "Web · AI Sales Concierge" : lead.source,
    "",
    "🎯 Prioridad:",
    lead.temperature,
    "",
    "📌 Estado:",
    lead.stage === "NEW" ? "Nuevo" : lead.stage,
    "",
    "💡 Acción recomendada:",
    lead.nextAction === "PROGRAM_SITE_VISIT" ? "Coordinar visita de evaluación" : lead.nextAction,
    "",
    "Lead:",
    lead.leadId,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function leadKeyboard(leadId: string) {
  return [
    [{ text: "📅 PROGRAMAR VISITA", callback_data: `rv:${leadId}:visit` }],
    [
      { text: "💬 CONTACTAR", callback_data: `rv:${leadId}:contact` },
      { text: "💰 PREPARAR COTIZACIÓN", callback_data: `rv:${leadId}:quote` },
    ],
    [
      { text: "👁 VER LEAD", callback_data: `rv:${leadId}:view` },
      { text: "⏰ RECORDAR DESPUÉS", callback_data: `rv:${leadId}:later` },
    ],
    [{ text: "❌ DESCARTAR", callback_data: `rv:${leadId}:stop` }],
  ];
}

function visitKeyboard(leadId: string, hasPreference: boolean) {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [
    [
      { text: "HOY", callback_data: `rv:${leadId}:vt` },
      { text: "MAÑANA", callback_data: `rv:${leadId}:vm` },
    ],
    [
      { text: "ELEGIR FECHA", callback_data: `rv:${leadId}:vd` },
      { text: "VER DISPONIBILIDAD", callback_data: `rv:${leadId}:va` },
    ],
  ];
  if (hasPreference) {
    rows.unshift([{ text: "BUSCAR DISPONIBILIDAD", callback_data: `rv:${leadId}:vp` }]);
  }
  return rows;
}

function confirmKeyboard(leadId: string) {
  return [
    [{ text: "CONFIRMAR CITA", callback_data: `rv:${leadId}:cf` }],
    [{ text: "PREPARAR MENSAJE AL CLIENTE", callback_data: `rv:${leadId}:ok` }],
    [
      { text: "CAMBIAR", callback_data: `rv:${leadId}:visit` },
      { text: "CANCELAR", callback_data: `rv:${leadId}:vx` },
    ],
  ];
}

function reminderKeyboard(leadId: string) {
  return [
    [
      { text: "ATENDER AHORA", callback_data: `rv:${leadId}:now` },
      { text: "RECORDAR MÁS TARDE", callback_data: `rv:${leadId}:later` },
    ],
  ];
}

function visitSummary(lead: NonNullable<ReturnType<typeof getLead>>, date: string, time: string) {
  return [
    "Propuesta interna (aún no confirmada con el cliente)",
    "",
    `Cliente: ${lead.name}`,
    `Servicio: ${serviceLabel(lead.service, lead.problem)}`,
    `Fecha: ${date}`,
    `Hora: ${time}`,
    `Ubicación: ${lead.location || "por confirmar"}`,
    "",
    `Horario comercial: ${commercialWindow()}`,
    "No hay calendario de técnicos conectado. Esta hora es una propuesta según horario de negocio.",
  ].join("\n");
}

export async function sendNewLeadAlert(leadId: string) {
  const lead = getLead(leadId);
  if (!lead) return { sent: 0 };
  if (lead.internalAlertAt) return { sent: 0, duplicate: true as const };
  const chats = adminChatIds();
  if (!chats.length) {
    logError("TelegramLeadAlertFailed", { contentJobId: leadId, stage: "no_admin_chat" });
    return { sent: 0 };
  }
  const text = formatLeadAlert(lead);
  const keyboard = leadKeyboard(leadId);
  let sent = 0;
  for (const chatId of chats) {
    let delivered = false;
    for (let attempt = 0; attempt < 2 && !delivered; attempt += 1) {
      const id = await sendTelegramMessage({ chatId, text, keyboard });
      if (id) {
        sent += 1;
        delivered = true;
      }
    }
  }
  if (!sent) {
    logError("TelegramLeadAlertFailed", { contentJobId: leadId, stage: "api_zero" });
    return { sent: 0 };
  }
  markLeadAlerted(leadId);
  logInfo("TelegramLeadAlertSent", { contentJobId: leadId, stage: String(sent) });
  return { sent };
}

export async function runHotLeadReminders() {
  const minutes = contactRegion().hotLeadAttentionMinutes;
  const leads = listUnattendedHotLeads(minutes * 60_000);
  let sent = 0;
  for (const lead of leads) {
    if (!lead || lead.doNotContact) continue;
    markHotReminded(lead.leadId);
    const waited = Math.max(
      1,
      Math.round((Date.now() - Date.parse(lead.leadCreatedAt || "")) / 60000) || 1,
    );
    const text = [
      "━━━━━━━━━━━━━━━━━━━━",
      "⏰ LEAD SIN ATENDER",
      "━━━━━━━━━━━━━━━━━━━━",
      "",
      `Cliente: ${lead.name}`,
      `Necesidad: ${lead.problem.slice(0, 180)}`,
      `Tiempo pendiente: ${waited} min`,
      "Siguiente acción: Programar visita.",
      "",
      lead.leadId,
    ].join("\n");
    for (const chatId of adminChatIds()) {
      const id = await sendTelegramMessage({ chatId, text, keyboard: reminderKeyboard(lead.leadId) });
      if (id) sent += 1;
    }
  }
  return { sent, checked: leads.length, minutes };
}

export async function applyRevenueCallback(data: string, chatId = ""): Promise<RevenueCallbackResult> {
  const parts = data.split(":");
  if (parts[0] !== "rv" || parts.length < 3) return { text: "Acción no reconocida.", mutated: false };
  const leadId = parts[1];
  const action = parts[2];
  const lead = getLead(leadId);
  if (!lead) return { text: "Lead no encontrado.", mutated: false };
  if (lead.doNotContact && action !== "view") {
    return { text: `Este cliente pidió no ser contactado. No hay seguimiento comercial.\n${leadId}`, mutated: false };
  }
  if (action !== "view") markLeadHumanAction(leadId);

  if (action === "stop") {
    stopFollowUps(leadId, "NO_RESPONSE");
    return { text: `Seguimientos detenidos para ${leadId}.`, mutated: true };
  }
  if (action === "contact") {
    setPipeline(leadId, "CONTACTED");
    const wa = customerWhatsAppUrl(
      lead.phone,
      `Hola ${lead.name}, le contactamos de Homestead Services con relación a su solicitud ${lead.leadId}.`,
    );
    const lines = [
      `CONTACTAR · ${leadId}`,
      `Cliente: ${lead.name}`,
      `Teléfono: ${lead.phone}`,
      "",
    ];
    if (wa) {
      lines.push("WhatsApp del cliente (tú escribes):", wa);
    } else {
      lines.push("CONTACT CUSTOMER MANUALLY.");
      lines.push("No hay canal saliente automático (WhatsApp/SMS de Homestead no configurado).");
    }
    if (!contact.whatsapp.isConfigured) {
      lines.push("No hay WhatsApp público de Homestead. Llama o escribe desde tu canal.");
    }
    return { text: lines.join("\n"), keyboard: leadKeyboard(leadId), mutated: true };
  }
  if (action === "quote") {
    const draft = createQuoteDraft(leadId);
    if (!draft) return { text: "No se pudo crear cotización.", mutated: false };
    const visit = ["painting", "repairs", "remodeling", "ac", "multiple"].includes(lead.service);
    const siteVisit = visit ? "SITE VISIT REQUIRED. " : "";
    return {
      text: `${siteVisit}Borrador ${draft.quote_number} · ${draft.pricing_status}. La IA no inventa precio. Carga la tarifa a mano después de evaluar.`,
      keyboard: leadKeyboard(leadId),
      mutated: true,
    };
  }
  if (action === "sendq") {
    if (!lead.quoteId) return { text: "No hay cotización.", mutated: false };
    const sent = markQuoteSent(lead.quoteId);
    if (sent && "error" in sent) return { text: "NEEDS_MANUAL_PRICING. No se envía sin tarifa autorizada.", mutated: false };
    return {
      text: isRevenueDryRun() ? "DRY RUN: no se envió al cliente. Estado interno QUOTE_SENT simulado solo si hay precio." : "Cotización marcada enviada.",
      mutated: true,
    };
  }
  if (action === "accept") {
    if (!lead.quoteId) return { text: "No hay cotización.", mutated: false };
    acceptQuote(lead.quoteId);
    return { text: `Cotización aceptada. Siguiente: programar ${leadId}.`, mutated: true };
  }
  if (action === "job") {
    const job = createJobFromLead(leadId);
    return { text: `Trabajo ${job} creado (no publicado a cliente).`, mutated: true };
  }
  if (action === "doneok") {
    if (!lead.jobId) return { text: "No hay trabajo.", mutated: false };
    completeJob(lead.jobId, { satisfaction: "YES" });
    return { text: "Trabajo completado. Cliente satisfecho → elegible a reseña. No se pidió reseña automática.", mutated: true };
  }
  if (action === "donebad") {
    if (!lead.jobId) return { text: "No hay trabajo.", mutated: false };
    completeJob(lead.jobId, { satisfaction: "NO" });
    return { text: "SERVICE RECOVERY. No se solicitará reseña.", mutated: true };
  }
  if (action === "view") {
    const admin = `${site.url.replace(/\/$/, "")}/admin/solicitudes/${leadId}`;
    return { text: `${formatLeadAlert(lead)}\n\nFicha: ${admin}`, keyboard: leadKeyboard(leadId), mutated: false };
  }
  if (action === "later") {
    snoozeHotLead(leadId, contactRegion().hotLeadAttentionMinutes);
    return { text: `Recordatorio pospuesto ${contactRegion().hotLeadAttentionMinutes} min.\n${leadId}`, mutated: true };
  }
  if (action === "now") {
    return {
      text: formatLeadAlert(getLead(leadId) || lead),
      keyboard: leadKeyboard(leadId),
      mutated: true,
    };
  }
  if (action === "visit" || action === "appt") {
    const preference =
      lead.preferredDate || lead.preferredTimeWindow
        ? `\n\nPreferencia del cliente:\n${[lead.preferredDate, lead.preferredTimeWindow].filter(Boolean).join(" · ")}`
        : "";
    return {
      text: `Programar visita · ${leadId}${preference}\n\nHorario comercial: ${commercialWindow()}\nElige una ventana para PROPONER. No confirma sola.`,
      keyboard: visitKeyboard(leadId, Boolean(lead.preferredDate || lead.preferredTimeWindow)),
      mutated: false,
    };
  }
  if (action === "va") {
    return {
      text: `Disponibilidad real: horario comercial ${commercialWindow()}. No hay agenda de técnicos conectada. Elige HOY, MAÑANA o una fecha para proponer.`,
      keyboard: visitKeyboard(leadId, Boolean(lead.preferredTimeWindow)),
      mutated: false,
    };
  }
  if (action === "vd") {
    if (chatId) setOperatorPending(chatId, leadId, "date");
    return {
      text: "Escribe la fecha y hora en hora de Panamá. Ejemplo: 25/08 15:30",
      mutated: false,
    };
  }
  if (action === "vt" || action === "vm" || action === "vp") {
    const days = action === "vt" ? 0 : 1;
    const date = panamaYmd(days);
    const time = action === "vp" && /3|15/.test(lead.preferredTimeWindow || "") ? "15:00" : "16:00";
    const proposed = await proposeVisitSlot(leadId, date, time);
    setPipeline(leadId, "SITE_VISIT_NEEDED");
    return {
      text: `${visitSummary(lead, date, time)}\n\nCita interna: ${proposed.id} · ${proposed.status}`,
      keyboard: confirmKeyboard(leadId),
      mutated: true,
    };
  }
  if (action === "cf") {
    const appt = latestAppointment(leadId);
    if (!appt) return { text: "No hay propuesta de visita.", mutated: false };
    setAppointmentStatus(appt.appointment_id, "CONFIRMED");
    await notifyAppointmentEvent(appt.appointment_id, "CONFIRMED");
    return {
      text: `Cita confirmada internamente.\n${appt.appointment_id}\n${appt.date} ${appt.start_time}`,
      keyboard: appointmentKeyboard(appt.appointment_id, leadId),
      mutated: true,
    };
  }
  if (action === "ok") {
    const appt = latestAppointment(leadId);
    if (!appt) return { text: "No hay propuesta de visita.", mutated: false };
    const message = customerDraftMessage(lead, appt.date, appt.start_time);
    const lines = [
      "Mensaje para el cliente (aún NO enviado):",
      "",
      `"${message}"`,
      "",
      "CONTACT CUSTOMER MANUALLY.",
      "El chat del sitio no entrega mensajes si el visitante ya cerró la página.",
      "WhatsApp/SMS saliente de Homestead no está configurado.",
      "",
      `Estado de la visita: ${appt.status} (no CONFIRMED hasta que el cliente acepte).`,
    ];
    return { text: lines.join("\n"), keyboard: leadKeyboard(leadId), mutated: true };
  }
  if (action === "vx") {
    const appt = latestAppointment(leadId);
    if (appt) {
      setAppointmentStatus(appt.appointment_id, "CANCELLED");
      await notifyAppointmentEvent(appt.appointment_id, "CANCELLED");
    }
    return { text: `Cita cancelada.\n${leadId}`, keyboard: leadKeyboard(leadId), mutated: true };
  }
  return { text: "Acción no reconocida.", mutated: false };
}

export function bindOperatorChat(chatId: string, leadId: string, expect: string) {
  setOperatorPending(chatId, leadId, expect);
}

export async function consumeOperatorDate(chatId: string, text: string): Promise<RevenueCallbackResult | null> {
  const pending = getOperatorPending(chatId);
  if (!pending || pending.expect !== "date") return null;
  clearOperatorPending(chatId);
  const lead = getLead(pending.lead_id);
  if (!lead) return { text: "Lead no encontrado.", mutated: false };
  const match = text.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-]\d{2,4})?\s+(\d{1,2})(?::(\d{2}))?/);
  if (!match) {
    return { text: "No entendí la fecha. Ejemplo: 25/08 15:30", mutated: false };
  }
  const year = Number(new Intl.DateTimeFormat("en-US", { timeZone: revenueConfig.businessHours.timezone, year: "numeric" }).format(new Date()));
  const date = `${year}-${String(match[2]).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}`;
  const time = `${String(match[3]).padStart(2, "0")}:${String(match[4] || "00").padStart(2, "0")}`;
  const id = await proposeVisitSlot(lead.leadId, date, time);
  markLeadHumanAction(lead.leadId);
  setPipeline(lead.leadId, "SITE_VISIT_NEEDED");
  return {
    text: `${visitSummary(lead, date, time)}\n\nCita interna: ${id.id} · ${id.status}`,
    keyboard: confirmKeyboard(lead.leadId),
    mutated: true,
  };
}

async function proposeVisitSlot(leadId: string, date: string, time: string) {
  const latest = latestAppointment(leadId);
  if (latest && ["REQUESTED", "PROPOSED", "CONFIRMED", "RESCHEDULED"].includes(latest.status)) {
    const moved = rescheduleAppointment(latest.appointment_id, date, time);
    if (moved && (latest.status === "CONFIRMED" || latest.status === "RESCHEDULED")) {
      await notifyAppointmentEvent(latest.appointment_id, "RESCHEDULED", {
        previousDate: latest.date,
        previousTime: latest.start_time,
      });
    }
    return { id: latest.appointment_id, status: moved?.status || latest.status };
  }
  const created = createAppointment(leadId, date, time, "PROPOSED", { source: "TELEGRAM" });
  return { id: created, status: "PROPOSED" };
}

function appointmentUrl(appointmentId: string) {
  return `${site.url.replace(/\/$/, "")}/admin/citas?id=${encodeURIComponent(appointmentId)}`;
}

export function appointmentKeyboard(appointmentId: string, leadId: string): TelegramButton[][] {
  return [
    [{ text: "👁 VER CITA", url: appointmentUrl(appointmentId) }],
    [
      { text: "💬 CONTACTAR", callback_data: `rv:${leadId}:contact` },
      { text: "🔄 REPROGRAMAR", callback_data: `rv:${leadId}:visit` },
    ],
  ];
}

function statusLabel(status: string) {
  return APPOINTMENT_STATUS_LABELS[status as keyof typeof APPOINTMENT_STATUS_LABELS] || status;
}

export async function notifyAppointmentEvent(
  appointmentId: string,
  eventType: "CONFIRMED" | "RESCHEDULED" | "CANCELLED" | "REMINDER",
  extra?: { previousDate?: string; previousTime?: string; offsetLabel?: string; remainingMs?: number },
) {
  const appointment = getAppointment(appointmentId);
  if (!appointment) return { sent: 0 };
  if (eventType === "REMINDER" && !reminderEligibleStatus(appointment.status)) {
    return { sent: 0, skipped: appointment.status };
  }
  if (eventType === "CONFIRMED" && appointment.status !== "CONFIRMED" && appointment.status !== "RESCHEDULED") {
    return { sent: 0, skipped: appointment.status };
  }
  if (eventType === "CANCELLED" && appointment.status !== "CANCELLED") {
    return { sent: 0, skipped: appointment.status };
  }
  const extraKey =
    eventType === "REMINDER"
      ? `${extra?.offsetLabel || ""}:${appointment.date}:${appointment.startTime}`
      : eventType === "RESCHEDULED"
        ? `${appointment.date}:${appointment.startTime}`
        : "";
  const noticeKey = appointmentNoticeKey(appointment.appointmentId, eventType, appointment.version, extraKey);
  if (!claimAppointmentNotice(noticeKey, appointment.appointmentId, eventType, appointment.version)) {
    return { sent: 0, duplicate: true as const };
  }
  const chats = adminChatIds();
  if (!chats.length) {
    releaseAppointmentNotice(noticeKey);
    return { sent: 0 };
  }
  const text = formatAppointmentTelegram(appointment, eventType, extra);
  const keyboard = appointmentKeyboard(appointment.appointmentId, appointment.leadId);
  let sent = 0;
  for (const chatId of chats) {
    const id = await sendTelegramMessage({ chatId, text, keyboard });
    if (id) sent += 1;
  }
  if (!sent) {
    releaseAppointmentNotice(noticeKey);
    logError("AppointmentTelegramFailed", { contentJobId: appointmentId, stage: eventType });
    return { sent: 0 };
  }
  addRevenueEvent(appointment.leadId, eventType === "REMINDER" ? "REMINDER_SENT" : `APPOINTMENT_${eventType}_NOTIFIED`);
  logInfo("AppointmentTelegramSent", { contentJobId: appointmentId, stage: `${eventType}:${sent}` });
  return { sent };
}

function formatAppointmentTelegram(
  appointment: NonNullable<ReturnType<typeof getAppointment>>,
  eventType: "CONFIRMED" | "RESCHEDULED" | "CANCELLED" | "REMINDER",
  extra?: { previousDate?: string; previousTime?: string; offsetLabel?: string; remainingMs?: number },
) {
  if (eventType === "RESCHEDULED") {
    return [
      "🔄 CITA REPROGRAMADA",
      "",
      `Cliente: ${appointment.customerName}`,
      `Servicio: ${appointment.serviceLabel}`,
      extra?.previousDate
        ? `Anterior: ${formatAppointmentDay(extra.previousDate)} ${formatAppointmentClock(extra.previousTime || "")}`
        : "",
      `Nueva: ${formatAppointmentDay(appointment.date)} ${formatAppointmentClock(appointment.startTime)}`,
      `Estado: ${statusLabel(appointment.status).toUpperCase()}`,
    ]
      .filter((line) => line !== "")
      .join("\n");
  }
  if (eventType === "CANCELLED") {
    return [
      "❌ CITA CANCELADA",
      "",
      `Cliente: ${appointment.customerName}`,
      `Servicio: ${appointment.serviceLabel}`,
      `Fecha: ${formatAppointmentDay(appointment.date)}`,
      `Hora: ${formatAppointmentClock(appointment.startTime)}`,
      "No se enviarán recordatorios de esta cita.",
    ].join("\n");
  }
  if (eventType === "REMINDER") {
    const remaining = extra?.remainingMs ? formatRemaining(extra.remainingMs) : extra?.offsetLabel || "";
    return [
      "━━━━━━━━━━━━━━━━━━━━━━",
      "⏰ HOMESTEAD · CITA PRÓXIMA",
      "━━━━━━━━━━━━━━━━━━━━━━",
      "",
      `📅 ${formatAppointmentDay(appointment.date)} · ${formatAppointmentClock(appointment.startTime)}`,
      "",
      "👤 Cliente:",
      appointment.customerName,
      "",
      "🛠 Servicio:",
      appointment.serviceLabel,
      "",
      "📍 Zona:",
      appointment.zone || "Por confirmar",
      "",
      "⏳ Faltan:",
      remaining,
    ].join("\n");
  }
  return [
    "━━━━━━━━━━━━━━━━━━━━━━",
    "📅 NUEVA CITA — HOMESTEAD",
    "━━━━━━━━━━━━━━━━━━━━━━",
    "",
    appointment.leadId,
    "",
    `👤 ${appointment.customerName}`,
    `🛠 ${appointment.serviceLabel}`,
    `📍 ${appointment.zone || "Por confirmar"}`,
    "",
    `📆 ${formatAppointmentDay(appointment.date)}`,
    `🕒 ${formatAppointmentClock(appointment.startTime)}`,
    "",
    `📞 ${alertPhone(appointment.phone) || "No registrado"}`,
    "",
    `Origen: ${appointment.originLabel || "Homestead"}`,
    "",
    `Estado: ${statusLabel(appointment.status).toUpperCase()}`,
  ].join("\n");
}

export async function runAppointmentReminders(now = Date.now()) {
  const config = appointmentReminderConfig();
  if (!config.enabled) return { sent: 0, skipped: 0, enabled: false };
  const appointments = listReminderAppointments();
  let sent = 0;
  let skipped = 0;
  for (const item of appointments) {
    const fresh = getAppointment(item.appointmentId);
    if (!fresh || !reminderEligibleStatus(fresh.status)) {
      skipped += 1;
      continue;
    }
    const start = zonedLocalToUtcMs(fresh.date, fresh.startTime, config.timezone);
    if (!Number.isFinite(start)) {
      skipped += 1;
      continue;
    }
    const remaining = start - now;
    const due = dueReminderOffset(remaining, config.offsets);
    if (!due) {
      skipped += 1;
      continue;
    }
    const result = await notifyAppointmentEvent(fresh.appointmentId, "REMINDER", {
      offsetLabel: due.label,
      remainingMs: remaining,
    });
    if (result.sent) sent += result.sent;
    else skipped += 1;
  }
  return { sent, skipped, enabled: true, checked: appointments.length };
}
