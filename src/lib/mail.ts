import nodemailer from "nodemailer";
import { getDictionary } from "@/i18n/get-dictionary";
import { site } from "@/lib/site";
import type { FormService, PropertyType } from "@/lib/site";
import { buildContactEmail, type ContactPayload } from "@/lib/contact-email";

export type { ContactPayload };

const inbox =
  process.env.CONTACT_INBOX?.trim() ||
  process.env.NEXT_PUBLIC_EMAIL?.trim() ||
  "";

export function isMailConfigured() {
  return Boolean(
    inbox &&
      process.env.SMTP_HOST?.trim() &&
      process.env.SMTP_USER?.trim() &&
      process.env.SMTP_PASS?.trim(),
  );
}

export async function sendContactEmail(payload: ContactPayload) {
  if (!isMailConfigured()) {
    throw new Error("SMTP is not configured");
  }

  const dictionary = getDictionary();
  const serviceLabel =
    dictionary.form.serviceOptions[payload.service as FormService] ??
    payload.service;
  const propertyLabel =
    dictionary.form.propertyOptions[payload.property as PropertyType] ??
    payload.property;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const email = await buildContactEmail({
    ...payload,
    serviceLabel,
    propertyLabel,
  });

  await transporter.sendMail({
    from: `"${site.name}" <${process.env.SMTP_USER}>`,
    to: inbox,
    replyTo: payload.email,
    subject: `Solicitud · ${serviceLabel} · ${payload.name}`,
    text: email.text,
    html: email.html,
    attachments: email.attachments,
  });
}
