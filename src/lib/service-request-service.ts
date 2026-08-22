import { isMailConfigured, sendContactEmail } from "@/lib/mail";
import { logError, logInfo } from "@/lib/log";
import { saveServiceRequest, type BufferedPhoto, type SavedServiceRequest } from "@/lib/service-requests";
import { drainAutomationOutbox } from "@/lib/automation-dispatch";
import { skipOutboxForCorrelation } from "@/lib/automation-outbox";

export type ServiceRequestInput = {
  name: string;
  phone: string;
  email: string;
  property: string;
  service: string;
  message: string;
  photos: BufferedPhoto[];
};

export async function persistServiceRequest(input: ServiceRequestInput): Promise<SavedServiceRequest> {
  return saveServiceRequest(input);
}

export async function dispatchServiceRequest(
  saved: SavedServiceRequest,
  options: { email: boolean; n8n: boolean; photos?: File[] },
) {
  if (options.n8n) {
    logInfo("TelegramNotificationRequested", { requestId: saved.publicId, stage: "n8n" });
    void drainAutomationOutbox();
  } else {
    skipOutboxForCorrelation(saved.publicId, "dispatch_disabled");
  }
  if (options.email && isMailConfigured()) {
    try {
      await sendContactEmail({
        requestId: saved.publicId,
        name: saved.name,
        phone: saved.phone,
        email: saved.email,
        property: saved.property,
        service: saved.service,
        message: saved.message,
        photos: options.photos || [],
      });
      logInfo("EmailNotificationSucceeded", { requestId: saved.publicId });
    } catch (error) {
      logError("EmailNotificationFailed", {
        requestId: saved.publicId,
        cause: error instanceof Error ? error.name : "unknown",
      });
    }
  } else if (options.email && !isMailConfigured()) {
    logError("EmailNotificationFailed", { requestId: saved.publicId, cause: "smtp_not_configured" });
  }
}
