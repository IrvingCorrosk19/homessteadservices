type LogFields = Record<string, string | number | boolean | null | undefined>;

function serialize(event: string, fields: LogFields = {}) {
  const payload: Record<string, string | number | boolean | null> = {
    event,
    timestamp: new Date().toISOString(),
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || key === "event") continue;
    payload[key] = value;
  }
  return JSON.stringify(payload);
}

export function logInfo(event: string, fields?: LogFields) {
  console.info(serialize(event, fields));
}

export function logError(event: string, fields?: LogFields) {
  console.error(serialize(event, fields));
}
