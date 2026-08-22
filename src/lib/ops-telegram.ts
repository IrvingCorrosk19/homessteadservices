import { site } from "@/lib/site";
import { customerWhatsAppUrl, getRequestByPublicId } from "@/lib/service-requests";
import { getAppointment, getLead, latestAppointment } from "@/lib/revenue-store";
import { listJobsByStatus } from "@/lib/content-catalog";
import {
  appointmentServiceLabel,
  businessYmd,
  formatAppointmentClock,
  formatAppointmentDay,
} from "@/lib/appointment-time";
import { agoLabel, opsConfig } from "@/lib/ops-config";
import {
  commandCenterSummary,
  countPendingRequests,
  countRescueLeads,
  dismissLead,
  listAgenda,
  listPendingRequests,
  listRescueLeads,
  markEntityContacted,
  recordOpsAudit,
  snoozeEntity,
  todayMetrics,
  upcomingAgenda,
} from "@/lib/ops-store";
import { sendTelegramMessage, type TelegramButton } from "@/lib/content-telegram";
import { logInfo } from "@/lib/log";

const USER_ERROR = "No pudimos actualizarlo en este momento. Intenta nuevamente.";

function homeKeyboard(includeTest: boolean): TelegramButton[][] {
  const flag = includeTest ? ":1" : "";
  return [
    [
      { text: "🔥 Oportunidades", callback_data: `cc:l:0${flag}` },
      { text: "📅 Agenda", callback_data: `cc:a:0${flag}` },
    ],
    [
      { text: "📥 Solicitudes", callback_data: `cc:r:0${flag}` },
      { text: "🔧 Seguimiento", callback_data: `cc:l:0${flag}` },
    ],
    [
      { text: "📸 Marketing", callback_data: "cc:m" },
      { text: "📊 Resumen", callback_data: `cc:s${flag}` },
    ],
    [
      {
        text: includeTest ? "Ocultar pruebas" : "Ver pruebas",
        callback_data: includeTest ? "cc:h" : "cc:h:1",
      },
    ],
  ];
}

function pager(prefix: string, page: number, total: number, includeTest: boolean): TelegramButton[] {
  const pages = Math.max(1, Math.ceil(total / opsConfig().pageSize));
  const flag = includeTest ? ":1" : "";
  const buttons: TelegramButton[] = [];
  if (page > 0) buttons.push({ text: "◀", callback_data: `${prefix}:${page - 1}${flag}` });
  buttons.push({ text: `${page + 1}/${pages}`, callback_data: "cc:h" });
  if (page + 1 < pages) buttons.push({ text: "▶", callback_data: `${prefix}:${page + 1}${flag}` });
  return buttons;
}

export function commandCenterHome(includeTest = false) {
  const snap = commandCenterSummary(includeTest);
  recordOpsAudit({ action: "COMMAND_CENTER_OPENED", entityType: "ops", entityId: includeTest ? "test" : "live" });
  return {
    text: [
      "🏠 HOMESTEAD",
      "Centro de operaciones",
      includeTest ? "Modo pruebas" : "",
      "",
      `🔥 ${snap.rescue} oportunidades necesitan atención`,
      `📥 ${snap.pendingRequests} solicitudes nuevas`,
      `📅 ${snap.appointmentsToday} citas hoy`,
      `⏱ ${snap.overdueFollowups} seguimientos vencidos`,
      `📸 ${snap.contentPending} contenido pendiente`,
    ]
      .filter((line) => line !== "")
      .join("\n"),
    keyboard: homeKeyboard(includeTest),
  };
}

function requestLocation(message: string) {
  const zone = message.match(/Zona:\s*([^\n.]+)/i);
  return zone?.[1]?.trim() || "";
}

