import { marketingBaseline } from "@/lib/marketing-engine";
import { isAutoFollowUp, isRevenueDryRun } from "@/lib/revenue-score";
import {
  acceptQuote,
  backfillFromServiceRequests,
  completeJob,
  createAppointment,
  createJobFromLead,
  createQuoteDraft,
  getLead,
  listLeads,
  markQuoteSent,
  nextBestActions,
  pendingFollowUps,
  revenueSnapshot,
  setPipeline,
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

export function applyRevenueCallback(data: string) {
  const parts = data.split(":");
  if (parts[0] !== "rv" || parts.length < 3) return "Acción no reconocida.";
  const leadId = parts[1];
  const action = parts[2];
  const lead = getLead(leadId);
  if (!lead) return "Lead no encontrado.";
  if (action === "stop") {
    stopFollowUps(leadId, "NO_RESPONSE");
    return `Seguimientos detenidos para ${leadId}.`;
  }
  if (action === "contact") {
    setPipeline(leadId, "CONTACTED");
    return `Marcado CONTACTED: ${leadId}.`;
  }
  if (action === "quote") {
    const draft = createQuoteDraft(leadId);
    return draft
      ? `Borrador ${draft.quote_number} · ${draft.pricing_status}. Carga el precio a mano antes de enviar.`
      : "No se pudo crear cotización.";
  }
  if (action === "sendq") {
    if (!lead.quoteId) return "No hay cotización.";
    const sent = markQuoteSent(lead.quoteId);
    if (sent && "error" in sent) return "NEEDS_MANUAL_PRICING. No se envía sin tarifa autorizada.";
    return isRevenueDryRun() ? "DRY RUN: no se envió al cliente. Estado interno QUOTE_SENT simulado solo si hay precio." : "Cotización marcada enviada.";
  }
  if (action === "accept") {
    if (!lead.quoteId) return "No hay cotización.";
    acceptQuote(lead.quoteId);
    return `Cotización aceptada. Siguiente: programar ${leadId}.`;
  }
  if (action === "job") {
    const job = createJobFromLead(leadId);
    return `Trabajo ${job} creado (no publicado a cliente).`;
  }
  if (action === "doneok") {
    if (!lead.jobId) return "No hay trabajo.";
    completeJob(lead.jobId, { satisfaction: "YES" });
    return "Trabajo completado. Cliente satisfecho → elegible a reseña. No se pidió reseña automática.";
  }
  if (action === "donebad") {
    if (!lead.jobId) return "No hay trabajo.";
    completeJob(lead.jobId, { satisfaction: "NO" });
    return "SERVICE RECOVERY. No se solicitará reseña.";
  }
  if (action === "appt") {
    const id = createAppointment(leadId, new Date().toISOString().slice(0, 10), "09:00");
    return `Cita propuesta ${id} (calendario interno). DRY RUN no escribe en calendarios externos.`;
  }
  return "Acción no reconocida.";
}

export function leadKeyboard(leadId: string) {
  return [
    [
      { text: "CONTACTAR", callback_data: `rv:${leadId}:contact` },
      { text: "COTIZACIÓN", callback_data: `rv:${leadId}:quote` },
    ],
    [
      { text: "PROGRAMAR", callback_data: `rv:${leadId}:appt` },
      { text: "DETENER", callback_data: `rv:${leadId}:stop` },
    ],
  ];
}
