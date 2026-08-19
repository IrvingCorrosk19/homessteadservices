import nodemailer from "nodemailer";
import { getDictionary } from "@/i18n/get-dictionary";
import { site } from "@/lib/site";
import type { FormService, PropertyType } from "@/lib/site";
import { buildContactEmail, type ContactPayload } from "@/lib/contact-email";
import { buildReplyEmail } from "@/lib/reply-email";
import {
  beginReplyLock,
  clearReplyLock,
  getRequestByPublicId,
  recordOutboundEmail,
} from "@/lib/service-requests";

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
    subject: payload.requestId
      ? `Solicitud ${payload.requestId} · ${serviceLabel} · ${payload.name}`
      : `Solicitud · ${serviceLabel} · ${payload.name}`,
    text: email.text,
    html: email.html,
    attachments: email.attachments,
  });
}

function transporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

export async function sendAdminReply(input: {
  publicId: string;
  subject: string;
  body: string;
}) {
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (subject.length < 3 || body.length < 8) {
    return { ok: false as const, error: "invalid_message" };
  }
  const request = getRequestByPublicId(input.publicId);
  if (!request) return { ok: false as const, error: "not_found" };
  if (!isMailConfigured()) return { ok: false as const, error: "smtp_not_configured" };
  if (!beginReplyLock(request.publicId)) {
    return { ok: false as const, error: "in_progress" };
  }
  const from = process.env.SMTP_USER?.trim() || inbox;
  const reply = buildReplyEmail({
    customerName: request.name,
    body,
    requestId: request.publicId,
  });
  try {
    await transporter().sendMail({
      from: `"${site.name}" <${from}>`,
      to: request.email,
      replyTo: inbox || from,
      subject,
      text: reply.text,
      html: reply.html,
    });
    recordOutboundEmail({ request, subject, body, sent: true });
    return { ok: true as const, requestId: request.publicId };
  } catch {
    recordOutboundEmail({ request, subject, body, sent: false });
    return { ok: false as const, error: "smtp_failed" };
  } finally {
    clearReplyLock(request.publicId);
  }
}
