import { normalizeConciergePhoto } from "@/lib/concierge-photo-process";
import {
  analyzeDigitalLockPhotoFromBytes,
  applyVisionToChecklist,
  digitalLockMissingViews,
  digitalLockPhotosComplete,
  digitalLockValidEvidenceCount,
  emptyDigitalLockChecklist,
  knownDigitalLockViews,
  visionFailedResult,
  type DigitalLockChecklist,
  type DigitalLockView,
} from "@/lib/concierge/digital-lock-vision";
import { sniffImage } from "@/lib/photos";
import {
  getServiceRequirements,
  isDigitalLockEvidenceIntent,
  missingEvidenceHumanMessage,
  type ServiceRequirements,
} from "@/lib/service-requirements";

export type FormPhotoBuffer = {
  name: string;
  bytes: Buffer;
  type: string;
  slotHint?: DigitalLockView | "";
};

export type DigitalLockFormValidation = {
  ok: boolean;
  requirements: ServiceRequirements;
  checklist: DigitalLockChecklist;
  missing: DigitalLockView[];
  message: string;
  code: string;
  validCount: number;
};

/**
 * Backend hard gate for digital-lock purchase/install from the public form.
 * Slot hints are ignored for PASS assignment — Vision classification wins.
 */
export async function validateDigitalLockFormEvidence(input: {
  service: string;
  intent?: string | null;
  message?: string;
  photos: FormPhotoBuffer[];
}): Promise<DigitalLockFormValidation> {
  const requirements = getServiceRequirements({
    service: input.service,
    intent: input.intent,
    message: input.message,
  });

  if (!isDigitalLockEvidenceIntent(requirements.intentId) || !requirements.blocksRequestCompletion) {
    return {
      ok: true,
      requirements,
      checklist: emptyDigitalLockChecklist(),
      missing: [],
      message: "",
      code: "",
      validCount: 0,
    };
  }

  let checklist: DigitalLockChecklist = {
    ...emptyDigitalLockChecklist(),
    active: true,
    compatibility: "PHOTO_PRECHECK_INCOMPLETE",
  };

  if (!input.photos.length) {
    const missing = digitalLockMissingViews(checklist);
    return {
      ok: false,
      requirements,
      checklist,
      missing,
      message: missingEvidenceHumanMessage(missing) || requirements.humanGuidance,
      code: requirements.codeIncomplete,
      validCount: 0,
    };
  }

  for (const [index, photo] of input.photos.entries()) {
    const sniffed = sniffImage(photo.bytes, 15 * 1024 * 1024);
    let bytes = photo.bytes;
    if (sniffed) {
      try {
        const normalized = await normalizeConciergePhoto(photo.bytes, sniffed.mime);
        bytes = normalized.bytes;
      } catch {
        // keep original bytes for vision attempt
      }
    }

    const photoId = `form-${String(index + 1).padStart(2, "0")}-${photo.slotHint || "any"}`;
    const analyzed = await analyzeDigitalLockPhotoFromBytes({
      bytes,
      photoId,
      knownViews: knownDigitalLockViews(checklist),
      cachedByHash: checklist.analysisByHash,
      correlationId: "form-contact",
    });

    const vision = analyzed?.vision || visionFailedResult("vision_unavailable");
    const applied = applyVisionToChecklist(checklist, photoId, vision, analyzed?.sha256);
    checklist = applied.checklist;
  }

  const complete = digitalLockPhotosComplete(checklist);
  const missing = digitalLockMissingViews(checklist);
  return {
    ok: complete,
    requirements,
    checklist,
    missing,
    message: complete ? "" : missingEvidenceHumanMessage(missing) || requirements.humanGuidance,
    code: complete ? "" : requirements.codeIncomplete,
    validCount: digitalLockValidEvidenceCount(checklist),
  };
}

export function checklistPublicSummary(checklist: DigitalLockChecklist) {
  return {
    front: checklist.front?.status === "PASS" ? "PASS" : checklist.front?.status || "MISSING",
    inside: checklist.inside?.status === "PASS" ? "PASS" : checklist.inside?.status || "MISSING",
    edge: checklist.edge?.status === "PASS" ? "PASS" : checklist.edge?.status || "MISSING",
    validCount: digitalLockValidEvidenceCount(checklist),
    compatibility: checklist.compatibility,
  };
}
