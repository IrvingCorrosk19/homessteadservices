import { getDictionary } from "@/i18n/get-dictionary";
import { signHomesteadPayload } from "@/lib/homestead-signature";
import { logError, logInfo } from "@/lib/log";
import { buildSignedPhotoUrl } from "@/lib/photos";
import {
  customerWhatsAppUrl,
  recordTelegramNotified,
  type SavedServiceRequest,
} from "@/lib/service-requests";
import { site } from "@/lib/site";
import type { FormService, PropertyType } from "@/lib/site";

const TIMEOUT_MS = 25000;

export type HomesteadN8nPayload = {
  event: "service_request.created";
  requestId: string;
  createdAt: string;
  customer: {
    name: string;
    phone: string;
    email: string;
  };
  service: {
    slug: string;
    type: string;
    property: string;
    description: string;
  };
  photos: {
    count: number;
    items: Array<{
      file: string;
      contentType: string;
      url: string;
    }>;
  };
  actions: {
    contactWhatsApp: string | null;
    replyUrl: string;
  };
};

export function isN8nConfigured() {
  return Boolean(
    process.env.N8N_HOMESTEAD_WEBHOOK_URL?.trim() &&
      process.env.N8N_HOMESTEAD_WEBHOOK_SECRET?.trim(),
  );
}

export function buildN8nPayload(saved: SavedServiceRequest): HomesteadN8nPayload {
  const dictionary = getDictionary();
  const serviceLabel =
    dictionary.form.serviceOptions[saved.service as FormService] ?? saved.service;
  const propertyLabel =
    dictionary.form.propertyOptions[saved.property as PropertyType] ?? saved.property;
  const secret = process.env.N8N_HOMESTEAD_WEBHOOK_SECRET?.trim() || "";
  const siteUrl = site.url.replace(/\/$/, "");
  const items = saved.photos.map((photo) => ({
    file: photo.storedAs,
    contentType: photo.type,
    url: secret
      ? buildSignedPhotoUrl({
          siteUrl,
          secret,
          requestId: saved.publicId,
          file: photo.storedAs,
        })
      : "",
  }));
  return {
    event: "service_request.created",
    requestId: saved.publicId,
    createdAt: saved.createdAt,
    customer: {
      name: saved.name,
      phone: saved.phone,
      email: saved.email,
    },
    service: {
      slug: saved.service,
      type: serviceLabel,
      property: propertyLabel,
      description: saved.message,
    },
    photos: {
      count: items.length,
      items: items.filter((item) => item.url),
    },
    actions: {
      contactWhatsApp: customerWhatsAppUrl(
        saved.phone,
        `Hola ${saved.name}, le contactamos de Homestead Services con relación a su solicitud ${saved.publicId}.`,
      ),
      replyUrl: `${siteUrl}/admin/solicitudes/${saved.publicId}`,
    },
  };
}

export async function postN8nPayload(
  payload: HomesteadN8nPayload | Record<string, unknown>,
  meta: { eventId?: string; idempotencyKey: string; correlationId: string },
) {
  const configured = process.env.N8N_HOMESTEAD_WEBHOOK_URL?.trim();
  const override = process.env.AUTOMATION_N8N_URL_OVERRIDE?.trim();
  const url = override || configured;
  const secret = process.env.N8N_HOMESTEAD_WEBHOOK_SECRET?.trim();
  const requestId = meta.correlationId;
  if (!url || !secret) {
    logInfo("N8nNotificationSkipped", { requestId, reason: "not_configured" });
    return { ok: false as const, cause: "not_configured", httpStatus: 0, durationMs: 0 };
  }

  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signHomesteadPayload(secret, timestamp, payload);
  const requestedAt = new Date().toISOString();
  const photoCount = Number((payload as HomesteadN8nPayload).photos?.count || 0);

  logInfo("N8nNotificationRequested", {
    requestId,
    eventType: String((payload as HomesteadN8nPayload).event || meta.idempotencyKey),
    requestedAt,
    photoCount,
  });
  if (photoCount > 0) {
    logInfo("TelegramPhotosQueued", { requestId, photoCount });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Homestead-Timestamp": timestamp,
        "X-Homestead-Signature": `sha256=${signature}`,
        "X-Homestead-Webhook-Secret": secret,
        "X-Homestead-Idempotency-Key": meta.idempotencyKey,
        ...(meta.eventId ? { "X-Homestead-Event-Id": meta.eventId } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const durationMs = Date.now() - Date.parse(requestedAt);
    if (!response.ok) {
      logError("N8nNotificationFailed", {
        requestId,
        eventType: String((payload as HomesteadN8nPayload).event || ""),
        httpStatus: response.status,
        cause: `http_${response.status}`,
      });
      return { ok: false as const, cause: `http_${response.status}`, httpStatus: response.status, durationMs };
    }
    logInfo("N8nNotificationSucceeded", {
      requestId,
      eventType: String((payload as HomesteadN8nPayload).event || ""),
      httpStatus: response.status,
      durationMs,
    });
    return { ok: true as const, cause: "ok", httpStatus: response.status, durationMs };
  } catch (error) {
    const cause =
      error instanceof Error
        ? error.name === "AbortError"
          ? "timeout"
          : "network_error"
        : "unknown";
    logError("N8nNotificationFailed", {
      requestId,
      eventType: String((payload as HomesteadN8nPayload).event || ""),
      cause,
    });
    return { ok: false as const, cause, httpStatus: 0, durationMs: Date.now() - Date.parse(requestedAt) };
  } finally {
    clearTimeout(timer);
  }
}

export async function notifyN8n(saved: SavedServiceRequest) {
  const payload = buildN8nPayload(saved);
  const result = await postN8nPayload(payload, {
    idempotencyKey: `${payload.event}:${payload.requestId}`,
    correlationId: saved.publicId,
  });
  if (result.ok) recordTelegramNotified(saved);
}
