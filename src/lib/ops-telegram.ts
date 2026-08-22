import { site } from "@/lib/site";
import { customerWhatsAppUrl, getRequestByPublicId } from "@/lib/service-requests";
import { getAppointment, getLead, latestAppointment, setOperatorPending } from "@/lib/revenue-store";
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
import {
  JOB_STATUS_LABELS,
  adminJobUrl,
  approveMarketingUsage,
  cancelServiceJob,
  completeServiceJob,
  countActiveJobs,
  getServiceJob,
  listActiveJobs,
  listFollowups,
  skipJobContent,
  startServiceJob,
} from "@/lib/job-store";
import { followupKind, markRecoveryContacted } from "@/lib/post-service";
import { createContentFromJob } from "@/lib/job-content";
import { jobPhotoCount } from "@/lib/job-photos";

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
      { text: "🔧 Trabajos", callback_data: `cc:j:0${flag}` },
    ],
    [
      { text: "❤️ Seguimientos", callback_data: `cc:f:0${flag}` },
      { text: "📸 Marketing", callback_data: "cc:m" },
    ],
    [
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
  const recovery =
    snap.serviceRecovery > 0
      ? `🚨 ${snap.serviceRecovery} ${snap.serviceRecovery === 1 ? "cliente necesita atención" : "clientes necesitan atención"}`
      : "";
  return {
    text: [
      "🏠 HOMESTEAD",
      "Centro de operaciones",
      includeTest ? "Modo pruebas" : "",
      "",
      recovery,
      `🔥 ${snap.rescue} oportunidades`,
      `📥 ${snap.pendingRequests} solicitudes`,
      `📅 ${snap.appointmentsToday} citas hoy`,
      `🔧 ${snap.jobsActive} trabajos activos`,
      snap.followupsOpen ? `❤️ ${snap.followupsOpen} seguimientos` : "",
      snap.contentCandidates ? `📸 ${snap.contentCandidates} listos para contenido` : `📸 ${snap.contentPending} contenido pendiente`,
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
  const admin = `${site.url.replace(/\/$/, "")}/admin/solicitudes/${request.publicId}`;
  const keyboard: TelegramButton[][] = [];
  const contact: TelegramButton[] = [];
  if (wa) contact.push({ text: "💬 WhatsApp", url: wa });
  contact.push({ text: "📞 Ficha", url: admin });
  if (contact.length) keyboard.push(contact);
  keyboard.push([{ text: "✅ Marcar atendido", callback_data: `cc:c:${request.publicId}` }]);
  const appt = latestAppointment(request.publicId);
  if (appt?.appointment_id) {
    keyboard.push([{ text: "📅 Ver cita", callback_data: `cc:g:${appt.appointment_id}` }]);
  }
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
  const keyboard: TelegramButton[][] = [];
  const contact: TelegramButton[] = [];
  if (wa) contact.push({ text: "💬 WhatsApp", url: wa });
  if (lead.leadId.startsWith("HS-")) {
    contact.push({
      text: "📞 Ficha",
      url: `${site.url.replace(/\/$/, "")}/admin/solicitudes/${lead.leadId}`,
    });
  }
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
  const calendar = `${site.url.replace(/\/$/, "")}/admin/citas`;
  const keyboard: TelegramButton[][] = [];
  const contact: TelegramButton[] = [];
  if (wa) contact.push({ text: "💬 WhatsApp", url: wa });
  contact.push({ text: "🌐 Abrir calendario", url: calendar });
  if (contact.length) keyboard.push(contact);
  const jobId = item.jobId;
  if (jobId) keyboard.push([{ text: "🔧 Ver trabajo", callback_data: `cc:k:${jobId}` }]);
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
  const snap = commandCenterSummary(includeTest);
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
      `🔧 Trabajos activos: ${snap.jobsActive}`,
      snap.serviceRecovery ? `🚨 Recuperación: ${snap.serviceRecovery}` : "",
      conversion,
    ]
      .filter((line) => line !== "")
      .join("\n"),
    keyboard: [[{ text: "⬅ Inicio", callback_data: includeTest ? "cc:h:1" : "cc:h" }]],
  };
}

export function jobsView(page = 0, includeTest = false) {
  const total = countActiveJobs(includeTest);
  const rows = listActiveJobs(includeTest, page * opsConfig().pageSize);
  if (!rows.length) {
    return {
      text: "🔧 TRABAJOS — HOY\n\nNo hay trabajos activos.",
      keyboard: [[{ text: "⬅ Inicio", callback_data: includeTest ? "cc:h:1" : "cc:h" }]],
    };
  }
  const lines = ["🔧 TRABAJOS — HOY", ""];
  const buttons: TelegramButton[][] = [[]];
  rows.forEach((job, index) => {
    const clock = job.appointmentTime ? formatAppointmentClock(job.appointmentTime) : "";
    lines.push(`${index + 1}. ${job.jobNumber}`);
    lines.push(`   ${job.serviceLabel}`);
    if (clock) lines.push(`   ${clock}`);
    lines.push(`   ${JOB_STATUS_LABELS[job.status].toUpperCase()}`);
    lines.push("");
    buttons[0].push({ text: String(index + 1), callback_data: `cc:k:${job.jobId}` });
  });
  const nav = pager("cc:j", page, total, includeTest);
  if (nav.length) buttons.push(nav);
  buttons.push([{ text: "⬅ Inicio", callback_data: includeTest ? "cc:h:1" : "cc:h" }]);
  return { text: lines.join("\n").trim(), keyboard: buttons };
}

