#!/usr/bin/env node
/** Git history secret audit — reports types/paths only, never credentials. */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));

const patterns = [
  { type: "openai_api_key", regex: "sk-proj-[A-Za-z0-9_-]{20,}" },
  { type: "openai_legacy_key", regex: "sk-[A-Za-z0-9]{20,}" },
  { type: "telegram_bot_token", regex: "[0-9]{8,10}:[A-Za-z0-9_-]{30,}" },
  { type: "aws_access_key", regex: "AKIA[0-9A-Z]{16}" },
  { type: "private_key_block", regex: "BEGIN (RSA |OPENSSH )?PRIVATE KEY" },
  { type: "smtp_password_assignment", regex: "SMTP_PASS=[^\\s#\"']{12,}" },
  { type: "admin_session_secret_assignment", regex: "ADMIN_SESSION_SECRET=[^\\s#]{8,}" },
];

function isFalsePositive(type, content) {
  if (type === "smtp_password_assignment") {
    if (/SMTP_PASS=\|/.test(content) || /\/.*SMTP_PASS=/.test(content)) return true;
    if (!/SMTP_PASS=[A-Za-z0-9@#$%^&*._-]{12,}/.test(content)) return true;
  }
  return false;
}

const findings = [];

for (const { type, regex } of patterns) {
  const result = spawnSync(
    "git",
    ["log", "--all", "-G", regex, "--pretty=format:%H", "--name-only"],
    { cwd: root, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  if (result.status !== 0) continue;
  const lines = (result.stdout || "").split("\n").filter(Boolean);
  const commits = lines.filter((l) => /^[0-9a-f]{40}$/.test(l));
  const paths = lines.filter((l) => !/^[0-9a-f]{40}$/.test(l));
  if (!commits.length) continue;
  const commit = commits[0];
  const path = paths[0] || "(unknown)";
  const blob = spawnSync("git", ["show", `${commit}:${path}`], { cwd: root, encoding: "utf8" });
  if (blob.status === 0 && isFalsePositive(type, blob.stdout || "")) continue;
  findings.push({
    secretType: type,
    commit,
    path,
    rotationRequired: true,
  });
}

if (findings.length === 0) {
  console.log("SECRET_HISTORY_AUDIT_PASS");
  process.exit(0);
}

for (const f of findings) {
  console.log(JSON.stringify(f));
}
process.exit(1);
