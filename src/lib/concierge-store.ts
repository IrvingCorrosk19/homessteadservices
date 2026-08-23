import { createHash, randomUUID } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { getHomesteadDb, homesteadDataDir } from "@/lib/service-requests";
import type { SniffedImage } from "@/lib/photos";
import type { FactConfidence } from "@/lib/concierge/packed-extraction";

export type OfferedSlot = { date: string; time: string; label: string };

export type ConversationState = {
  service: string;
  problem: string;
  location: string;
  name: string;
  phone: string;
  email: string;
  propertyType: string;
  preferredTime: string;
  preferredDate: string;
  intent: string;
  funnelStage: string;
  leadTemperature: string;
  photoCount: number;
  contactStatus: "UNKNOWN" | "INCOMPLETE" | "INVALID" | "VALID";
  offeredSlots: OfferedSlot[];
  pendingSlot: OfferedSlot | null;
  appointmentId: string;
  awaitingSlotSelection: boolean;
  slotOfferToken: string;
  activeLeadId: string;
  historicalSlotLabels: string[];
  humanRequested: boolean;
  lastAvailabilityAt: string;
  detectedServices: string[];
  primaryService: string;
  secondaryServices: string[];
  facts: Record<string, string>;
  urgency: string;
  bookingIntent: boolean;
  bookingStrategy: string;
  questionsAsked: number;
  humanHandoffRequested: boolean;
  needsReview: boolean;
  factConfidence: Record<string, FactConfidence>;
  corrections: string[];
};

const emptyState = (): ConversationState => ({
  service: "",
  problem: "",
  location: "",
  name: "",
  phone: "",
  email: "",
  propertyType: "",
  preferredTime: "",
  preferredDate: "",
  intent: "",
  funnelStage: "DISCOVERY",
  leadTemperature: "COLD",
  photoCount: 0,
  contactStatus: "UNKNOWN",
  offeredSlots: [],
  pendingSlot: null,
  appointmentId: "",
  awaitingSlotSelection: false,
  slotOfferToken: "",
  activeLeadId: "",
  historicalSlotLabels: [],
  humanRequested: false,
  lastAvailabilityAt: "",
  detectedServices: [],
  primaryService: "",
  secondaryServices: [],
  facts: {},
  urgency: "normal",
  bookingIntent: false,
  bookingStrategy: "",
  questionsAsked: 0,
  humanHandoffRequested: false,
  needsReview: false,
  factConfidence: {},
  corrections: [],
});

export function hashIp(ip: string) {
  return createHash("sha256").update(`hs-concierge:${ip}`).digest("hex").slice(0, 24);
}

export function createConversation(ip: string, utm: Record<string, string>, dryRun: boolean) {
  const id = randomUUID();
  const now = new Date().toISOString();
  getHomesteadDb()
    .prepare(
      `INSERT INTO concierge_conversations
        (id, created_at, updated_at, state_json, summary, lead_public_id, dry_run, utm_json, ip_hash, processing)
       VALUES (?, ?, ?, ?, '', '', ?, ?, ?, 0)`,
    )
    .run(id, now, now, JSON.stringify(emptyState()), dryRun ? 1 : 0, JSON.stringify(utm), hashIp(ip));
  return id;
}

export function getConversation(id: string) {
  const row = getHomesteadDb()
    .prepare("SELECT * FROM concierge_conversations WHERE id = ?")
    .get(id) as
    | {
        id: string;
        created_at: string;
        state_json: string;
        summary: string;
        lead_public_id: string;
        dry_run: number;
        utm_json: string;
        processing: number;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.created_at,
    state: { ...emptyState(), ...(JSON.parse(row.state_json || "{}") as ConversationState) },
    summary: row.summary,
    leadPublicId: row.lead_public_id,
    dryRun: Boolean(row.dry_run),
    utm: JSON.parse(row.utm_json || "{}") as Record<string, string>,
    processing: Boolean(row.processing),
  };
}

export function touchConversation(
  id: string,
  patch: Partial<{ state: ConversationState; summary: string; leadPublicId: string; processing: number }>,
) {
  const current = getConversation(id);
  if (!current) return;
  getHomesteadDb()
    .prepare(
      `UPDATE concierge_conversations SET
        state_json = ?, summary = ?, lead_public_id = ?, processing = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      JSON.stringify(patch.state ?? current.state),
      patch.summary ?? current.summary,
      patch.leadPublicId ?? current.leadPublicId,
      patch.processing ?? (current.processing ? 1 : 0),
      new Date().toISOString(),
      id,
    );
}

export function addMessage(id: string, role: "user" | "assistant", body: string) {
  getHomesteadDb()
    .prepare(
      "INSERT INTO concierge_messages (conversation_id, role, body, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(id, role, body, new Date().toISOString());
}

export function recentMessages(id: string, limit = 12) {
  const rows = getHomesteadDb()
    .prepare(
      "SELECT role, body FROM concierge_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?",
    )
    .all(id, limit) as Array<{ role: string; body: string }>;
  return rows.reverse();
}

export function addEvent(id: string, event: string) {
  getHomesteadDb()
    .prepare(
      "INSERT INTO concierge_events (conversation_id, event, created_at) VALUES (?, ?, ?)",
    )
    .run(id, event, new Date().toISOString());
}

export function countRecentMessages(id: string, sinceIso: string) {
  const row = getHomesteadDb()
    .prepare(
      "SELECT COUNT(*) as n FROM concierge_messages WHERE conversation_id = ? AND created_at >= ? AND role = 'user'",
    )
    .get(id, sinceIso) as { n: number };
  return row.n;
}

export function countRecentByIp(ipHash: string, sinceIso: string) {
  const row = getHomesteadDb()
    .prepare(
      `SELECT COUNT(*) as n FROM concierge_messages m
       JOIN concierge_conversations c ON c.id = m.conversation_id
       WHERE c.ip_hash = ? AND m.created_at >= ? AND m.role = 'user'`,
    )
    .get(ipHash, sinceIso) as { n: number };
  return row.n;
}

export function savePhoto(id: string, bytes: Buffer, sniffed: SniffedImage) {
  const dir = join(homesteadDataDir(), "concierge", id);
  mkdirSync(dir, { recursive: true });
  const storedAs = `photo-${Date.now()}.${sniffed.ext}`;
  writeFileSync(join(dir, storedAs), bytes);
  getHomesteadDb()
    .prepare(
      "INSERT INTO concierge_photos (conversation_id, stored_as, mime, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(id, storedAs, sniffed.mime, new Date().toISOString());
  return storedAs;
}

export function photoCount(id: string) {
  const row = getHomesteadDb()
    .prepare("SELECT COUNT(*) as n FROM concierge_photos WHERE conversation_id = ?")
    .get(id) as { n: number };
  return row.n;
}

export function recordUsage(id: string, promptTokens: number, completionTokens: number) {
  getHomesteadDb()
    .prepare(
      "INSERT INTO concierge_usage (conversation_id, prompt_tokens, completion_tokens, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(id, promptTokens, completionTokens, new Date().toISOString());
}

export function tryBeginTurn(id: string) {
  const result = getHomesteadDb()
    .prepare(
      "UPDATE concierge_conversations SET processing = 1, updated_at = ? WHERE id = ? AND processing = 0",
    )
    .run(new Date().toISOString(), id);
  return result.changes === 1;
}

export function endTurn(id: string) {
  getHomesteadDb().prepare("UPDATE concierge_conversations SET processing = 0 WHERE id = ?").run(id);
}
