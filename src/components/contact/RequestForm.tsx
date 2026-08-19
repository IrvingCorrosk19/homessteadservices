"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Loader } from "@/components/ui/Loader";
import { useToast } from "@/components/ui/Toast";
import { getDictionary } from "@/i18n/get-dictionary";
import {
  formServices,
  propertyTypes,
  whatsappHref,
  whatsappServiceMessage,
  type FormService,
  type PropertyType,
} from "@/lib/site";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const maxFiles = 6;
const maxBytes = 5 * 1024 * 1024;

type FormState = {
  name: string;
  phone: string;
  email: string;
  property: string;
  service: string;
  message: string;
  website: string;
};

const empty: FormState = {
  name: "",
  phone: "",
  email: "",
  property: "",
  service: "",
  message: "",
  website: "",
};

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
  const [errors, setErrors] = useState<
    Partial<Record<keyof FormState | "files", string>>
  >({});
  const [status, setStatus] = useState<"idle" | "loading" | "success">("idle");
  const [touched, setTouched] = useState<Partial<Record<keyof FormState, boolean>>>(
    {},
  );

  function validate(next: FormState, nextFiles: File[]) {
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
    if (next.message.trim().length < 8) result.message = dictionary.form.errors.message;
    if (
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
      if (touched[key] || errors[key]) {
        setErrors(validate(next, files));
      }
      return next;
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
    setErrors(validate(values, next));
  }

  function removeFile(index: number) {
    const next = files.filter((_, i) => i !== index);
    URL.revokeObjectURL(previews[index]);
    setFiles(next);
    setPreviews(next.map((file) => URL.createObjectURL(file)));
    setErrors(validate(values, next));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors = validate(values, files);
    setErrors(nextErrors);
    setTouched({
      name: true,
      phone: true,
      email: true,
      property: true,
      service: true,
      message: true,
    });
    if (Object.keys(nextErrors).length) return;

    setStatus("loading");
    try {
      const payload = new FormData();
      payload.set("name", values.name);
      payload.set("phone", values.phone);
      payload.set("email", values.email);
      payload.set("property", values.property);
      payload.set("service", values.service);
      payload.set("message", values.message);
      payload.set("website", values.website);
      files.forEach((file) => payload.append("photos", file));

      const response = await fetch("/api/contact", {
        method: "POST",
        body: payload,
      });

      if (!response.ok) throw new Error("request-failed");

      setStatus("success");
      setValues(empty);
      setFiles([]);
      previews.forEach((url) => URL.revokeObjectURL(url));
      setPreviews([]);
    } catch {
      setStatus("idle");
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
        {previews.length > 0 && (
          <ul className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
            {previews.map((src, index) => (
              <li key={src} className="relative overflow-hidden rounded-lg">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="aspect-square w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeFile(index)}
                  className="absolute inset-x-0 bottom-0 bg-navy/80 py-1 text-[0.62rem] uppercase tracking-wider text-cream"
                >
                  {dictionary.form.removePhoto}
                </button>
              </li>
            ))}
          </ul>
        )}
        {errors.files && <p className="mt-2 text-sm text-accent-deep">{errors.files}</p>}
      </div>
      <div className="hidden" aria-hidden="true">
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
            <Loader label={dictionary.form.sending} />
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