export function jobDetail(jobId: string) {
  const job = getServiceJob(jobId);
  if (!job) return { text: "Este trabajo ya no está disponible.", keyboard: [[{ text: "⬅ Inicio", callback_data: "cc:h" }]] };
  const wa = customerWhatsAppUrl(job.phone);
  const photos = jobPhotoCount(job.jobId);
  const keyboard: TelegramButton[][] = [];
  const contact: TelegramButton[] = [];
  if (wa) contact.push({ text: "💬 WhatsApp", url: wa });
  contact.push({ text: "🌐 Abrir ficha", url: adminJobUrl(job.jobId) });
  if (contact.length) keyboard.push(contact);
  if (job.status === "SCHEDULED") {
    keyboard.push([{ text: "▶ Iniciar trabajo", callback_data: `cc:b:${job.jobId}` }]);
  }
  if (job.status === "SCHEDULED" || job.status === "IN_PROGRESS") {
    keyboard.push([{ text: "✅ Completar trabajo", callback_data: `cc:q:${job.jobId}` }]);
  }
  keyboard.push([{ text: "📸 Fotos", callback_data: `cc:p:${job.jobId}` }]);
  if (!job.marketingUsageApproved && photos > 0) {
    keyboard.push([{ text: "✅ Autorizar fotos", callback_data: `cc:y:${job.jobId}` }]);
  }
  if (job.status === "COMPLETED" && photos > 0 && !job.sourceContentId && job.marketingUsageApproved) {
    keyboard.push([{ text: "✨ Crear contenido", callback_data: `cc:o:${job.jobId}` }]);
  }
  if (job.recoveryStatus === "OPEN") {
    keyboard.push([{ text: "✅ Recuperación atendida", callback_data: `cc:t:${job.jobId}` }]);
  }
  if (job.status === "SCHEDULED" || job.status === "IN_PROGRESS") {
    keyboard.push([{ text: "No se presentó", callback_data: `cc:ns:${job.jobId}` }]);
  }
  keyboard.push([{ text: "⬅ Trabajos", callback_data: "cc:j:0" }]);
  const first = job.customerName.split(/\s+/)[0] || job.customerName;
  return {
    text: [
      "🔧 TRABAJO",
      "",
      job.jobNumber,
      job.isTest ? "TEST · no es un cliente real" : "",
      "",
      first ? `👤 ${first}` : "",
      `🛠 ${job.serviceLabel}`,
      job.zone ? `📍 ${job.zone}` : "",
      job.appointmentDate ? `📅 ${formatAppointmentDay(job.appointmentDate)}${job.appointmentTime ? ` · ${formatAppointmentClock(job.appointmentTime)}` : ""}` : "",
      "",
      `Estado:\n${JOB_STATUS_LABELS[job.status].toUpperCase()}`,
      "",
      job.leadId.startsWith("HS-") ? `Solicitud:\n${job.leadId}` : "",
      job.appointmentId ? `Cita:\n${job.appointmentId}` : "",
      photos ? `Fotos: ${photos}` : "",
      job.phone ? `📞 ${job.phone}` : "",
    ]
      .filter((line) => line !== "")
      .join("\n"),
    keyboard,
  };
}

