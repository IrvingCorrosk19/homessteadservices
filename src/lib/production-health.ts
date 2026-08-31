import { existsSync } from "node:fs";
import { join } from "node:path";
import { getHomesteadDb, homesteadDataDir } from "@/lib/service-requests";
import { getEngineState } from "@/lib/automation-outbox";

export type HealthStatus = "ok" | "degraded" | "fail";

export function checkDatabase(): { status: HealthStatus; detail?: string } {
  try {
    const dbPath = join(homesteadDataDir(), "homestead.sqlite");
    if (!existsSync(dbPath)) {
      return { status: "fail", detail: "database_missing" };
    }
    const db = getHomesteadDb();
    const row = db.prepare("PRAGMA integrity_check").get() as { integrity_check?: string } | undefined;
    const integrity = row?.integrity_check ?? String(row);
    if (integrity !== "ok") {
      return { status: "fail", detail: "integrity_check_failed" };
    }
    db.prepare("SELECT 1 AS ok").get();
    return { status: "ok" };
  } catch {
    return { status: "fail", detail: "database_unreachable" };
  }
}

export function checkAdminConfigured(): HealthStatus {
  const password = process.env.ADMIN_PASSWORD?.trim();
  const secret = process.env.ADMIN_SESSION_SECRET?.trim();
  if (!password || !secret || secret.length < 32) return "degraded";
  return "ok";
}

export function schedulerFreshness(): { status: HealthStatus; lastAt: string | null; ageMinutes: number | null } {
  const row = getEngineState("last_scheduler_at");
  const lastAt = row?.value ?? null;
  if (!lastAt) {
    return { status: "degraded", lastAt: null, ageMinutes: null };
  }
  const ageMs = Date.now() - new Date(lastAt).getTime();
  const ageMinutes = Math.floor(ageMs / 60_000);
  const status: HealthStatus = ageMinutes > 120 ? "degraded" : "ok";
  return { status, lastAt, ageMinutes };
}

export function backupFreshness(): { status: HealthStatus; lastAt: string | null } {
  const row = getEngineState("last_backup_at");
  const lastAt = row?.value ?? null;
  if (!lastAt) return { status: "degraded", lastAt: null };
  const ageHours = (Date.now() - new Date(lastAt).getTime()) / 3_600_000;
  return { status: ageHours > 48 ? "degraded" : "ok", lastAt };
}

export function outboxBacklog(): { status: HealthStatus; pending: number; failed: number } {
  try {
    const db = getHomesteadDb();
    const pendingRow = db
      .prepare("SELECT COUNT(*) AS c FROM automation_outbox WHERE status = 'PENDING'")
      .get() as { c: number } | undefined;
    const failedRow = db
      .prepare("SELECT COUNT(*) AS c FROM automation_outbox WHERE status = 'FAILED'")
      .get() as { c: number } | undefined;
    const pending = Number(pendingRow?.c ?? 0);
    const failed = Number(failedRow?.c ?? 0);
    const status: HealthStatus = pending > 500 || failed > 100 ? "degraded" : "ok";
    return { status, pending, failed };
  } catch {
    return { status: "degraded", pending: -1, failed: -1 };
  }
}

export function livenessPayload() {
  return {
    ok: true,
    service: "homestead-services",
    at: new Date().toISOString(),
  };
}

export function readinessPayload() {
  const db = checkDatabase();
  const scheduler = schedulerFreshness();
  const backup = backupFreshness();
  const outbox = outboxBacklog();
  const admin = checkAdminConfigured();

  const criticalOk = db.status === "ok";
  const degraded =
    scheduler.status === "degraded" ||
    backup.status === "degraded" ||
    outbox.status === "degraded" ||
    admin === "degraded";

  return {
    ok: criticalOk,
    ready: criticalOk,
    degraded: criticalOk && degraded,
    at: new Date().toISOString(),
    checks: {
      database: db,
      adminConfigured: admin,
      scheduler: {
        status: scheduler.status,
        lastAt: scheduler.lastAt,
        ageMinutes: scheduler.ageMinutes,
      },
      backup: {
        status: backup.status,
        lastAt: backup.lastAt,
      },
      outbox: {
        status: outbox.status,
        pending: outbox.pending,
        failed: outbox.failed,
      },
    },
  };
}