export function requestsView(page = 0, includeTest = false) {
  const total = countPendingRequests(includeTest);
  const rows = listPendingRequests(includeTest, page * opsConfig().pageSize);
  if (!rows.length) {
    return {
      text: "📥 SOLICITUDES\n\nNo hay solicitudes nuevas.",
      keyboard: [[{ text: "⬅ Inicio", callback_data: includeTest ? "cc:h:1" : "cc:h" }]],
    };
  }
  const lines = ["📥 SOLICITUDES", ""];
  const buttons: TelegramButton[][] = [[]];
  rows.forEach((row, index) => {
    const loc = requestLocation(row.message);
    lines.push(`${index + 1}. ${row.public_id}`);
    lines.push(`   ${appointmentServiceLabel(row.service, row.message)}`);
    if (loc) lines.push(`   ${loc}`);
    lines.push(`   ${agoLabel(row.created_at)}`);
    lines.push("");
    buttons[0].push({ text: String(index + 1), callback_data: `cc:d:${row.public_id}` });
  });
  const nav = pager("cc:r", page, total, includeTest);
  if (nav.length) buttons.push(nav);
  buttons.push([{ text: "⬅ Inicio", callback_data: includeTest ? "cc:h:1" : "cc:h" }]);
  return { text: lines.join("\n").trim(), keyboard: buttons };
}

export function requestDetail(publicId: string) {
  const request = getRequestByPublicId(publicId);
  if (!request) return { text: "Esta solicitud ya fue actualizada.", keyboard: [[{ text: "⬅ Inicio", callback_data: "cc:h" }]] };
  const loc = requestLocation(request.message);
  const wa = customerWhatsAppUrl(request.phone);
  const tel = request.phone.replace(/[^\d+]/g, "");
  const admin = `${site.url.replace(/\/$/, "")}/admin/solicitudes/${request.publicId}`;
  const keyboard: TelegramButton[][] = [];
  const contact: TelegramButton[] = [];
  if (tel) contact.push({ text: "📞 Contactar", url: `tel:${tel}` });
  if (wa) contact.push({ text: "💬 WhatsApp", url: wa });
  if (contact.length) keyboard.push(contact);
  keyboard.push([{ text: "✅ Marcar atendido", callback_data: `cc:c:${request.publicId}` }]);
  const appt = latestAppointment(request.publicId);
  if (appt?.appointment_id) {
    keyboard.push([{ text: "📅 Ver cita", callback_data: `cc:g:${appt.appointment_id}` }]);
  }
  keyboard.push([{ text: "🌐 Abrir ficha", url: admin }]);
  keyboard.push([{ text: "⬅ Volver", callback_data: "cc:r:0" }]);
  return {
    text: [
      `📥 ${request.publicId}`,
      "",
      `👤 ${request.name}`,
      `🛠 ${appointmentServiceLabel(request.service, request.message)}`,
      loc ? `📍 ${loc}` : "",
      `🕐 ${agoLabel(request.createdAt)}`,
      "",
      "Problema:",
      request.message.slice(0, 280),
      "",
      `📞 ${request.phone}`,
    ]
      .filter((line) => line !== "")
      .join("\n"),
    keyboard,
  };
}

export function rescueView(page = 0, includeTest = false) {
  const total = countRescueLeads(includeTest);
  const rows = listRescueLeads(includeTest, page * opsConfig().pageSize);
  if (!rows.length) {
    return {
      text: "🔥 OPORTUNIDADES\n\nNo hay leads pendientes de rescate.",
      keyboard: [[{ text: "⬅ Inicio", callback_data: includeTest ? "cc:h:1" : "cc:h" }]],
    };
  }
  const lines = ["🔥 OPORTUNIDADES", ""];
  const buttons: TelegramButton[][] = [[]];
  rows.forEach((lead, index) => {
    if (!lead) return;
    lines.push(`${index + 1}. ${lead.leadId}`);
    lines.push(`   ${appointmentServiceLabel(lead.service, lead.problem)}`);
    if (lead.location) lines.push(`   ${lead.location}`);
    lines.push(`   ${agoLabel(lead.leadCreatedAt)}`);
    lines.push("");
    buttons[0].push({ text: String(index + 1), callback_data: `cc:e:${lead.leadId}` });
  });
  const nav = pager("cc:l", page, total, includeTest);
  if (nav.length) buttons.push(nav);
  buttons.push([{ text: "⬅ Inicio", callback_data: includeTest ? "cc:h:1" : "cc:h" }]);
  return { text: lines.join("\n").trim(), keyboard: buttons };
}

