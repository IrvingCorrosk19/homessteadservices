import { randomBytes, randomUUID } from "crypto";
import { getHomesteadDb } from "@/lib/service-requests";
import { autonomousConfig } from "@/lib/autonomous/config";
import { autonomousNow } from "@/lib/autonomous/clock";
import { getSignalById, incrementAutonomousMetric } from "@/lib/autonomous/signal-store";
import { acknowledgeSignal } from "@/lib/autonomous/signal-store";
import type { OperationalSignal } from "@/lib/autonomous/types";

export function createAcknowledgeToken(signal: OperationalSignal): string | null {
  const cfg = autonomousConfig();
  const token = randomBytes(16).toString("hex");
  const now = autonomousNow();
  const expires = new Date(now.getTime() + cfg.actionTokenTtlMinutes * 60_000).toISOString();
  getHomesteadDb()
    .prepare(
      `INSERT INTO autonomous_action_tokens
       (token, signal_id, operator_id, action, target_type, target_id, state_version, nonce, expires_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      token,
      signal.signalId,
      null,
      "acknowledge",
      signal.entityType || "signal",
      signal.entityId || signal.signalId,
      signal.stateVersion,
      randomUUID(),
      expires,
      now.toISOString(),
    );
  return token;
}

export type ActionTokenResult =
  | { ok: true; action: string; signalId: string }
  | { ok: false; reason: "expired" | "used" | "stale" | "not_found" | "forbidden" };

export function consumeActionToken(token: string, expectedAction?: string): ActionTokenResult {
  const db = getHomesteadDb();
  const row = db
    .prepare("SELECT * FROM autonomous_action_tokens WHERE token = ?")
    .get(token) as
    | {
        token: string;
        signal_id: string;
        action: string;
        state_version: string;
        expires_at: string;
        used_at: string | null;
      }
    | undefined;

  if (!row) return { ok: false, reason: "not_found" };
  if (row.used_at) return { ok: false, reason: "used" };
  if (Date.parse(row.expires_at) < autonomousNow().getTime()) return { ok: false, reason: "expired" };

  const signal = getSignalById(row.signal_id);
  if (!signal) return { ok: false, reason: "not_found" };
  if (signal.stateVersion !== row.state_version) return { ok: false, reason: "stale" };
  if (expectedAction && row.action !== expectedAction) return { ok: false, reason: "forbidden" };

  const now = autonomousNow().toISOString();
  db.prepare("UPDATE autonomous_action_tokens SET used_at = ? WHERE token = ?").run(now, token);

  if (row.action === "acknowledge") {
    acknowledgeSignal(row.signal_id);
    incrementAutonomousMetric("autonomous_ack_via_token");
  }

  return { ok: true, action: row.action, signalId: row.signal_id };
}

export function isHighImpactTokenAction(action: string): boolean {
  return !["acknowledge", "view"].includes(action);
}
