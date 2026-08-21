import { marketingBaseline } from "@/lib/marketing-engine";
import { contactRegion } from "@/lib/phone";
import { isAutoFollowUp, isRevenueDryRun, revenueConfig } from "@/lib/revenue-score";
import { adminChatIds, sendTelegramMessage } from "@/lib/content-telegram";
import { customerWhatsAppUrl } from "@/lib/service-requests";
import { contact, site } from "@/lib/site";
import {
  acceptQuote,
  backfillFromServiceRequests,
  clearOperatorPending,
  completeJob,
  createAppointment,
  createJobFromLead,
  createQuoteDraft,
  getLead,
  getOperatorPending,
  latestAppointment,
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
  keyboard?: Array<Array<{ text: string; callback_data: string }>>;
  mutated: boolean;
};

function serviceLabel(service: string) {
  const labels: Record<string, string> = {
    ac: "Aire acondicionado",
    plumbing: "Plomería",
    painting: "Pintura",
    electrical: "Electricidad",
    locksmith: "Cerrajería",
    repairs: "Reparaciones",
    remodeling: "Remodelación",
    multiple: "Varios servicios",
  };
  return labels[service] || service || "Servicio Homestead";
}

function panamaYmd(addDays = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: revenueConfig.businessHours.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .split("-")
    .map(Number);
  const utc = Date.UTC(parts[0], parts[1] - 1, parts[2] + addDays);
  return new Date(utc).toISOString().slice(0, 10);
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
    serviceLabel(lead.service),
    "",
    "📝 Necesidad:",
    lead.problem.slice(0, 280) || "Sin detalle",
    "",
    "📍 Zona:",
    lead.location || "No indicada",
    "",
    "📞 Contacto:",
    lead.phone,
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
    "💡 Siguiente acción:",
    lead.nextAction === "PROGRAM_SITE_VISIT" ? "Programar evaluación / contactar" : lead.nextAction,
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
    [{ text: "CONFIRMAR Y PREPARAR MENSAJE", callback_data: `rv:${leadId}:ok` }],
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
    `Servicio: ${serviceLabel(lead.service)}`,
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
  if (!markLeadAlerted(leadId)) return { sent: 0 };
  const text = formatLeadAlert(lead);
  const keyboard = leadKeyboard(leadId);
  let sent = 0;
  for (const chatId of adminChatIds()) {
    const id = await sendTelegramMessage({ chatId, text, keyboard });
    if (id) sent += 1;
  }
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

export function applyRevenueCallback(data: string, chatId = ""): RevenueCallbackResult {
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
    const visit = ["painting", "repairs", "remodeling", "ac"].includes(lead.service);
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
    const id = createAppointment(leadId, date, time, "PROPOSED");
    setPipeline(leadId, "SITE_VISIT_NEEDED");
    return {
      text: `${visitSummary(lead, date, time)}\n\nCita interna: ${id} · PROPOSED`,
      keyboard: confirmKeyboard(leadId),
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
    if (appt) setAppointmentStatus(appt.appointment_id, "CANCELLED");
    return { text: `Propuesta cancelada.\n${leadId}`, keyboard: leadKeyboard(leadId), mutated: true };
  }
  return { text: "Acción no reconocida.", mutated: false };
}

export function bindOperatorChat(chatId: string, leadId: string, expect: string) {
  setOperatorPending(chatId, leadId, expect);
}

export function consumeOperatorDate(chatId: string, text: string): RevenueCallbackResult | null {
  const pending = getOperatorPending(chatId);
  if (!pending || pending.expect !== "date") return null;
  clearOperatorPending(chatId);
  const lead = getLead(pending.lead_id);
  if (!lead) return { text: "Lead no encontrado.", mutated: false };
  const match = text.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-]\d{2,4})?\s+(\d{1,2})(?::(\d{2}))?/);
  if (!match) {
    return { text: "No entendí la fecha. Ejemplo: 25/08 15:30", mutated: false };
  }
  const year = new Date().getFullYear();
  const date = `${year}-${String(match[2]).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}`;
  const time = `${String(match[3]).padStart(2, "0")}:${String(match[4] || "00").padStart(2, "0")}`;
  const id = createAppointment(lead.leadId, date, time, "PROPOSED");
  markLeadHumanAction(lead.leadId);
  setPipeline(lead.leadId, "SITE_VISIT_NEEDED");
  return {
    text: `${visitSummary(lead, date, time)}\n\nCita interna: ${id} · PROPOSED`,
    keyboard: confirmKeyboard(lead.leadId),
    mutated: true,
  };
}
