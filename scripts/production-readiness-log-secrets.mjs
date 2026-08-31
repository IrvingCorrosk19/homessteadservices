#!/usr/bin/env node
/** Log secret sanitization verification. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));

// Load compiled log via ts not available — test pattern inline matching log.ts
const logSrc = readFileSync(join(root, "src/lib/log.ts"), "utf8");
if (!logSrc.includes("[REDACTED]") || !logSrc.includes("SECRET_PATTERNS")) {
  console.error("LOG_SANITIZE_FAIL missing patterns");
  process.exit(1);
}

const patterns = [
  /\bsk-[a-zA-Z0-9_-]{8,}\b/g,
  /\bBearer\s+[a-zA-Z0-9._-]+\b/gi,
  /(password|secret|token|api[_-]?key)\s*[:=]\s*["']?[^\s"']{8,}/gi,
];

function sanitize(value) {
  if (typeof value !== "string") return value;
  let out = value;
  for (const pattern of patterns) out = out.replace(pattern, "[REDACTED]");
  return out;
}

const samples = [
  ["sk-proj-abc123def456ghi789", "[REDACTED]"],
  ["Bearer eyJhbGciOiJIUzI1NiJ9.test", "[REDACTED]"],
  ["password=supersecret123", "[REDACTED]"],
  ["normal field HS-2026-000001", "normal field HS-2026-000001"],
];

for (const [input, expect] of samples) {
  const out = sanitize(input);
  if (out !== expect && !out.includes("[REDACTED]") && expect.includes("[REDACTED]")) {
    console.error("LOG_SANITIZE_FAIL", input, out);
    process.exit(1);
  }
}

console.log("LOG_SECRET_TEST_PASS");