export function rescueDetail(leadId: string) {
  const lead = getLead(leadId);
  if (!lead || lead.firstHumanActionAt || lead.doNotContact) {
    return { text: "Esta solicitud ya fue actualizada.", keyboard: [[{ text: "⬅ Inicio", callback_data: "cc:h" }]] };
  }
  const wa = customerWhatsAppUrl(lead.phone);
  const tel = lead.phone.replace(/[^\d+]/g, "");
  const keyboard: TelegramButton[][] = [];
  const contact: TelegramButton[] = [];
  if (tel) contact.push({ text: "📞 Contactar", url: `tel:${tel}` });
  if (wa) contact.push({ text: "💬 WhatsApp", url: wa });
  if (contact.length) keyboard.push(contact);
  keyboard.push([
    { text: "✅ Atendido", callback_data: `cc:c:${lead.leadId}` },
    { text: "🕒 15 min", callback_data: `cc:z:${lead.leadId}:15` },
  ]);
  keyboard.push([
    { text: "🕒 30 min", callback_data: `cc:z:${lead.leadId}:30` },
    { text: "❌ Descartar", callback_data: `cc:x:${lead.leadId}` },
  ]);
  keyboard.push([{ text: "⬅ Volver", callback_data: "cc:l:0" }]);
  return {
    text: [
      "🔥 OPORTUNIDAD SIN CERRAR",
      lead.isTest ? "TEST · no es un cliente real" : "",
      "",
      lead.name && lead.name !== "Cliente web" ? `👤 ${lead.name}` : "",
      `🛠 ${appointmentServiceLabel(lead.service, lead.problem)}`,
      lead.location ? `📍 ${lead.location}` : "",
      `🕐 ${agoLabel(lead.leadCreatedAt)}`,
      "",
      lead.problem.slice(0, 220),
      "",
      `📞 ${lead.phone}`,
      lead.leadId,
    ]
      .filter((line) => line !== "")
      .join("\n"),
    keyboard,
  };
}

export function agendaView(offsetDays = 0, includeTest = false) {
  const ymd = businessYmd(new Date(), offsetDays);
  const rows = listAgenda(ymd, includeTest);
  const title = offsetDays === 0 ? "HOY" : formatAppointmentDay(ymd);
  const lines = [`📅 AGENDA — ${title.toUpperCase()}`, ""];
  const buttons: TelegramButton[][] = [];
  if (!rows.length) lines.push("No hay citas este día.");
  rows.forEach((item, index) => {
    lines.push(`${formatAppointmentClock(item.startTime)} — ${item.appointmentId}`);
    lines.push(`${appointmentServiceLabel(item.service, item.problem)}`);
    if (item.zone) lines.push(item.zone);
    lines.push("");
    if (index < 8) {
      buttons.push([{ text: `${formatAppointmentClock(item.startTime)} ${item.appointmentId}`, callback_data: `cc:g:${item.appointmentId}` }]);
    }
  });
  buttons.push([
    { text: "◀ Ayer", callback_data: `cc:a:${offsetDays - 1}${includeTest ? ":1" : ""}` },
    { text: "Mañana ▶", callback_data: `cc:a:${offsetDays + 1}${includeTest ? ":1" : ""}` },
  ]);
  buttons.push([{ text: "📆 Próximas", callback_data: `cc:n${includeTest ? ":1" : ""}` }]);
  buttons.push([{ text: "⬅ Inicio", callback_data: includeTest ? "cc:h:1" : "cc:h" }]);
  return { text: lines.join("\n").trim(), keyboard: buttons };
}

