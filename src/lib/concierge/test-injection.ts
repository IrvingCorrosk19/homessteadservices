/**
 * Local/test-only failure injection via DATA_DIR/.concierge-test-inject
 * Never active when NODE_ENV=production.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ConciergeTestInjection =
  | "CALENDAR_READ_FAILURE"
  | "APPOINTMENT_WRITE_FAILURE"
  | "AI_PROVIDER_FAILURE"
  | "TOOL_TIMEOUT"
  | "BUSY_SLOT_AFTER_OFFER"
  | "VISION_ANALYSIS_DELAY"
  | "STALE_SUMMARY_VS_DB"
  | "";

function dataDir() {
  return process.env.DATA_DIR?.trim() || join(process.cwd(), "data");
}

export function readTestInjection(): ConciergeTestInjection {
  if (process.env.NODE_ENV === "production") return "";
  const env = process.env.CONCIERGE_TEST_INJECT?.trim();
  if (env) return env as ConciergeTestInjection;
  const file = join(dataDir(), ".concierge-test-inject");
  if (!existsSync(file)) return "";
  try {
    return readFileSync(file, "utf8").trim() as ConciergeTestInjection;
  } catch {
    return "";
  }
}

export function isTestInjectionActive(flag: ConciergeTestInjection): boolean {
  const raw = readTestInjection();
  if (raw === flag) return true;
  if (flag === "VISION_ANALYSIS_DELAY" && raw.startsWith("VISION_ANALYSIS_DELAY:")) return true;
  return false;
}

export function readVisionAnalysisDelayMs(): number {
  if (process.env.NODE_ENV === "production") return 0;
  const raw = readTestInjection();
  if (raw === "VISION_ANALYSIS_DELAY") return Number(process.env.VISION_ANALYSIS_DELAY_MS || 4000);
  if (raw.startsWith("VISION_ANALYSIS_DELAY:")) return Number(raw.split(":")[1]) || 4000;
  return 0;
}
