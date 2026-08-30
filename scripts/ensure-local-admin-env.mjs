#!/usr/bin/env node
/** Local E2E only — sets ADMIN_PASSWORD if missing/empty in .env.local */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const path = join(process.cwd(), ".env.local");
let text = existsSync(path) ? readFileSync(path, "utf8") : "";

function upsert(key, value) {
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(text)) text = text.replace(re, `${key}=${value}`);
  else text += `\n${key}=${value}\n`;
}

const needsPassword = !/^ADMIN_PASSWORD=\S+/m.test(text);
const needsSecret = !/^ADMIN_SESSION_SECRET=\S+/m.test(text);
if (needsPassword) upsert("ADMIN_PASSWORD", "e2e-local-admin-2026");
if (needsSecret) upsert("ADMIN_SESSION_SECRET", "e2e-local-session-secret-32chars-min");
if (needsPassword || needsSecret) {
  writeFileSync(path, text);
  console.log("Configured local admin auth for E2E (.env.local only). Restart dev server if running.");
} else {
  console.log("Admin auth already configured in .env.local");
}