export function upcomingView(includeTest = false) {
  const rows = upcomingAgenda(includeTest);
  const lines = ["📅 PRÓXIMAS", ""];
  const buttons: TelegramButton[][] = [];
  if (!rows.length) lines.push("No hay citas en los próximos 7 días.");
  rows.forEach((item) => {
    lines.push(`${formatAppointmentDay(item.date)} ${formatAppointmentClock(item.startTime)} — ${item.appointmentId}`);
    lines.push(appointmentServiceLabel(item.service, item.problem));
    lines.push("");
    buttons.push([{ text: `${item.appointmentId}`, callback_data: `cc:g:${item.appointmentId}` }]);
  });
  buttons.push([{ text: "⬅ Agenda", callback_data: includeTest ? "cc:a:0:1" : "cc:a:0" }]);
  return { text: lines.join("\n").trim(), keyboard: buttons };
}

export function appointmentDetail(appointmentId: string) {
  const item = getAppointment(appointmentId);
  if (!item) return { text: "Esta cita ya no está disponible.", keyboard: [[{ text: "⬅ Agenda", callback_data: "cc:a:0" }]] };
  const lead = getLead(item.leadId);
  const wa = customerWhatsAppUrl(item.phone);
  const tel = String(item.phone || "").replace(/[^\d+]/g, "");
  const calendar = `${site.url.replace(/\/$/, "")}/admin/citas`;
  const keyboard: TelegramButton[][] = [];
  const contact: TelegramButton[] = [];
  if (tel) contact.push({ text: "📞 Contactar", url: `tel:${tel}` });
  if (wa) contact.push({ text: "💬 WhatsApp", url: wa });
  if (contact.length) keyboard.push(contact);
  keyboard.push([{ text: "🌐 Abrir calendario", url: calendar }]);
  keyboard.push([{ text: "⬅ Agenda", callback_data: "cc:a:0" }]);
  return {
    text: [
      "📅 CITA",
      "",
      item.appointmentId,
      "",
      lead?.name ? `👤 ${lead.name}` : "",
      `🛠 ${appointmentServiceLabel(item.service, item.problem)}`,
      item.zone ? `📍 ${item.zone}` : "",
      `📆 ${formatAppointmentDay(item.date)}`,
      `🕓 ${formatAppointmentClock(item.startTime)}`,
      "",
      `Solicitud: ${item.leadId}`,
      item.phone ? `📞 ${item.phone}` : "",
    ]
      .filter((line) => line !== "")
      .join("\n"),
    keyboard,
  };
}

export function marketingView() {
  const pending = listJobsByStatus(["AWAITING_APPROVAL", "READY_FOR_REVIEW", "RECEIVING"]);
  const lines = ["📸 MARKETING", "", pending.length ? `${pending.length} en revisión` : "Nada pendiente de revisión."];
  pending.slice(0, 8).forEach((job) => {
    lines.push(`${job.publicId} · ${job.status}`);
  });
  lines.push("", "Content Studio se abre con /publicar");
  return {
    text: lines.join("\n"),
    keyboard: [[{ text: "⬅ Inicio", callback_data: "cc:h" }]],
  };
}

export function summaryView(includeTest = false) {
  const metrics = todayMetrics(includeTest);
  const conversion =
    metrics.conversionPct === null ? "" : `\nSolicitud → cita: ${metrics.conversionPct}%`;
  return {
    text: [
      "📊 HOMESTEAD — HOY",
      "",
      `📥 Solicitudes: ${metrics.requests}`,
      `🔥 Pendientes: ${metrics.pending}`,
      `📞 Atendidas: ${metrics.contacted}`,
      `📅 Citas creadas: ${metrics.appointmentsCreated}`,
      `🔧 Citas de hoy: ${metrics.appointmentsToday}`,
      conversion,
    ]
      .filter((line) => line !== "")
      .join("\n"),
    keyboard: [[{ text: "⬅ Inicio", callback_data: includeTest ? "cc:h:1" : "cc:h" }]],
  };
}

function parseFlag(parts: string[], index: number) {
  return parts[index] === "1";
}