export function followupsView(page = 0, includeTest = false) {
  const rows = listFollowups(includeTest, page * opsConfig().pageSize);
  if (!rows.length) {
    return {
      text: "❤️ SEGUIMIENTOS\n\nNada pendiente.",
      keyboard: [[{ text: "⬅ Inicio", callback_data: includeTest ? "cc:h:1" : "cc:h" }]],
    };
  }
  const lines = ["❤️ SEGUIMIENTOS", ""];
  const buttons: TelegramButton[][] = [[]];
  rows.forEach((job, index) => {
    const kind = followupKind(job);
    const label = kind === "recovery" ? "🚨 Necesita atención" : kind === "review" ? "⭐ Reseña" : "❤️ Post-servicio";
    lines.push(`${index + 1}. ${job.jobNumber}`);
    lines.push(`   ${job.serviceLabel}`);
    lines.push(`   ${label}`);
    lines.push("");
    buttons[0].push({ text: String(index + 1), callback_data: `cc:k:${job.jobId}` });
  });
  buttons.push([{ text: "⬅ Inicio", callback_data: includeTest ? "cc:h:1" : "cc:h" }]);
  return { text: lines.join("\n").trim(), keyboard: buttons };
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
    else if (action === "j") view = jobsView(Number(parts[2] || 0), parseFlag(parts, 3));
    else if (action === "k") view = jobDetail(parts.slice(2).join(":"));
    else if (action === "f") view = followupsView(Number(parts[2] || 0), parseFlag(parts, 3));
    else if (action === "q") {
      const jobId = parts.slice(2).join(":");
      view = {
        text: "¿Confirmas que el trabajo fue realizado?",
        keyboard: [
          [{ text: "✅ Sí, completar", callback_data: `cc:w:${jobId}` }],
          [{ text: "↩ Cancelar", callback_data: `cc:k:${jobId}` }],
        ],
      };
    } else if (action === "w") {
      const jobId = parts.slice(2).join(":");
      const result = completeServiceJob(jobId, chatId.slice(0, 24));
      if (!result.ok && result.reason === "missing") view = { text: USER_ERROR, keyboard: [[{ text: "⬅ Inicio", callback_data: "cc:h" }]] };
      else if (result.already) {
        view = {
          text: `✅ Este trabajo ya estaba completado.\n\n${jobId}`,
          keyboard: [[{ text: "🔧 Ver trabajo", callback_data: `cc:k:${jobId}` }]],
        };
      } else {
        view = {
          text: `✅ Trabajo completado.\n\n${jobId}\n\nHomestead programará un seguimiento al cliente. No se publica contenido ni se pide reseña todavía.`,
          keyboard: [[{ text: "🔧 Ver trabajo", callback_data: `cc:k:${jobId}` }]],
        };
      }
    } else if (action === "b") {
      const jobId = parts.slice(2).join(":");
      startServiceJob(jobId, chatId.slice(0, 24));
      view = jobDetail(jobId);
    } else if (action === "p") {
      const jobId = parts.slice(2).join(":");
      setOperatorPending(chatId, jobId, "job_photos");
      view = {
        text: `📸 FOTOS DEL TRABAJO\n\n${jobId}\n\nEnvía ahora las fotografías del trabajo realizado.\nSe guardan como originales y no se mezclan con las fotos del cliente.\n\nCuando termines, vuelve al trabajo.`,
        keyboard: [[{ text: "⬅ Trabajo", callback_data: `cc:k:${jobId}` }]],
      };
    } else if (action === "y") {
      const jobId = parts.slice(2).join(":");
      approveMarketingUsage(jobId, chatId.slice(0, 24));
      view = {
        text: "✅ Uso de fotos autorizado para marketing.\n\nHomestead todavía no publica nada hasta que apruebes el contenido.",
        keyboard: [[{ text: "🔧 Ver trabajo", callback_data: `cc:k:${jobId}` }]],
      };
    } else if (action === "o") {
      const jobId = parts.slice(2).join(":");
      const created = createContentFromJob({ jobId, chatId, userId: chatId, actor: chatId.slice(0, 24) });
      if (!created.ok && created.reason === "marketing_not_approved") {
        view = {
          text: "Primero autoriza el uso de las fotos para marketing.",
          keyboard: [
            [{ text: "✅ Autorizar fotos", callback_data: `cc:y:${jobId}` }],
            [{ text: "⬅ Trabajo", callback_data: `cc:k:${jobId}` }],
          ],
        };
      } else if (!created.ok) {
        view = { text: "No pudimos crear el contenido todavía.", keyboard: [[{ text: "⬅ Trabajo", callback_data: `cc:k:${jobId}` }]] };
      } else {
        view = {
          text: `📸 Content Studio listo\n\n${created.contentId}\nTrabajo ${jobId}\n\nLas fotos originales se copiaron. Pulsa PROCESAR cuando quieras. Homestead no llama a la IA hasta ese momento y no publica solo.`,
          keyboard: [[{ text: "⬅ Trabajo", callback_data: `cc:k:${jobId}` }]],
        };
      }
    } else if (action === "u") {
      const jobId = parts.slice(2).join(":");
      skipJobContent(jobId, chatId.slice(0, 24));
      view = {
        text: "De acuerdo. No creamos contenido ahora.",
        keyboard: [[{ text: "⬅ Inicio", callback_data: "cc:h" }]],
      };
    } else if (action === "t") {
      const jobId = parts.slice(2).join(":");
      const result = markRecoveryContacted(jobId, chatId.slice(0, 24));
      view = {
        text: result.already ? "✅ Ya estaba atendida." : "✅ Recuperación marcada como atendida.",
        keyboard: [[{ text: "🔧 Ver trabajo", callback_data: `cc:k:${jobId}` }]],
      };
    } else if (action === "ns") {
      const jobId = parts.slice(2).join(":");
      cancelServiceJob(jobId, "NO_SHOW", chatId.slice(0, 24));
      view = {
        text: "Registramos que el cliente no se presentó.",
        keyboard: [[{ text: "⬅ Trabajos", callback_data: "cc:j:0" }]],
      };
    } else if (action === "c") {
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
