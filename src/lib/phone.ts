import regionConfig from "@/data/contact-region.json";

export type PhoneStatus = "VALID" | "INVALID" | "INCOMPLETE" | "UNKNOWN";

export type PhoneAssessment = {
  status: PhoneStatus;
  digits: string;
  e164: string;
  national: string;
  display: string;
};

const ALL_SAME = /^(\d)\1+$/;

export function contactRegion() {
  const minutes = Number(process.env.HOT_LEAD_ATTENTION_MINUTES);
  return {
    ...regionConfig,
    hotLeadAttentionMinutes:
      Number.isFinite(minutes) && minutes > 0 ? minutes : regionConfig.hotLeadAttentionMinutes,
  };
}

export function defaultPhoneRegion() {
  const config = contactRegion();
  return config.regions[config.defaultRegion as keyof typeof config.regions];
}

export function maskPhone(value: string) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length <= 4) return "***";
  return `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

export function looksLikePhoneAttempt(text: string) {
  const trimmed = String(text || "").trim();
  if (!trimmed || trimmed.length > 24) return false;
  if (!/^\+?[\d\s\-().]+$/.test(trimmed)) return false;
  return trimmed.replace(/\D/g, "").length >= 3;
}

const LABELED_PHONE =
  /(?:n[uú]mero|tel[eé]fono|celular|cel|whatsapp|ll[aá]mame|contacto|mi\s+n[uú]m(?:ero)?)\s*(?:es\s*|[:=]\s*)?(\+?\d[\d\s\-().]{5,}\d)/i;

export function extractEmbeddedPhone(text: string) {
  const labeled = text.match(LABELED_PHONE);
  if (labeled?.[1]) return labeled[1].trim();
  const e164 = text.match(/\+507[\s\-]?\d{4}[\s\-]?\d{4}/);
  if (e164) return e164[0];
  const candidates = text.match(/\b\d{4}[\s\-]?\d{4}\b/g) || [];
  for (const candidate of candidates) {
    if (classifyPhone(candidate).status === "VALID") return candidate;
  }
  return "";
}

function panamaNational(digits: string, countryCode: string, nationalLength: number) {
  if (digits.length === nationalLength) return digits;
  if (digits.length === countryCode.length + nationalLength && digits.startsWith(countryCode)) {
    return digits.slice(countryCode.length);
  }
  return "";
}

export function classifyPhone(raw: string): PhoneAssessment {
  const config = contactRegion();
  const region = defaultPhoneRegion();
  const trimmed = String(raw || "").trim();
  if (!trimmed) {
    return { status: "UNKNOWN", digits: "", e164: "", national: "", display: "" };
  }
  if (/[A-Za-z]/.test(trimmed)) {
    return { status: "INVALID", digits: "", e164: "", national: "", display: "" };
  }
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) {
    return { status: "UNKNOWN", digits: "", e164: "", national: "", display: "" };
  }
  if (ALL_SAME.test(digits) || digits === "123" || digits === "000") {
    return { status: "INVALID", digits, e164: "", national: "", display: "" };
  }

  const national = panamaNational(digits, region.countryCode, region.nationalLength);
  if (national && national.length === region.nationalLength && !ALL_SAME.test(national)) {
    const e164 = `+${region.countryCode}${national}`;
    return {
      status: "VALID",
      digits: `${region.countryCode}${national}`,
      e164,
      national,
      display: e164,
    };
  }

  if (digits.length < region.nationalLength) {
    return { status: "INCOMPLETE", digits, e164: "", national: "", display: "" };
  }

  if (
    config.allowInternational &&
    digits.length >= config.internationalMinDigits &&
    digits.length <= config.internationalMaxDigits &&
    !digits.startsWith(region.countryCode)
  ) {
    const e164 = `+${digits}`;
    return {
      status: "VALID",
      digits,
      e164,
      national: "",
      display: e164,
    };
  }

  if (digits.length > region.nationalLength && digits.length < region.e164Length) {
    return { status: "INCOMPLETE", digits, e164: "", national: "", display: "" };
  }

  return { status: "INVALID", digits, e164: "", national: "", display: "" };
}

export function canonicalPhone(raw: string) {
  const assessed = classifyPhone(raw);
  return assessed.status === "VALID" ? assessed.e164 : "";
}

export function alertPhone(raw: string) {
  const assessed = classifyPhone(raw);
  if (assessed.status !== "VALID") return String(raw || "").trim();
  return assessed.national || assessed.e164;
}

export function toWhatsAppDigits(raw: string) {
  const assessed = classifyPhone(raw);
  if (assessed.status !== "VALID") return "";
  return assessed.digits;
}