export async function applyCommandCenterCallback(data: string, chatId: string, messageId?: number) {
  const parts = data.split(":");
  if (parts[0] !== "cc") return { text: "Acción no reconocida." };
  const action = parts[1] || "h";
  let view: { text: string; keyboard?: TelegramButton[][] };
  try {
    if (action === "h") view = commandCenterHome(parseFlag(parts, 2));
    else if (action === "r") view = requestsView(Number(parts[2] || 0), parseFlag(parts, 3));
    else if (action === "d") view = requestDetail(parts.slice(2).join(":"));
    else if (action === "l") view = rescueView(Number(parts[2] || 0), parseFlag(parts, 3));
    else if (action === "e") view = rescueDetail(parts.slice(2).join(":"));
    else if (action === "a") view = agendaView(Number(parts[2] || 0), parseFlag(parts, 3));
    else if (action === "n") view = upcomingView(parseFlag(parts, 2));
    else if (action === "g") view = appointmentDetail(parts.slice(2).join(":"));
    else if (action === "m") view = marketingView();
    else if (action === "s") view = summaryView(parseFlag(parts, 2));
    else if (action === "c") {
      const id = parts.slice(2).join(":");
      const result = markEntityContacted(id, chatId.slice(0, 24));
      if (!result.ok) view = { text: "Esta solicitud ya fue actualizada.", keyboard: [[{ text: "⬅ Inicio", callback_data: "cc:h" }]] };
      else {
        view = {
          text: result.already ? "✅ Ya estaba atendida.\n\nEsta solicitud ya fue actualizada." : "✅ Marcado como atendido\n\nAtendido hace unos segundos.",
          keyboard: [[{ text: "⬅ Inicio", callback_data: "cc:h" }]],
        };
      }
    } else if (action === "z") {
      const minutesRaw = Number(parts[parts.length - 1] || 15);
      const minutes = [15, 30, 60].includes(minutesRaw) ? minutesRaw : 15;
      const id = parts.slice(2, -1).join(":");
      snoozeEntity(id, minutes, chatId.slice(0, 24));
      view = {
        text: `🕒 Recordatorio en ${minutes} min.\n\nNo te avisaremos antes.`,
        keyboard: [[{ text: "⬅ Inicio", callback_data: "cc:h" }]],
      };
    } else if (action === "v") {
      view = { text: "No hay un teléfono válido para llamar.", keyboard: [[{ text: "⬅ Inicio", callback_data: "cc:h" }]] };
    } else if (action === "x") {
      const id = parts.slice(2).join(":");
      const result = dismissLead(id, chatId.slice(0, 24));
      view = {
        text: result.ok ? "❌ Oportunidad descartada.\n\nEl lead no se borró." : USER_ERROR,
        keyboard: [[{ text: "⬅ Inicio", callback_data: "cc:h" }]],
      };
    } else view = commandCenterHome();
  } catch {
    view = { text: USER_ERROR, keyboard: [[{ text: "⬅ Inicio", callback_data: "cc:h" }]] };
  }
  await sendTelegramMessage({
    chatId,
    text: view.text,
    keyboard: view.keyboard,
    editMessageId: messageId || null,
  });
  return view;
}

export async function sendCommandCenter(chatId: string, includeTest = false) {
  const view = commandCenterHome(includeTest);
  await sendTelegramMessage({ chatId, text: view.text, keyboard: view.keyboard });
}

export async function deliverOpsTelegram(data: Record<string, unknown>) {
  const text = String(data.text || "");
  const chats = Array.isArray(data.chats) ? data.chats.map(String) : [];
  const keyboard = Array.isArray(data.keyboard) ? (data.keyboard as TelegramButton[][]) : undefined;
  if (!text || !chats.length) return { ok: false as const, cause: "invalid_payload" };
  let sent = 0;
  for (const chatId of chats) {
    const id = await sendTelegramMessage({ chatId, text, keyboard });
    if (id) sent += 1;
  }
  logInfo("AutomationDispatchSucceeded", { stage: "ops_telegram", attempt: sent });
  return sent ? { ok: true as const, cause: "ok" } : { ok: false as const, cause: "telegram_zero" };
}
