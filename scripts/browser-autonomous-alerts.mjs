#!/usr/bin/env node
/** Browser/API campaign — Autonomous Alert Center */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const envPath = join(root, ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const BASE = process.env.E2E_BASE_URL || "http://localhost:3005";
const outDir = join(process.env.DATA_DIR || join(root, "data", "e2e-cert"), "autonomous-final");
const outFile = join(outDir, "browser-campaign.json");

let adminCookie = "";
let failed = 0;

async function login() {
  const res = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD || "e2e-local-admin-2026" }),
  });
  const m = (res.headers.get("set-cookie") || "").match(/hs_admin=([^;]+)/);
  if (m) adminCookie = `hs_admin=${m[1]}`;
  return res.ok;
}

async function main() {
  try {
    await fetch(`${BASE}/admin/login`);
  } catch {
    console.error("BLOCKED: server down");
    process.exit(2);
  }
  if (!(await login())) {
    console.error("BLOCKED: login");
    process.exit(2);
  }

  mkdirSync(outDir, { recursive: true });
  const log = [];

  const list = await fetch(`${BASE}/api/admin/autonomous/signals`, { headers: { Cookie: adminCookie } });
  const listData = await list.json();
  log.push({ step: "list", ok: listData.ok, count: listData.signals?.length ?? 0 });
  if (!listData.ok) {
    failed += 1;
    console.error("FAIL list signals");
  } else console.log("PASS list signals");

  if (listData.signals?.length) {
    const id = listData.signals[0].signalId;
    const detail = await fetch(`${BASE}/api/admin/autonomous/signals/${id}`, { headers: { Cookie: adminCookie } });
    const detailData = await detail.json();
    log.push({ step: "detail", ok: detailData.ok });
    if (!detailData.ok) {
      failed += 1;
      console.error("FAIL detail");
    } else console.log("PASS detail");

    const ack = await fetch(`${BASE}/api/admin/autonomous/signals/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ action: "acknowledge" }),
    });
    const ackData = await ack.json();
    log.push({ step: "ack", ok: ackData.ok, status: ackData.status });
    if (!ackData.ok) {
      failed += 1;
      console.error("FAIL ack");
    } else console.log("PASS ack");
  } else {
    console.log("PASS empty inbox (no active signals)");
  }

  writeFileSync(outFile, JSON.stringify({ at: new Date().toISOString(), log }, null, 2));
  if (failed) process.exit(1);
  console.log("\nAUTONOMOUS BROWSER/API CAMPAIGN: PASS");
}

void main();
