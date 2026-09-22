import type { Campaign, CampaignPiece, CampaignPieceStatus, CampaignStatus } from "@/lib/campaign-types";
import { getHomesteadDb } from "@/lib/service-requests";

type CampaignRow = {
  id: number;
  public_id: string;
  status: CampaignStatus;
  service: string;
  service_slug: string;
  zone: string;
  audience: string;
  problem: string;
  benefit: string;
  offer: string;
  objections: string;
  evidence: string;
  conversion_channel: string;
  objective: string;
  starts_at: string | null;
  ends_at: string | null;
  requested_horizon_days: number;
  scheduled_horizon_days: number;
  schedule_note: string;
  max_generation: number;
  generation_used: number;
  experiment_json: string;
  approval_manifest: string;
  telegram_chat_id: string;
  created_at: string;
  updated_at: string;
  is_test: number;
};

type PieceRow = {
  id: number;
  public_id: string;
  campaign_id: string;
  status: CampaignPieceStatus;
  version: number;
  approved_version: number | null;
  pillar: CampaignPiece["pillar"];
  format: CampaignPiece["format"];
  objective: string;
  problem: string;
  hook: string;
  benefit: string;
  evidence: string;
  objection: string;
  visual_need: string;
  copy: string;
  alt_copy: string;
  overlay_text: string;
  cta: string;
  alt_text: string;
  hypothesis: string;
  destination_url: string;
  whatsapp_url: string;
  content_job_id: string;
  scheduled_at: string | null;
  editorial_score: number;
  created_at: string;
  updated_at: string;
};

function panamaYear(date = new Date()) {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Panama", year: "numeric" }).format(date),
  );
}

function mapCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    publicId: row.public_id,
    status: row.status,
    service: row.service,
    serviceSlug: row.service_slug,
    zone: row.zone,
    audience: row.audience,
    problem: row.problem,
    benefit: row.benefit,
    offer: row.offer,
    objections: row.objections,
    evidence: row.evidence,
    conversionChannel: row.conversion_channel,
    objective: row.objective,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    requestedHorizonDays: row.requested_horizon_days,
    scheduledHorizonDays: row.scheduled_horizon_days,
    scheduleNote: row.schedule_note,
    maxGeneration: row.max_generation,
    generationUsed: row.generation_used,
    experimentJson: row.experiment_json,
    approvalManifest: row.approval_manifest,
    telegramChatId: row.telegram_chat_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isTest: row.is_test,
  };
}

