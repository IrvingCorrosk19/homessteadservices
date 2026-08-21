import { randomBytes } from "crypto";
import { getHomesteadDb } from "@/lib/service-requests";
import type { IntentSignals } from "@/lib/marketing-config";
import { homesteadIntentScore } from "@/lib/marketing-score";

export type SnapshotHorizon = "24h" | "48h" | "72h" | "7d";

export function saveSnapshot(input: {
  publicId: string;
  platform: string;
  horizon: SnapshotHorizon;
  signals: IntentSignals;
  source?: string;
}) {
  const now = new Date().toISOString();
  getHomesteadDb()
    .prepare(
      `INSERT INTO marketing_snapshots
        (public_id, platform, horizon, collected_at, reach, impressions, likes, comments, shares, saves, profile_visits, link_clicks, messages, whatsapp_clicks, leads, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(public_id, platform, horizon) DO UPDATE SET
         collected_at = excluded.collected_at,
         reach = excluded.reach,
         impressions = excluded.impressions,
         likes = excluded.likes,
         comments = excluded.comments,
         shares = excluded.shares,
         saves = excluded.saves,
         profile_visits = excluded.profile_visits,
         link_clicks = excluded.link_clicks,
         messages = excluded.messages,
         whatsapp_clicks = excluded.whatsapp_clicks,
         leads = excluded.leads,
         source = excluded.source`,
    )
    .run(
      input.publicId,
      input.platform,
      input.horizon,
      now,
      input.signals.reach ?? null,
      input.signals.impression ?? null,
      input.signals.like ?? null,
      input.signals.comment ?? null,
      input.signals.share ?? null,
      input.signals.save ?? null,
      input.signals.profileVisit ?? null,
      input.signals.linkClick ?? null,
      input.signals.dm ?? null,
      input.signals.whatsappClick ?? null,
      input.signals.lead ?? null,
      input.source || "api",
    );
}

export function latestSnapshots() {
  return getHomesteadDb()
    .prepare(
      `SELECT * FROM marketing_snapshots
       WHERE horizon = '7d' OR id IN (
         SELECT MAX(id) FROM marketing_snapshots GROUP BY public_id, platform
       )`,
    )
    .all() as Array<{
    public_id: string;
    platform: string;
    horizon: string;
    reach: number | null;
    impressions: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
    profile_visits: number | null;
    link_clicks: number | null;
    messages: number | null;
    whatsapp_clicks: number | null;
    leads: number | null;
  }>;
}

export function snapshotCount() {
  const row = getHomesteadDb()
    .prepare("SELECT COUNT(DISTINCT public_id) as n FROM marketing_snapshots")
    .get() as { n: number };
  return row.n;
}

export function recordLead(input: { publicId?: string; channel: string; outcome?: string }) {
  getHomesteadDb()
    .prepare(
      "INSERT INTO marketing_leads (public_id, channel, outcome, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(
      input.publicId || "",
      input.channel,
      input.outcome || "UNKNOWN",
      new Date().toISOString(),
    );
}

export function leadCount(sinceIso?: string) {
  if (sinceIso) {
    const row = getHomesteadDb()
      .prepare("SELECT COUNT(*) as n FROM marketing_leads WHERE created_at >= ?")
      .get(sinceIso) as { n: number };
    return row.n;
  }
  const row = getHomesteadDb().prepare("SELECT COUNT(*) as n FROM marketing_leads").get() as { n: number };
  return row.n;
}

export function leadsByContent() {
  return getHomesteadDb()
    .prepare(
      `SELECT public_id, COUNT(*) as n FROM marketing_leads
       WHERE public_id != '' GROUP BY public_id`,
    )
    .all() as Array<{ public_id: string; n: number }>;
}

export type StoredRecommendation = {
  recommendationId: string;
  publicId: string;
  generatedAt: string;
  recommendedAt: string | null;
  platform: string;
  score: number;
  confidence: string;
  learningStage: string;
  reasonCodes: string[];
  sampleSize: number;
  reason: string;
  shadow: boolean;
};

export function saveRecommendation(input: Omit<StoredRecommendation, "recommendationId" | "generatedAt"> & { recommendationId?: string }) {
  const id = input.recommendationId || `MR-${randomBytes(6).toString("hex")}`;
  const generatedAt = new Date().toISOString();
  getHomesteadDb()
    .prepare(
      `INSERT INTO marketing_recommendations
        (recommendation_id, public_id, generated_at, recommended_at, platform, score, confidence, learning_stage, reason_codes, sample_size, reason, shadow, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.publicId,
      generatedAt,
      input.recommendedAt,
      input.platform,
      input.score,
      input.confidence,
      input.learningStage,
      JSON.stringify(input.reasonCodes),
      input.sampleSize,
      input.reason,
      input.shadow ? 1 : 0,
      generatedAt,
    );
  return { ...input, recommendationId: id, generatedAt };
}

export function latestRecommendation() {
  const row = getHomesteadDb()
    .prepare("SELECT * FROM marketing_recommendations ORDER BY generated_at DESC LIMIT 1")
    .get() as
    | {
        recommendation_id: string;
        public_id: string;
        generated_at: string;
        recommended_at: string | null;
        platform: string;
        score: number;
        confidence: string;
        learning_stage: string;
        reason_codes: string;
        sample_size: number;
        reason: string;
        shadow: number;
      }
    | undefined;
  if (!row) return null;
  return {
    recommendationId: row.recommendation_id,
    publicId: row.public_id,
    generatedAt: row.generated_at,
    recommendedAt: row.recommended_at,
    platform: row.platform,
    score: row.score,
    confidence: row.confidence,
    learningStage: row.learning_stage,
    reasonCodes: JSON.parse(row.reason_codes || "[]") as string[],
    sampleSize: row.sample_size,
    reason: row.reason,
    shadow: Boolean(row.shadow),
  } satisfies StoredRecommendation;
}

export function markRecommendationDecision(id: string, decision: string) {
  getHomesteadDb()
    .prepare("UPDATE marketing_recommendations SET decision = ? WHERE recommendation_id = ?")
    .run(decision, id);
}

export function hisForPublicId(publicId: string) {
  const snaps = getHomesteadDb()
    .prepare(
      "SELECT * FROM marketing_snapshots WHERE public_id = ? ORDER BY collected_at DESC LIMIT 1",
    )
    .get(publicId) as
    | {
        reach: number | null;
        impressions: number | null;
        likes: number | null;
        comments: number | null;
        shares: number | null;
        saves: number | null;
        profile_visits: number | null;
        link_clicks: number | null;
        messages: number | null;
        whatsapp_clicks: number | null;
        leads: number | null;
      }
    | undefined;
  const leads = getHomesteadDb()
    .prepare("SELECT COUNT(*) as n FROM marketing_leads WHERE public_id = ?")
    .get(publicId) as { n: number };
  const leadTotal = (snaps?.leads || 0) + leads.n;
  const leadKnown = snaps !== undefined || leads.n > 0;
  return homesteadIntentScore({
    reach: snaps?.reach ?? null,
    impression: snaps?.impressions ?? null,
    like: snaps?.likes ?? null,
    comment: snaps?.comments ?? null,
    share: snaps?.shares ?? null,
    save: snaps?.saves ?? null,
    profileVisit: snaps?.profile_visits ?? null,
    linkClick: snaps?.link_clicks ?? null,
    dm: snaps?.messages ?? null,
    whatsappClick: snaps?.whatsapp_clicks ?? null,
    lead: leadKnown ? leadTotal : null,
  });
}
