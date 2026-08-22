import {
  signHomesteadPayload,
  signaturesMatch,
} from "@/lib/homestead-signature";

const MAX_SKEW_SECONDS = 300;

export function homesteadInternalSecret() {
  return process.env.N8N_HOMESTEAD_WEBHOOK_SECRET?.trim() || "";
}

export function verifyInternalHomesteadRequest(
  request: Request,
  payload: unknown,
  options: { requireHmac?: boolean } = {},
) {
  const secret = homesteadInternalSecret();
  if (!secret) return false;
  const headerSecret =
    request.headers.get("x-homestead-webhook-secret")?.trim() || "";
  const timestamp = request.headers.get("x-homestead-timestamp")?.trim() || "";
  const signature = request.headers.get("x-homestead-signature")?.trim() || "";
  const now = Math.floor(Date.now() / 1000);
  const ts = Number(timestamp);
  if (!timestamp || !Number.isFinite(ts) || Math.abs(now - ts) > MAX_SKEW_SECONDS) {
    return false;
  }
  if (headerSecret !== secret) return false;
  // n8n 2.3.6 Code/Crypto cannot HMAC the live payload. Scheduler and Content Studio
  // send secret + timestamp only. HMAC is generated on Homestead → n8n outbound.
  if (options.requireHmac || signature) {
    if (!signature) return false;
    const expected = signHomesteadPayload(secret, timestamp, payload);
    return signaturesMatch(expected, signature);
  }
  return true;
}

export function telegramWebhookSecret() {
  return process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || "";
}

export function verifyTelegramSecretToken(request: Request) {
  const expected = telegramWebhookSecret();
  if (!expected) return false;
  const provided =
    request.headers.get("x-telegram-bot-api-secret-token")?.trim() || "";
  return provided === expected;
}
