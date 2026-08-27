"use client";

import { useMemo, useState, type ReactNode } from "react";
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

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const maxFiles = 6;
const maxBytes = 5 * 1024 * 1024;

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

export function RequestForm({
  defaultService = "",
  defaultIntent = "",
}: {
  defaultService?: string;
  defaultIntent?: string;
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
    message,
  });
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [slots, setSlots] = useState(emptySlots);
  const [errors, setErrors] = useState<
    Partial<Record<keyof FormState | "files" | "intent" | "digitalLockPhotos", string>>
  >({});
  const [status, setStatus] = useState<"idle" | "loading" | "success">("idle");
  const [photoHint, setPhotoHint] = useState("");
  const [touched, setTouched] = useState<Partial<Record<keyof FormState, boolean>>>({});

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

  function validate(next: FormState, nextFiles: File[], nextSlots: Record<SlotId, SlotState>) {
    const result: typeof errors = {};
    if (!next.name.trim()) result.name = dictionary.form.errors.name;
    if (!next.phone.trim()) result.phone = dictionary.form.errors.phone;
    if (!emailPattern.test(next.email.trim())) result.email = dictionary.form.errors.email;
    if (!propertyTypes.includes(next.property as PropertyType)) {
      result.property = dictionary.form.errors.property;
    }
    if (!formServices.includes(next.service as FormService)) {
      result.service = dictionary.form.errors.service;
    }
    if (next.service === "locksmith" && !next.intent) {
      result.intent = dictionary.form.errors.intent;
    }
    if (next.message.trim().length < 8) result.message = dictionary.form.errors.message;

    const req = getServiceRequirements({
      service: next.service,
      intent: next.intent,
      message: next.message,
    });
    if (isDigitalLockEvidenceIntent(req.intentId)) {
      const missing = (["front", "inside", "edge"] as SlotId[]).filter((id) => !nextSlots[id].file);
      if (missing.length) result.digitalLockPhotos = dictionary.form.errors.digitalLockPhotos;
    } else if (
      nextFiles.length > maxFiles ||
      nextFiles.some(
        (file) =>
          file.size > maxBytes ||
          !["image/jpeg", "image/png", "image/webp"].includes(file.type),
      )
    ) {
      result.files = dictionary.form.errors.files;
    }
    return result;
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setValues((current) => {
      const next = { ...current, [key]: value };
      if (key === "service" && value !== "locksmith") {
        next.intent = "";
      }
      if (touched[key] || errors[key]) {
        setErrors(validate(next, files, slots));
      }
      return next;
    });
    if (key === "service" && value !== "locksmith") {
      clearSlots();
    }
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
    const incoming = Array.from(list ?? []).filter((file) =>
      ["image/jpeg", "image/png", "image/webp"].includes(file.type),
    );
    const next = [...files, ...incoming].slice(0, maxFiles);
    previews.forEach((url) => URL.revokeObjectURL(url));
    setFiles(next);
    setPreviews(next.map((file) => URL.createObjectURL(file)));
    setErrors(validate(values, next, slots));
  }

  function removeFile(index: number) {
    const next = files.filter((_, i) => i !== index);
    URL.revokeObjectURL(previews[index]);
    setFiles(next);
    setPreviews(next.map((file) => URL.createObjectURL(file)));
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
    if (Object.keys(nextErrors).length) return;

    setStatus("loading");
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

      const response = await fetch("/api/contact", {
        method: "POST",
        body: payload,
      });
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        code?: string;
        evidence?: { front?: string; inside?: string; edge?: string };
      } | null;

      if (!response.ok || !data?.ok) {
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

      setStatus("success");
      setValues(empty);
      setFiles([]);
      previews.forEach((url) => URL.revokeObjectURL(url));
      setPreviews([]);
      clearSlots();
      setPhotoHint("");
    } catch {
      setStatus("idle");
      setPhotoHint("");
      toast.push({
        kind: "error",
        title: dictionary.form.errorTitle,
        body: dictionary.form.errorBody,
      });
    }
  }

  const whatsappLink = whatsappHref(
    whatsappServiceMessage(
      values.service
        ? dictionary.form.serviceOptions[values.service as FormService]
        : undefined,
    ),
  );

  if (status === "success") {
    return (
      <div className="rounded-2xl border border-navy/15 bg-navy px-6 py-10 text-cream md:px-10">
        <p className="text-[0.72rem] tracking-[0.18em] uppercase text-accent">
          {dictionary.form.successTitle}
        </p>
        <p className="mt-4 max-w-lg font-display text-3xl leading-snug">
          {dictionary.form.successBody}
        </p>
        <button
          type="button"
          className="mt-8 text-sm underline underline-offset-4"
          onClick={() => setStatus("idle")}
        >
          {dictionary.form.successAnother}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-5" noValidate>
      <Field
        label={dictionary.form.name}
        name="name"
        value={values.name}
        error={errors.name}
        onChange={(value) => setField("name", value)}
        onBlur={() => setTouched((current) => ({ ...current, name: true }))}
      />
      <div className="grid gap-5 md:grid-cols-2">
        <Field
          label={dictionary.form.phone}
          name="phone"
          type="tel"
          value={values.phone}
          error={errors.phone}
          onChange={(value) => setField("phone", value)}
          onBlur={() => setTouched((current) => ({ ...current, phone: true }))}
        />
        <Field
          label={dictionary.form.email}
          name="email"
          type="email"
          value={values.email}
          error={errors.email}
          onChange={(value) => setField("email", value)}
          onBlur={() => setTouched((current) => ({ ...current, email: true }))}
        />
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <SelectField
          label={dictionary.form.property}
          name="property"
          value={values.property}
          error={errors.property}
          onChange={(value) => setField("property", value)}
        >
          <option value=""></option>
          {propertyTypes.map((type) => (
            <option key={type} value={type}>
              {dictionary.form.propertyOptions[type]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={dictionary.form.service}
          name="service"
          value={values.service}
          error={errors.service}
          onChange={(value) => setField("service", value)}
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
        <fieldset className="rounded-2xl border border-navy/10 bg-cream/60 p-4">
          <legend className="px-1 text-[0.72rem] tracking-[0.14em] uppercase text-mist">
            {dictionary.form.locksmithIntent}
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
                  onChange={() => setField("intent", option.id as ServiceIntentId)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          {errors.intent && <p className="mt-2 text-sm text-accent-deep">{errors.intent}</p>}
        </fieldset>
      )}

      <div>
        <label htmlFor="message" className="text-[0.72rem] tracking-[0.14em] uppercase text-mist">
          {dictionary.form.message}
        </label>
        <textarea
          id="message"
          name="message"
          rows={5}
          value={values.message}
          placeholder={dictionary.form.messagePlaceholder}
          onChange={(event) => setField("message", event.target.value)}
          onBlur={() => setTouched((current) => ({ ...current, message: true }))}
          className={`${inputClass(Boolean(errors.message))} resize-y`}
        />
        {errors.message && <p className="mt-2 text-sm text-accent-deep">{errors.message}</p>}
      </div>

      {needsDigitalLockSlots ? (
        <div>
          <DigitalLockPhotoSlots
            slots={slots}
            onPick={onSlotPick}
            onClear={onSlotClear}
            disabled={status === "loading"}
          />
          {photoHint && <p className="mt-3 text-sm leading-6 text-navy-soft">{photoHint}</p>}
          {errors.digitalLockPhotos && !photoHint && (
            <p className="mt-3 text-sm text-navy-soft">{errors.digitalLockPhotos}</p>
          )}
        </div>
      ) : (
        <div>
          <label htmlFor="photos" className="text-[0.72rem] tracking-[0.14em] uppercase text-mist">
            {dictionary.form.upload}
          </label>
          <input
            id="photos"
            name="photos"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(event) => onFiles(event.target.files)}
            className="mt-2 block w-full text-sm file:mr-4 file:rounded-lg file:border file:border-navy/15 file:bg-cream file:px-4 file:py-2 file:text-[0.72rem] file:tracking-[0.12em] file:uppercase file:text-navy"
          />
          <p className="mt-2 text-xs text-mist">{dictionary.form.uploadHint}</p>
          {requirements.humanGuidance && (
            <p className="mt-2 text-xs leading-5 text-navy-soft">{requirements.humanGuidance}</p>
          )}
          {previews.length > 0 && (
            <ul className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
              {previews.map((src, index) => (
                <li key={src} className="relative overflow-hidden rounded-lg">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="aspect-square w-full object-cover" />
                  <button
                    type="button"
                    className="absolute inset-x-0 bottom-0 bg-navy/80 py-1 text-[0.65rem] uppercase tracking-wide text-cream"
                    onClick={() => removeFile(index)}
                  >
                    {dictionary.form.removePhoto}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {errors.files && <p className="mt-2 text-sm text-accent-deep">{errors.files}</p>}
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Button type="submit" loading={status === "loading"} className="w-full sm:w-auto">
          {status === "loading" ? (
            <Loader label={needsDigitalLockSlots ? dictionary.form.reviewingPhotos : dictionary.form.sending} />
          ) : (
            dictionary.form.submit
          )}
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
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  type?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="text-[0.72rem] tracking-[0.14em] uppercase text-mist">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        className={inputClass(Boolean(error))}
        autoComplete={name === "email" ? "email" : name === "phone" ? "tel" : "name"}
      />
      {error && <p className="mt-2 text-sm text-accent-deep">{error}</p>}
    </div>
  );
}

function SelectField({
  label,
  name,
  value,
  onChange,
  error,
  children,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={name} className="text-[0.72rem] tracking-[0.14em] uppercase text-mist">
        {label}
      </label>
      <select
        id={name}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass(Boolean(error))}
      >
        {children}
      </select>
      {error && <p className="mt-2 text-sm text-accent-deep">{error}</p>}
    </div>
  );
}

function inputClass(invalid: boolean) {
  return `mt-2 w-full rounded-lg border bg-white px-4 py-3 text-sm outline-none transition-colors ${
    invalid ? "border-accent" : "border-navy/15 focus:border-navy"
  }`;
}
