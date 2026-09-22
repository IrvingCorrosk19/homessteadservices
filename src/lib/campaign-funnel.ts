import { getHomesteadDb } from "@/lib/service-requests";
import { countCampaignClicks, listCampaignPieces, listExperiments } from "@/lib/campaign-store";
import { getContentSettings, listJobsByStatus } from "@/lib/content-catalog";

export const FUNNEL_STATES = [
  {
    id: "received",
    label: "Solicitud recibida",
    meaning: "Entró por formulario o chatbot. Estado operativo NEW.",
    who: "sistema",
  },
  {
    id: "contacted",
    label: "Contactada",
    meaning: "Un operador marcó CONTACTED.",
    who: "operador",
  },
  {
    id: "quoted",
    label: "Cotización enviada",
    meaning: "Existe una cotización en revenue_quotes para el lead.",
    who: "operador",
  },
  {
    id: "appointment",
    label: "Cita agendada",
    meaning: "Existe una cita en revenue_appointments no cancelada.",
    who: "operador",
  },
  {
    id: "contracted",
    label: "Trabajo contratado",
    meaning: "Existe un job en revenue_jobs. Nunca se marca por un clic o un formulario.",
    who: "operador",
  },
  {
    id: "completed",
    label: "Trabajo completado",
    meaning: "Solicitud COMPLETED o job cerrado.",
    who: "operador",
  },
  {
    id: "lost",
    label: "Perdida o cancelada",
    meaning: "Solicitud CANCELLED o lead perdido.",
    who: "operador",
  },
] as const;

function metric(value: number | null, available: boolean) {
  if (!available) return { value: null as number | null, available: false, label: "no disponible" };
  return { value, available: true, label: String(value) };
}

export function campaignReport(campaignId: string, opts?: { includeTests?: boolean }) {
  const database = getHomesteadDb();
  const includeTests = Boolean(opts?.includeTests);
  const testClause = includeTests ? "" : "AND IFNULL(is_test, 0) = 0";
  const requests = database
    .prepare(
      `SELECT public_id, status, IFNULL(is_test, 0) as is_test
       FROM service_requests
       WHERE campaign_public_id = ? ${testClause}`,
    )
    .all(campaignId) as Array<{ public_id: string; status: string; is_test: number }>;
  const leadIds = requests.map((row) => row.public_id);
  const placeholders = leadIds.map(() => "?").join(",") || "''";
  const quoted = leadIds.length
    ? (
        database
          .prepare(`SELECT COUNT(*) as total FROM revenue_quotes WHERE lead_id IN (${placeholders})`)
          .get(...leadIds) as { total: number }
      ).total
    : 0;
  const appointments = leadIds.length
    ? (
        database
          .prepare(
            `SELECT COUNT(*) as total FROM revenue_appointments WHERE lead_id IN (${placeholders}) AND IFNULL(status,'') != 'CANCELLED'`,
          )
          .get(...leadIds) as { total: number }
      ).total
    : 0;
  const jobs = leadIds.length
    ? (
        database
          .prepare(`SELECT COUNT(*) as total FROM revenue_jobs WHERE lead_id IN (${placeholders})`)
          .get(...leadIds) as { total: number }
      ).total
    : 0;
  const completed = requests.filter((row) => row.status === "COMPLETED").length;
  const lost = requests.filter((row) => row.status === "CANCELLED").length;
  const contacted = requests.filter((row) => row.status === "CONTACTED" || row.status === "IN_PROGRESS").length;
  const pieces = listCampaignPieces(campaignId);
  const settings = getContentSettings();
  const publishedJobs = listJobsByStatus(["PUBLISHED", "SIMULATED"]).filter((job) =>
    pieces.some((piece) => piece.contentJobId === job.publicId),
  );
  const simulated = publishedJobs.filter((job) => job.status === "SIMULATED").length;
  const published = publishedJobs.filter((job) => job.status === "PUBLISHED").length;
  const qualified = requests.filter((row) => row.status !== "CANCELLED").length;
  const clicks = countCampaignClicks(campaignId, { excludeTest: !includeTests });
  const experiments = listExperiments(campaignId);

  const conversion =
    requests.length === 0
      ? "solicitudes 0 / piezas publicadas — no hay tasa que calcular"
      : `solicitudes ${requests.length} / publicaciones reales ${published} (periodo: vigencia de la campaña). Clics ${clicks} no son conversaciones.`;

  return {
    campaignId,
    funnel: FUNNEL_STATES,
    posts: {
      simulated: metric(simulated, true),
      publishedReal: metric(published, true),
      scheduled: metric(
        pieces.filter((piece) => piece.status === "SCHEDULED" || piece.status === "APPROVED").length,
        true,
      ),
    },
    meta: {
      reach: metric(null, false),
      plays: metric(null, false),
      interactions: metric(null, false),
      note: settings.dryRun
        ? "Meta no conectada o publicación en simulación. Alcance y reproducciones: no disponible (no es cero)."
        : "Si las cuentas Graph no responden insights, las métricas de Meta siguen como no disponible.",
    },
    homestead: {
      clicks: metric(clicks, true),
      conversations: metric(null, false),
      conversationsNote:
        "No hay recepción de WhatsApp en Homestead. Un clic al wa.me no es conversación iniciada ni solicitud.",
      requests: metric(requests.length, true),
      qualified: metric(qualified, true),
      qualifiedRule: "Calificada = solicitud no cancelada, con teléfono y servicio, excluida si is_test=1.",
      contacted: metric(contacted, true),
      quoted: metric(quoted, true),
      appointments: metric(appointments, true),
      contracted: metric(jobs, true),
      completed: metric(completed, true),
      lost: metric(lost, true),
      revenue: metric(null, false),
      cost: metric(null, false),
      roi: "No se calcula ROI: faltan costos e ingresos confirmados.",
    },
    conversion,
    experiments: experiments.map((item) => ({
      id: item.public_id,
      variable: item.variable,
      status: item.status,
      note: item.result_note || "evidencia insuficiente",
    })),
    nextExperiment:
      "Mantener una sola variable: comodidad frente a control de acceso. No cambiar precios, zonas ni presupuesto en automático.",
  };
}

export function campaignWeeklyBlock() {
  const rows = getHomesteadDb()
    .prepare(
      `SELECT public_id, service, status FROM campaigns
       WHERE status NOT IN ('CANCELLED') AND is_test = 0
       ORDER BY updated_at DESC LIMIT 5`,
    )
    .all() as Array<{ public_id: string; service: string; status: string }>;
  if (!rows.length) {
    return ["Campañas: ninguna activa (las de prueba no entran aquí)."].join("\n");
  }
  const lines = ["Campañas (Homestead, sin Meta):"];
  for (const row of rows) {
    const report = campaignReport(row.public_id);
    lines.push(
      `${row.public_id} ${row.service} [${row.status}] — solicitudes ${report.homestead.requests.label}, citas ${report.homestead.appointments.label}, contratados ${report.homestead.contracted.label}. Meta alcance: no disponible.`,
    );
  }
  return lines.join("\n");
}