function mapPiece(row: PieceRow): CampaignPiece {
  return {
    id: row.id,
    publicId: row.public_id,
    campaignId: row.campaign_id,
    status: row.status,
    version: row.version,
    approvedVersion: row.approved_version,
    pillar: row.pillar,
    format: row.format,
    objective: row.objective,
    problem: row.problem,
    hook: row.hook,
    benefit: row.benefit,
    evidence: row.evidence,
    objection: row.objection,
    visualNeed: row.visual_need,
    copy: row.copy,
    altCopy: row.alt_copy,
    overlayText: row.overlay_text,
    cta: row.cta,
    altText: row.alt_text,
    hypothesis: row.hypothesis,
    destinationUrl: row.destination_url,
    whatsappUrl: row.whatsapp_url,
    contentJobId: row.content_job_id,
    scheduledAt: row.scheduled_at,
    editorialScore: row.editorial_score,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function nextId(kind: "campaign" | "piece") {
  const database = getHomesteadDb();
  const year = panamaYear();
  const column = kind === "campaign" ? "last_campaign" : "last_piece";
  const prefix = kind === "campaign" ? "CM" : "CP";
  const row = database.prepare("SELECT last_campaign, last_piece FROM campaign_counters WHERE year = ?").get(year) as
    | { last_campaign: number; last_piece: number }
    | undefined;
  if (!row) {
    const first = 1;
    database
      .prepare("INSERT INTO campaign_counters (year, last_campaign, last_piece) VALUES (?, ?, ?)")
      .run(year, kind === "campaign" ? first : 0, kind === "piece" ? first : 0);
    return `${prefix}-${year}-${String(first).padStart(6, "0")}`;
  }
  const last = (kind === "campaign" ? row.last_campaign : row.last_piece) + 1;
  database.prepare(`UPDATE campaign_counters SET ${column} = ? WHERE year = ?`).run(last, year);
  return `${prefix}-${year}-${String(last).padStart(6, "0")}`;
}

export function insertCampaign(input: Omit<Campaign, "id" | "publicId" | "createdAt" | "updatedAt"> & { publicId?: string }) {
  const database = getHomesteadDb();
  const now = new Date().toISOString();
  const publicId = input.publicId || nextId("campaign");
  const info = database
    .prepare(
      `INSERT INTO campaigns
        (public_id, status, service, service_slug, zone, audience, problem, benefit, offer, objections, evidence,
         conversion_channel, objective, starts_at, ends_at, requested_horizon_days, scheduled_horizon_days, schedule_note,
         max_generation, generation_used, experiment_json, approval_manifest, telegram_chat_id, created_at, updated_at, is_test)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      publicId,
      input.status,
      input.service,
      input.serviceSlug,
      input.zone,
      input.audience,
      input.problem,
      input.benefit,
      input.offer,
      input.objections,
      input.evidence,
      input.conversionChannel,
      input.objective,
      input.startsAt,
      input.endsAt,
      input.requestedHorizonDays,
      input.scheduledHorizonDays,
      input.scheduleNote,
      input.maxGeneration,
      input.generationUsed,
      input.experimentJson,
      input.approvalManifest,
      input.telegramChatId,
      now,
      now,
      input.isTest,
    );
  return getCampaignById(Number(info.lastInsertRowid))!;
}

export function insertPiece(input: Omit<CampaignPiece, "id" | "publicId" | "createdAt" | "updatedAt"> & { publicId?: string }) {
  const database = getHomesteadDb();
  const now = new Date().toISOString();
  const publicId = input.publicId || nextId("piece");
  database
    .prepare(
      `INSERT INTO campaign_pieces
        (public_id, campaign_id, status, version, approved_version, pillar, format, objective, problem, hook, benefit,
         evidence, objection, visual_need, copy, alt_copy, overlay_text, cta, alt_text, hypothesis, destination_url,
         whatsapp_url, content_job_id, scheduled_at, editorial_score, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      publicId,
      input.campaignId,
      input.status,
      input.version,
      input.approvedVersion,
      input.pillar,
      input.format,
      input.objective,
      input.problem,
      input.hook,
      input.benefit,
      input.evidence,
      input.objection,
      input.visualNeed,
      input.copy,
      input.altCopy,
      input.overlayText,
      input.cta,
      input.altText,
      input.hypothesis,
      input.destinationUrl,
      input.whatsappUrl,
      input.contentJobId,
      input.scheduledAt,
      input.editorialScore,
      now,
      now,
    );
  return getPieceByPublicId(publicId)!;
}

export function getCampaignByPublicId(publicId: string) {
  const row = getHomesteadDb().prepare("SELECT * FROM campaigns WHERE public_id = ?").get(publicId) as
    | CampaignRow
    | undefined;
  return row ? mapCampaign(row) : null;
}

export function getCampaignById(id: number) {
  const row = getHomesteadDb().prepare("SELECT * FROM campaigns WHERE id = ?").get(id) as CampaignRow | undefined;
  return row ? mapCampaign(row) : null;
}

export function getPieceByPublicId(publicId: string) {
  const row = getHomesteadDb().prepare("SELECT * FROM campaign_pieces WHERE public_id = ?").get(publicId) as
    | PieceRow
    | undefined;
  return row ? mapPiece(row) : null;
}

export function getPieceByJobId(jobId: string) {
  const row = getHomesteadDb().prepare("SELECT * FROM campaign_pieces WHERE content_job_id = ?").get(jobId) as
    | PieceRow
    | undefined;
  return row ? mapPiece(row) : null;
}

export function listCampaignPieces(campaignId: string) {
  const rows = getHomesteadDb()
    .prepare("SELECT * FROM campaign_pieces WHERE campaign_id = ? ORDER BY id ASC")
    .all(campaignId) as PieceRow[];
  return rows.map(mapPiece);
}

export function listActiveCampaigns() {
  const rows = getHomesteadDb()
    .prepare(
      `SELECT * FROM campaigns WHERE status NOT IN ('COMPLETED','CANCELLED') ORDER BY updated_at DESC LIMIT 20`,
    )
    .all() as CampaignRow[];
  return rows.map(mapCampaign);
}

export function latestCampaignForChat(chatId: string) {
  const row = getHomesteadDb()
    .prepare(
      `SELECT * FROM campaigns WHERE telegram_chat_id = ? AND status NOT IN ('COMPLETED','CANCELLED')
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(chatId) as CampaignRow | undefined;
  return row ? mapCampaign(row) : null;
}

export function findOpenLocksmithCampaign(chatId: string) {
  const row = getHomesteadDb()
    .prepare(
      `SELECT * FROM campaigns
       WHERE telegram_chat_id = ? AND service_slug = 'locksmith' AND status IN ('DRAFT','AWAITING_APPROVAL','APPROVED','SCHEDULED','PAUSED')
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(chatId) as CampaignRow | undefined;
  return row ? mapCampaign(row) : null;
}

export function updateCampaign(
  publicId: string,
  patch: Partial<{
    status: CampaignStatus;
    scheduleNote: string;
    startsAt: string | null;
    endsAt: string | null;
    generationUsed: number;
    approvalManifest: string;
    experimentJson: string;
    scheduledHorizonDays: number;
  }>,
) {
  const current = getCampaignByPublicId(publicId);
  if (!current) return null;
  getHomesteadDb()
    .prepare(
      `UPDATE campaigns SET
        status = ?, schedule_note = ?, starts_at = ?, ends_at = ?, generation_used = ?,
        approval_manifest = ?, experiment_json = ?, scheduled_horizon_days = ?, updated_at = ?
       WHERE public_id = ?`,
    )
    .run(
      patch.status ?? current.status,
      patch.scheduleNote ?? current.scheduleNote,
      patch.startsAt === undefined ? current.startsAt : patch.startsAt,
      patch.endsAt === undefined ? current.endsAt : patch.endsAt,
      patch.generationUsed ?? current.generationUsed,
      patch.approvalManifest ?? current.approvalManifest,
      patch.experimentJson ?? current.experimentJson,
      patch.scheduledHorizonDays ?? current.scheduledHorizonDays,
      new Date().toISOString(),
      publicId,
    );
  return getCampaignByPublicId(publicId);
}

export function updatePiece(
  publicId: string,
  patch: Partial<{
    status: CampaignPieceStatus;
    version: number;
    approvedVersion: number | null;
    copy: string;
    overlayText: string;
    contentJobId: string;
    scheduledAt: string | null;
    destinationUrl: string;
    whatsappUrl: string;
    editorialScore: number;
    hypothesis: string;
  }>,
) {
  const current = getPieceByPublicId(publicId);
  if (!current) return null;
  getHomesteadDb()
    .prepare(
      `UPDATE campaign_pieces SET
        status = ?, version = ?, approved_version = ?, copy = ?, overlay_text = ?, content_job_id = ?,
        scheduled_at = ?, destination_url = ?, whatsapp_url = ?, editorial_score = ?, hypothesis = ?, updated_at = ?
       WHERE public_id = ?`,
    )
    .run(
      patch.status ?? current.status,
      patch.version ?? current.version,
      patch.approvedVersion === undefined ? current.approvedVersion : patch.approvedVersion,
      patch.copy ?? current.copy,
      patch.overlayText ?? current.overlayText,
      patch.contentJobId ?? current.contentJobId,
      patch.scheduledAt === undefined ? current.scheduledAt : patch.scheduledAt,
      patch.destinationUrl ?? current.destinationUrl,
      patch.whatsappUrl ?? current.whatsappUrl,
      patch.editorialScore ?? current.editorialScore,
      patch.hypothesis ?? current.hypothesis,
      new Date().toISOString(),
      publicId,
    );
  return getPieceByPublicId(publicId);
}

export function recordCampaignEvent(campaignId: string, event: string, detail = "", pieceId = "") {
  getHomesteadDb()
    .prepare(
      "INSERT INTO campaign_events (campaign_id, piece_id, event, detail, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(campaignId, pieceId, event, detail.slice(0, 800), new Date().toISOString());
}

export function recordCampaignClick(input: {
  campaignId: string;
  pieceId: string;
  channel: string;
  ref: string;
  isTest?: boolean;
}) {
  getHomesteadDb()
    .prepare(
      `INSERT INTO campaign_clicks (campaign_id, piece_id, channel, ref, created_at, is_test)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.campaignId,
      input.pieceId,
      input.channel,
      input.ref.slice(0, 180),
      new Date().toISOString(),
      input.isTest ? 1 : 0,
    );
}

export function countCampaignClicks(campaignId: string, opts?: { excludeTest?: boolean }) {
  const sql =
    opts?.excludeTest === false
      ? "SELECT COUNT(*) as total FROM campaign_clicks WHERE campaign_id = ?"
      : "SELECT COUNT(*) as total FROM campaign_clicks WHERE campaign_id = ? AND is_test = 0";
  const row = getHomesteadDb().prepare(sql).get(campaignId) as { total: number };
  return row.total;
}

export function insertExperiment(input: {
  campaignId: string;
  variable: string;
  variantA: string;
  variantB: string;
  hypothesis: string;
}) {
  const year = panamaYear();
  const publicId = `CX-${year}-${String(Date.now()).slice(-6)}`;
  getHomesteadDb()
    .prepare(
      `INSERT INTO campaign_experiments
        (public_id, campaign_id, variable, variant_a, variant_b, hypothesis, status, result_note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'PLANNED', 'Aún no hay evidencia. Comparar posts orgánicos en horarios distintos no es un experimento aleatorio.', ?)`,
    )
    .run(
      publicId,
      input.campaignId,
      input.variable,
      input.variantA,
      input.variantB,
      input.hypothesis,
      new Date().toISOString(),
    );
  return publicId;
}

export function listExperiments(campaignId: string) {
  return getHomesteadDb()
    .prepare("SELECT * FROM campaign_experiments WHERE campaign_id = ? ORDER BY id ASC")
    .all(campaignId) as Array<{
    public_id: string;
    variable: string;
    variant_a: string;
    variant_b: string;
    hypothesis: string;
    status: string;
    result_note: string;
  }>;
}

export function campaignJobPaused(jobPublicId: string) {
  const piece = getPieceByJobId(jobPublicId);
  if (!piece) return false;
  const campaign = getCampaignByPublicId(piece.campaignId);
  if (!campaign) return false;
  if (campaign.status === "PAUSED" || campaign.status === "CANCELLED") return true;
  if (piece.approvedVersion !== null && piece.approvedVersion !== piece.version) return true;
  return false;
}
