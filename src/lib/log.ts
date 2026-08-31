type LogFields = Record<string, string | number | boolean | null | undefined>;

const SECRET_PATTERNS = [
  /\bsk-[a-zA-Z0-9_-]{8,}\b/g,
  /\bBearer\s+[a-zA-Z0-9._-]+\b/gi,
  /(password|secret|token|api[_-]?key)\s*[:=]\s*["']?[^\s"']{8,}/gi,
];

function sanitizeValue(value: string | number | boolean | null | undefined) {
  if (typeof value !== "string") return value;
  let out = value;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}

function serialize(event: string, fields: LogFields = {}) {
  const payload: Record<string, string | number | boolean | null> = {
    event,
    timestamp: new Date().toISOString(),
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || key === "event") continue;
    payload[key] = sanitizeValue(value) as string | number | boolean | null;
  }
  return JSON.stringify(payload);
}

export function logInfo(event: string, fields?: LogFields) {
  console.info(serialize(event, fields));
}

export function logError(event: string, fields?: LogFields) {
  console.error(serialize(event, fields));
}
