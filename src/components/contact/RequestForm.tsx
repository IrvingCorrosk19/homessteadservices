"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Loader } from "@/components/ui/Loader";
import { useToast } from "@/components/ui/Toast";
import {
  DigitalLockPhotoSlots,
  type SlotId,
  type SlotState,
} from "@/components/contact/DigitalLockPhotoSlots";
import { getDictionary } from "@/i18n/get-dictionary";
import {
  formServices,
  propertyTypes,
  whatsappHref,
  whatsappServiceMessage,
  type FormService,
  type PropertyType,
} from "@/lib/site";
import {
  getServiceRequirements,
  isDigitalLockEvidenceIntent,
  LOCKSMITH_FORM_INTENTS,
  type ServiceIntentId,
} from "@/lib/service-requirements";
import {
  assessContactMessage,
  CONTACT_EMAIL_PATTERN,
  contactMessageCharsRemaining,
  contactMessageExample,
} from "@/lib/contact-form-validation";
import { MAX_PHOTO_BYTES, MAX_PHOTOS } from "@/lib/photos";

const maxFiles = MAX_PHOTOS;
const maxBytes = MAX_PHOTO_BYTES;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const SLOW_MS = 12_000;
const FETCH_MS = 60_000;

type FormState = {
  name: string;
  phone: string;
  email: string;
  property: string;
  service: string;
  intent: string;
  message: string;
  website: string;
};

type FieldKey = keyof FormState | "files" | "intent" | "digitalLockPhotos";

const empty: FormState = {
  name: "",
  phone: "",
  email: "",
  property: "",
  service: "",
  intent: "",
  message: "",
  website: "",
};

const emptySlots = (): Record<SlotId, SlotState> => ({
  front: { file: null, previewUrl: "", status: "empty" },
  inside: { file: null, previewUrl: "", status: "empty" },
  edge: { file: null, previewUrl: "", status: "empty" },
});

const FIELD_FOCUS_ORDER: FieldKey[] = [
  "name",
  "phone",
  "email",
  "property",
  "service",
  "intent",
  "message",
  "digitalLockPhotos",
  "files",
];

function newSubmissionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `csub_${crypto.randomUUID().replace(/-/g, "")}`;
  }
  return `csub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function RequestForm({
  defaultService = "",
  defaultIntent = "",
  attribution = {},
}: {
  defaultService?: string;
  defaultIntent?: string;
  attribution?: {
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_content?: string;
    hs_ref?: string;
    hs_test?: string;
  };
}) {
  const dictionary = getDictionary();
  const toast = useToast();
  const preset = formServices.includes(defaultService as FormService)
    ? defaultService
    : "";
  const message =
    defaultIntent === "maintenance"
      ? "Quisiera consultar sobre mantenimientos periódicos para mi propiedad."
      : "";

  const [values, setValues] = useState<FormState>({
    ...empty,
    service: preset,
    intent: defaultIntent || "",
    message,
  });
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [slots, setSlots] = useState(emptySlots);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [status, setStatus] = useState<"idle" | "loading" | "success">("idle");
  const [loadingPhase, setLoadingPhase] = useState<"upload" | "send" | "review">("send");
  const [slowHint, setSlowHint] = useState(false);
  const [bannerError, setBannerError] = useState("");
  const [photoHint, setPhotoHint] = useState("");
  const [touched, setTouched] = useState<Partial<Record<keyof FormState, boolean>>>({});
  const [submissionId, setSubmissionId] = useState(newSubmissionId);
  const [successMeta, setSuccessMeta] = useState<{
    requestId: string;
    service: string;
  } | null>(null);
  const [folioCopied, setFolioCopied] = useState(false);
  const [tracking, setTracking] = useState({
    utm_source: attribution.utm_source || "",
    utm_medium: attribution.utm_medium || "",
    utm_campaign: attribution.utm_campaign || "",
    utm_content: attribution.utm_content || "",
    hs_ref: attribution.hs_ref || "",
    hs_test: attribution.hs_test || "",
  });
  const submittingRef = useRef(false);
  const liveRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    setTracking((current) => ({
      utm_source: current.utm_source || params.get("utm_source") || "",
      utm_medium: current.utm_medium || params.get("utm_medium") || "",
      utm_campaign: current.utm_campaign || params.get("utm_campaign") || "",
      utm_content: current.utm_content || params.get("utm_content") || "",
      hs_ref: current.hs_ref || params.get("hs_ref") || params.get("hs") || "",
      hs_test: current.hs_test || params.get("hs_test") || "",
    }));
  }, []);

  const requirements = useMemo(
    () =>
      getServiceRequirements({
        service: values.service,
        intent: values.intent,
        message: values.message,
      }),
    [values.service, values.intent, values.message],
  );
  const needsDigitalLockSlots = isDigitalLockEvidenceIntent(requirements.intentId);
  const showLocksmithIntent = values.service === "locksmith";
  const messageExample = contactMessageExample(values.service);
  const remaining = contactMessageCharsRemaining(values.message);
  const messageHelpId = "contact-message-help";
  const messageErrorId = "contact-message-error";
  const messageCounterId = "contact-message-counter";

  function messageErrorText(issue: ReturnType<typeof assessContactMessage>) {
    if (issue === "low_quality") return dictionary.form.errors.messageQuality;
    if (issue === "too_short" || issue === "empty") return dictionary.form.errors.message;
    return "";
  }

  function validate(next: FormState, nextFiles: File[], nextSlots: Record<SlotId, SlotState>) {
    const result: Partial<Record<FieldKey, string>> = {};
    if (!next.name.trim()) result.name = dictionary.form.errors.name;
    if (!next.phone.trim()) result.phone = dictionary.form.errors.phone;
    if (!CONTACT_EMAIL_PATTERN.test(next.email.trim())) result.email = dictionary.form.errors.email;
    if (!propertyTypes.includes(next.property as PropertyType)) {
      result.property = dictionary.form.errors.property;
    }
    if (!formServices.includes(next.service as FormService)) {
      result.service = dictionary.form.errors.service;
    }
    if (next.service === "locksmith" && !next.intent) {
      result.intent = dictionary.form.errors.intent;
    }
    const issue = assessContactMessage(next.message);
    if (issue) result.message = messageErrorText(issue);

    const req = getServiceRequirements({
      service: next.service,
      intent: next.intent,
      message: next.message,
    });
    if (isDigitalLockEvidenceIntent(req.intentId)) {
      const missing = (["front", "inside", "edge"] as SlotId[]).filter((id) => !nextSlots[id].file);
      if (missing.length) {
        const labels: Record<SlotId, string> = {
          front: "frente",
          inside: "interior",
          edge: "canto",
        };
        result.digitalLockPhotos =
          missing.length === 3
            ? dictionary.form.errors.digitalLockPhotos
            : dictionary.form.errors.digitalLockMissing.replace("{slot}", labels[missing[0]]);
      }
    } else if (
      nextFiles.length > maxFiles ||
      nextFiles.some(
        (file) =>
          file.size > maxBytes || !ALLOWED_TYPES.includes(file.type as (typeof ALLOWED_TYPES)[number]),
      )
    ) {
      result.files = dictionary.form.errors.files;
    }
    return result;
  }

  function focusFirstError(nextErrors: Partial<Record<FieldKey, string>>) {
    const first = FIELD_FOCUS_ORDER.find((key) => nextErrors[key]);
    if (!first) return;
    const id =
      first === "digitalLockPhotos"
        ? "digital-lock-photos"
        : first === "files"
          ? "photos"
          : first === "intent"
            ? "locksmith-intent"
            : first;
    window.requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (el && "focus" in el) (el as HTMLElement).focus();
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setValues((current) => {
      const next = { ...current, [key]: value };
      if (key === "service" && value !== "locksmith") {
        next.intent = "";
      }
      if (touched[key] || errors[key]) {
        setErrors(validate(next, files, slots));
        setBannerError("");
      }
      return next;
    });
    if (key === "service" && value !== "locksmith") {
      clearSlots();
    }
  }

  function markTouched(key: keyof FormState) {
    setTouched((current) => ({ ...current, [key]: true }));
    setErrors(validate({ ...values, [key]: values[key] }, files, slots));
  }

  function clearSlots() {
    setSlots((current) => {
      (Object.keys(current) as SlotId[]).forEach((id) => {
        if (current[id].previewUrl) URL.revokeObjectURL(current[id].previewUrl);
      });
      return emptySlots();
    });
  }

  function onFiles(list: FileList | null) {
    const incoming = Array.from(list ?? []);
    const perFileNotes: string[] = [];
    const accepted: File[] = [];
    for (const file of incoming) {
      if (!ALLOWED_TYPES.includes(file.type as (typeof ALLOWED_TYPES)[number])) {
        perFileNotes.push(`${file.name}: formato no permitido`);
        continue;
      }
      if (file.size > maxBytes) {
        perFileNotes.push(`${file.name}: supera 5 MB`);
        continue;
      }
      accepted.push(file);
    }
    const next = [...files, ...accepted].slice(0, maxFiles);
    if (files.length + accepted.length > maxFiles) {
      perFileNotes.push(`Máximo ${maxFiles} fotografías.`);
    }
    previews.forEach((url) => URL.revokeObjectURL(url));
    setFiles(next);
    setPreviews(next.map((file) => URL.createObjectURL(file)));
    setFileErrors(perFileNotes);
    setErrors(validate(values, next, slots));
  }

  function removeFile(index: number) {
    const next = files.filter((_, i) => i !== index);
    URL.revokeObjectURL(previews[index]);
    setFiles(next);
    setPreviews(next.map((file) => URL.createObjectURL(file)));
    setFileErrors([]);
    setErrors(validate(values, next, slots));
  }

  function onSlotPick(id: SlotId, file: File) {
    setSlots((current) => {
      if (current[id].previewUrl) URL.revokeObjectURL(current[id].previewUrl);
      const next = {
        ...current,
        [id]: {
          file,
          previewUrl: URL.createObjectURL(file),
          status: "ready" as const,
          note: "",
        },
      };
      setErrors(validate(values, files, next));
      return next;
    });
    setPhotoHint("");
    setBannerError("");
  }

  function onSlotClear(id: SlotId) {
    setSlots((current) => {
      if (current[id].previewUrl) URL.revokeObjectURL(current[id].previewUrl);
      const next = {
        ...current,
        [id]: { file: null, previewUrl: "", status: "empty" as const },
      };
      setErrors(validate(values, files, next));
      return next;
    });
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submittingRef.current || status === "loading") return;

    const nextErrors = validate(values, files, slots);
    setErrors(nextErrors);
    setTouched({
      name: true,
      phone: true,
      email: true,
      property: true,
      service: true,
      intent: true,
      message: true,
    });
    if (Object.keys(nextErrors).length) {
      setBannerError(dictionary.form.formErrorBanner);
      focusFirstError(nextErrors);
      return;
    }

    submittingRef.current = true;
    setStatus("loading");
    setBannerError("");
    setSlowHint(false);
    setFolioCopied(false);

    const hasPhotos =
      needsDigitalLockSlots
        ? (["front", "inside", "edge"] as SlotId[]).some((id) => Boolean(slots[id].file))
        : files.length > 0;
    setLoadingPhase(needsDigitalLockSlots ? "review" : hasPhotos ? "upload" : "send");
    setPhotoHint(needsDigitalLockSlots ? dictionary.form.reviewingPhotos : "");

    if (needsDigitalLockSlots) {
      setSlots((current) => {
        const next = { ...current };
        (["front", "inside", "edge"] as SlotId[]).forEach((id) => {
          if (next[id].file) next[id] = { ...next[id], status: "reviewing" };
        });
        return next;
      });
    }

    const slowTimer = window.setTimeout(() => setSlowHint(true), SLOW_MS);
    const controller = new AbortController();
    const hardTimer = window.setTimeout(() => controller.abort(), FETCH_MS);

    try {
      const payload = new FormData();
      payload.set("name", values.name);
      payload.set("phone", values.phone);
      payload.set("email", values.email);
      payload.set("property", values.property);
      payload.set("service", values.service);
      payload.set("intent", values.intent);
      payload.set("message", values.message);
      payload.set("website", values.website);
      payload.set("clientSubmissionId", submissionId);
      payload.set("utm_source", tracking.utm_source);
      payload.set("utm_medium", tracking.utm_medium);
      payload.set("utm_campaign", tracking.utm_campaign);
      payload.set("utm_content", tracking.utm_content);
      payload.set("hs_ref", tracking.hs_ref);
      payload.set("hs_test", tracking.hs_test);

      if (needsDigitalLockSlots) {
        (["front", "inside", "edge"] as SlotId[]).forEach((id) => {
          const slot = slots[id];
          if (slot.file) {
            payload.append("photos", slot.file);
            payload.append("photoSlots", id);
          }
        });
      } else {
        files.forEach((file) => payload.append("photos", file));
      }

      if (hasPhotos && !needsDigitalLockSlots) {
        setLoadingPhase("upload");
      }

      const response = await fetch("/api/contact", {
        method: "POST",
        body: payload,
        signal: controller.signal,
      });

      setLoadingPhase("send");

      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        code?: string;
        requestId?: string;
        fieldErrors?: Record<string, string>;
        evidence?: { front?: string; inside?: string; edge?: string };
        missing?: string[];
      } | null;

      if (!response.ok || !data?.ok) {
        if (data?.fieldErrors) {
          setErrors((current) => ({ ...current, ...data.fieldErrors }));
          setBannerError(data.message || dictionary.form.formErrorBanner);
          focusFirstError(data.fieldErrors);
          setStatus("idle");
          return;
        }
        if (data?.code === "DIGITAL_LOCK_PHOTO_REQUIREMENTS_INCOMPLETE" || response.status === 422) {
          setPhotoHint(data?.message || dictionary.form.errors.digitalLockPhotos);
          setSlots((current) => {
            const next = { ...current };
            (["front", "inside", "edge"] as SlotId[]).forEach((id) => {
              const remote = data?.evidence?.[id];
              if (!next[id].file) {
                next[id] = { ...next[id], status: "empty" };
              } else if (remote === "PASS") {
                next[id] = { ...next[id], status: "pass", note: "" };
              } else {
                next[id] = {
                  ...next[id],
                  status: "reject",
                  note: "Esta imagen no nos sirve como evidencia de esa vista. Prueba con otra foto de la puerta.",
                };
              }
            });
            return next;
          });
          setStatus("idle");
          return;
        }
        throw new Error("request-failed");
      }

      if (!data.requestId) throw new Error("missing-folio");

      setSuccessMeta({
        requestId: data.requestId,
        service: values.service
          ? dictionary.form.serviceOptions[values.service as FormService]
          : values.service,
      });
      setStatus("success");
      setValues(empty);
      setFiles([]);
      previews.forEach((url) => URL.revokeObjectURL(url));
      setPreviews([]);
      clearSlots();
      setPhotoHint("");
      setFileErrors([]);
      setErrors({});
      setSubmissionId(newSubmissionId());
    } catch (error) {
      setStatus("idle");
      setPhotoHint("");
      const uncertain =
        (error instanceof DOMException && error.name === "AbortError") ||
        (error instanceof TypeError);
      toast.push({
        kind: "error",
        title: dictionary.form.errorTitle,
        body: uncertain ? dictionary.form.uncertainSubmit : dictionary.form.errorBody,
      });
      if (liveRef.current) {
        liveRef.current.textContent = uncertain
          ? dictionary.form.uncertainSubmit
          : dictionary.form.errorBody;
      }
    } finally {
      window.clearTimeout(slowTimer);
      window.clearTimeout(hardTimer);
      setSlowHint(false);
      submittingRef.current = false;
    }
  }

  const whatsappLink = whatsappHref(
    whatsappServiceMessage(
      values.service
        ? dictionary.form.serviceOptions[values.service as FormService]
        : undefined,
    ),
  );

  const loadingLabel =
    loadingPhase === "review"
      ? dictionary.form.reviewingPhotos
      : loadingPhase === "upload"
        ? dictionary.form.uploadingPhotos
        : dictionary.form.sending;

  if (status === "success" && successMeta) {
    return (
      <div className="rounded-2xl border border-navy/15 bg-navy px-6 py-10 text-cream md:px-10">
        <p className="text-[0.72rem] tracking-[0.18em] uppercase text-accent">
          {dictionary.form.successTitle}
        </p>
        <p className="mt-4 max-w-lg font-display text-3xl leading-snug">
          {dictionary.form.successBody}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <p className="text-sm">
            <span className="text-cream/70">{dictionary.form.successFolio}: </span>
            <span className="font-medium tracking-wide">{successMeta.requestId}</span>
          </p>
          <button
            type="button"
            className="rounded-lg border border-cream/30 px-3 py-1.5 text-xs uppercase tracking-[0.12em] text-cream hover:border-cream"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(successMeta.requestId);
                setFolioCopied(true);
              } catch {
                setFolioCopied(false);
              }
            }}
          >
            {folioCopied ? dictionary.form.successCopied : dictionary.form.successCopyFolio}
          </button>
        </div>
        {successMeta.service && (
          <p className="mt-4 text-sm text-cream/80">
            {dictionary.form.successSummary}: {successMeta.service}
          </p>
        )}
        <p className="mt-3 max-w-lg text-sm leading-6 text-cream/75">
          {dictionary.form.successNextStep}
        </p>
        <button
          type="button"
          className="mt-8 text-sm underline underline-offset-4"
          onClick={() => {
            setStatus("idle");
            setSuccessMeta(null);
            setFolioCopied(false);
          }}
        >
          {dictionary.form.successAnother}
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-6"
      noValidate
      aria-busy={status === "loading"}
    >
      <div ref={liveRef} className="sr-only" aria-live="polite" aria-atomic="true">
        {status === "loading" ? loadingLabel : ""}
      </div>
      <input type="hidden" name="utm_source" value={tracking.utm_source} />
      <input type="hidden" name="utm_medium" value={tracking.utm_medium} />
      <input type="hidden" name="utm_campaign" value={tracking.utm_campaign} />
      <input type="hidden" name="utm_content" value={tracking.utm_content} />
      <input type="hidden" name="hs_ref" value={tracking.hs_ref} />
      <input type="hidden" name="hs_test" value={tracking.hs_test} />
      <input type="hidden" name="clientSubmissionId" value={submissionId} />

      {bannerError && (
        <div
          role="alert"
          className="rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent-deep"
        >
          {bannerError}
        </div>
      )}

      <Field
        label={`${dictionary.form.name} *`}
        name="name"
        value={values.name}
        error={errors.name}
        disabled={status === "loading"}
        onChange={(value) => setField("name", value)}
        onBlur={() => markTouched("name")}
      />
      <div className="grid gap-6 md:grid-cols-2">
        <Field
          label={`${dictionary.form.phone} *`}
          name="phone"
          type="tel"
          value={values.phone}
          error={errors.phone}
          disabled={status === "loading"}
          onChange={(value) => setField("phone", value)}
          onBlur={() => markTouched("phone")}
        />
        <Field
          label={`${dictionary.form.email} *`}
          name="email"
          type="email"
          value={values.email}
          error={errors.email}
          disabled={status === "loading"}
          onChange={(value) => setField("email", value)}
          onBlur={() => markTouched("email")}
        />
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <SelectField
          label={`${dictionary.form.property} *`}
          name="property"
          value={values.property}
          error={errors.property}
          disabled={status === "loading"}
          onChange={(value) => setField("property", value)}
          onBlur={() => markTouched("property")}
        >
          <option value=""></option>
          {propertyTypes.map((type) => (
            <option key={type} value={type}>
              {dictionary.form.propertyOptions[type]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={`${dictionary.form.service} *`}
          name="service"
          value={values.service}
          error={errors.service}
          disabled={status === "loading"}
          onChange={(value) => setField("service", value)}
          onBlur={() => markTouched("service")}
        >
          <option value=""></option>
          {formServices.map((service) => (
            <option key={service} value={service}>
              {dictionary.form.serviceOptions[service]}
            </option>
          ))}
        </SelectField>
      </div>

      {showLocksmithIntent && (
        <fieldset
          id="locksmith-intent"
          className="rounded-2xl border border-navy/10 bg-cream/60 p-4"
          aria-invalid={Boolean(errors.intent)}
          aria-describedby={errors.intent ? "locksmith-intent-error" : undefined}
        >
          <legend className="px-1 text-[0.78rem] font-medium tracking-[0.12em] uppercase text-navy-soft">
            {dictionary.form.locksmithIntent} *
          </legend>
          <div className="mt-3 grid gap-2">
            {LOCKSMITH_FORM_INTENTS.map((option) => (
              <label
                key={option.id}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 text-sm transition-colors ${
                  values.intent === option.id
                    ? "border-navy bg-white text-navy"
                    : "border-transparent bg-white/70 text-navy-soft hover:border-navy/15"
                }`}
              >
                <input
                  type="radio"
                  name="locksmithIntent"
                  className="mt-1"
                  checked={values.intent === option.id}
                  disabled={status === "loading"}
                  onChange={() => setField("intent", option.id as ServiceIntentId)}
                  onBlur={() => markTouched("intent")}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          {errors.intent && (
            <p id="locksmith-intent-error" className="mt-2 text-sm text-accent-deep" role="alert">
              {errors.intent}
            </p>
          )}
        </fieldset>
      )}

      <div>
        <label
          htmlFor="message"
          className="text-[0.78rem] font-medium tracking-[0.12em] uppercase text-navy-soft"
        >
          {dictionary.form.message} *
        </label>
        <textarea
          id="message"
          name="message"
          rows={5}
          value={values.message}
          placeholder={dictionary.form.messagePlaceholder}
          disabled={status === "loading"}
          onChange={(event) => setField("message", event.target.value)}
          onBlur={() => markTouched("message")}
          aria-invalid={Boolean(errors.message)}
          aria-describedby={[messageHelpId, messageCounterId, errors.message ? messageErrorId : ""]
            .filter(Boolean)
            .join(" ")}
          className={`${inputClass(Boolean(errors.message))} min-h-[8.5rem] resize-y`}
        />
        <p id={messageHelpId} className="mt-2 text-sm leading-6 text-navy-soft">
          {dictionary.form.messageHelp}
        </p>
        {messageExample && (
          <p className="mt-1 text-sm leading-6 text-mist">
            <span className="font-medium text-navy-soft">{dictionary.form.messageExampleLabel}: </span>
            {messageExample}
          </p>
        )}
        <p id={messageCounterId} className="mt-1 text-xs text-mist">
          {dictionary.form.messageMinHint}
          {remaining > 0
            ? ` ${dictionary.form.messageRemaining.replace("{n}", String(remaining))}`
            : ""}
        </p>
        {errors.message && (
          <p id={messageErrorId} className="mt-2 text-sm text-accent-deep" role="alert">
            {errors.message}
          </p>
        )}
      </div>

      {needsDigitalLockSlots ? (
        <div id="digital-lock-photos" tabIndex={-1}>
          <DigitalLockPhotoSlots
            slots={slots}
            onPick={onSlotPick}
            onClear={onSlotClear}
            disabled={status === "loading"}
          />
          {photoHint && <p className="mt-3 text-sm leading-6 text-navy-soft">{photoHint}</p>}
          {errors.digitalLockPhotos && !photoHint && (
            <p className="mt-3 text-sm text-accent-deep" role="alert">
              {errors.digitalLockPhotos}
            </p>
          )}
        </div>
      ) : (
        <div>
          <label
            htmlFor="photos"
            className="text-[0.78rem] font-medium tracking-[0.12em] uppercase text-navy-soft"
          >
            {requirements.requiredPhotos ? dictionary.form.uploadRequired : dictionary.form.upload}
          </label>
          <input
            id="photos"
            name="photos"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={status === "loading"}
            onChange={(event) => onFiles(event.target.files)}
            aria-invalid={Boolean(errors.files)}
            aria-describedby="photos-hint"
            className="mt-2 block w-full text-sm file:mr-4 file:rounded-lg file:border file:border-navy/15 file:bg-cream file:px-4 file:py-2 file:text-[0.72rem] file:tracking-[0.12em] file:uppercase file:text-navy"
          />
          <p id="photos-hint" className="mt-2 text-xs leading-5 text-mist">
            {requirements.requiredPhotos ? dictionary.form.uploadHint : dictionary.form.uploadOptionalHint}
          </p>
          {requirements.humanGuidance && (
            <p className="mt-2 text-xs leading-5 text-navy-soft">{requirements.humanGuidance}</p>
          )}
          {previews.length > 0 && (
            <ul className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
              {previews.map((src, index) => (
                <li key={src} className="relative overflow-hidden rounded-lg">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt={`Foto ${index + 1}`}
                    className="aspect-square w-full object-cover"
                  />
                  <button
                    type="button"
                    className="absolute inset-x-0 bottom-0 bg-navy/80 py-1 text-[0.65rem] uppercase tracking-wide text-cream"
                    onClick={() => removeFile(index)}
                    disabled={status === "loading"}
                  >
                    {dictionary.form.removePhoto}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {fileErrors.map((note) => (
            <p key={note} className="mt-2 text-sm text-accent-deep" role="alert">
              {note}
            </p>
          ))}
          {errors.files && (
            <p className="mt-2 text-sm text-accent-deep" role="alert">
              {errors.files}
            </p>
          )}
        </div>
      )}

      <div className="sr-only" aria-hidden>
        <label htmlFor="website">Website</label>
        <input
          id="website"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={values.website}
          onChange={(event) => setField("website", event.target.value)}
        />
      </div>

      {slowHint && status === "loading" && (
        <p className="text-sm text-navy-soft" role="status">
          {dictionary.form.slowSubmit}
        </p>
      )}

      <div className="flex flex-col gap-4 pb-[env(safe-area-inset-bottom)] sm:flex-row sm:items-center">
        <Button
          type="submit"
          loading={status === "loading"}
          disabled={status === "loading"}
          className="w-full sm:w-auto"
          aria-label={status === "loading" ? loadingLabel : dictionary.form.submit}
        >
          {status === "loading" ? <Loader label={loadingLabel} /> : dictionary.form.submit}
        </Button>
        {whatsappLink && (
          <a
            href={whatsappLink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-navy-soft underline-offset-4 hover:text-navy hover:underline"
          >
            {dictionary.common.whatsapp}
          </a>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  value,
  onChange,
  onBlur,
  error,
  type = "text",
  disabled,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  type?: string;
  disabled?: boolean;
}) {
  const errorId = `${name}-error`;
  return (
    <div>
      <label
        htmlFor={name}
        className="text-[0.78rem] font-medium tracking-[0.12em] uppercase text-navy-soft"
      >
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className={inputClass(Boolean(error))}
        autoComplete={name === "email" ? "email" : name === "phone" ? "tel" : "name"}
      />
      {error && (
        <p id={errorId} className="mt-2 text-sm text-accent-deep" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function SelectField({
  label,
  name,
  value,
  onChange,
  onBlur,
  error,
  children,
  disabled,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  const errorId = `${name}-error`;
  return (
    <div>
      <label
        htmlFor={name}
        className="text-[0.78rem] font-medium tracking-[0.12em] uppercase text-navy-soft"
      >
        {label}
      </label>
      <select
        id={name}
        name={name}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className={inputClass(Boolean(error))}
      >
        {children}
      </select>
      {error && (
        <p id={errorId} className="mt-2 text-sm text-accent-deep" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function inputClass(invalid: boolean) {
  return `mt-2 w-full rounded-lg border bg-white px-4 py-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-navy/40 ${
    invalid ? "border-accent" : "border-navy/15 focus:border-navy"
  }`;
}
