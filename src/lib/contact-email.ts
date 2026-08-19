import { readFile } from "fs/promises";
import { join } from "path";
import { site } from "@/lib/site";

export type ContactPayload = {
  name: string;
  phone: string;
  email: string;
  property: string;
  service: string;
  message: string;
  photos: File[];
};

type EmailAttachment = {
  filename: string;
  content: Buffer;
  cid?: string;
  contentType?: string;
  contentDisposition?: "inline" | "attachment";
};

const NAVY = "#1f3344";
const NAVY_SOFT = "#3d5568";
const CREAM = "#f6f3ee";
const CREAM_DEEP = "#ebe6dc";
const WHITE = "#fcfaf7";
const MIST = "#7d868c";
const ACCENT = "#c17a4a";
const CHARCOAL = "#2a2d31";

const LOGO_CID = "homestead-logo@homestead.lat";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatReceivedAt() {
  return new Intl.DateTimeFormat("es-PA", {
    timeZone: "America/Panama",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());
}

function labelRow(label: string, valueHtml: string) {
  return `
    <tr>
      <td style="padding:0 0 18px 0;width:34%;vertical-align:top;">
        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${MIST};">
          ${escapeHtml(label)}
        </p>
      </td>
      <td style="padding:0 0 18px 0;vertical-align:top;">
        <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.45;color:${NAVY};">
          ${valueHtml}
        </p>
      </td>
    </tr>
  `;
}

async function logoAttachment(): Promise<EmailAttachment | null> {
  try {
    const content = await readFile(
      join(process.cwd(), "public/images/homesteadservices.png"),
    );
    return {
      filename: "homesteadservices.png",
      content,
      cid: LOGO_CID,
      contentType: "image/png",
      contentDisposition: "inline",
    };
  } catch {
    return null;
  }
}

export async function buildContactEmail(payload: ContactPayload & {
  serviceLabel: string;
  propertyLabel: string;
}): Promise<{ html: string; text: string; attachments: EmailAttachment[] }> {
  const receivedAt = formatReceivedAt();
  const siteUrl = site.url.replace(/\/$/, "");
  const photoCount = payload.photos.length;
  const logo = await logoAttachment();

  const photoAttachments: EmailAttachment[] = await Promise.all(
    payload.photos.map(async (file, index) => ({
      filename: file.name || `foto-${index + 1}.jpg`,
      content: Buffer.from(await file.arrayBuffer()),
      contentType: file.type || "image/jpeg",
      cid: `photo-${index}@homestead.lat`,
    })),
  );

  const photoCells = payload.photos.map((file, index) => {
    const name = file.name || `Foto ${index + 1}`;
    return `
      <td width="50%" valign="top" style="padding:0 8px 16px 0;">
        <img src="cid:photo-${index}@homestead.lat" alt="${escapeHtml(name)}" width="252" style="display:block;width:100%;max-width:252px;height:auto;border:0;border-radius:10px;background:${CREAM_DEEP};" />
        <p style="margin:8px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.04em;color:${MIST};">
          ${escapeHtml(name)} · ${formatBytes(file.size)}
        </p>
      </td>
    `;
  });
  const photoRows: string[] = [];
  for (let index = 0; index < photoCells.length; index += 2) {
    photoRows.push(
      `<tr>${photoCells[index]}${photoCells[index + 1] ?? `<td width="50%"></td>`}</tr>`,
    );
  }
  const photoGrid =
    photoCount === 0
      ? `<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${NAVY_SOFT};">No se adjuntaron fotografías.</p>`
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${photoRows.join("")}</table>`;

  const replyHref = `mailto:${payload.email}?subject=${encodeURIComponent(`Re: ${payload.serviceLabel} — ${payload.name}`)}`;
  const phoneHref = `tel:${payload.phone.replace(/[^\d+]/g, "")}`;
  const preheader = `${payload.serviceLabel} · ${payload.name} · ${payload.propertyLabel}`;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>Nueva solicitud — ${escapeHtml(site.name)}</title>
</head>
<body style="margin:0;padding:0;background:${CREAM};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${CREAM};">
    ${escapeHtml(preheader)}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CREAM};">
    <tr>
      <td align="center" style="padding:32px 16px 40px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${WHITE};border:1px solid ${CREAM_DEEP};">
          <tr>
            <td style="padding:28px 40px 22px;background:${WHITE};border-bottom:1px solid ${CREAM_DEEP};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td valign="middle">
                    ${
                      logo
                        ? `<img src="cid:${LOGO_CID}" alt="${escapeHtml(site.name)}" width="168" style="display:block;width:168px;height:auto;border:0;" />`
                        : `<p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:18px;letter-spacing:0.12em;color:${NAVY};">${escapeHtml(site.name)}</p>`
                    }
                  </td>
                  <td valign="middle" align="right">
                    <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${MIST};">Panamá</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="height:3px;line-height:3px;font-size:0;background:${ACCENT};">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:36px 40px 8px;background:${NAVY};">
              <p style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:${ACCENT};">
                Nueva solicitud
              </p>
              <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.25;font-weight:normal;color:${WHITE};">
                ${escapeHtml(payload.serviceLabel)}
              </h1>
              <p style="margin:12px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:16px;font-style:italic;color:#d7cfc4;">
                ${escapeHtml(site.tagline)}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 40px 28px;background:${NAVY};">
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:0.04em;color:#b7c0c6;">
                Recibida el ${escapeHtml(receivedAt)}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 40px 12px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                ${labelRow("Cliente", escapeHtml(payload.name))}
                ${labelRow(
                  "Teléfono",
                  `<a href="${escapeHtml(phoneHref)}" style="color:${NAVY};text-decoration:none;">${escapeHtml(payload.phone)}</a>`,
                )}
                ${labelRow(
                  "Email",
                  `<a href="mailto:${escapeHtml(payload.email)}" style="color:${NAVY};text-decoration:none;">${escapeHtml(payload.email)}</a>`,
                )}
                ${labelRow("Propiedad", escapeHtml(payload.propertyLabel))}
                ${labelRow("Servicio", escapeHtml(payload.serviceLabel))}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 40px 28px;">
              <p style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${MIST};">
                Mensaje
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:18px 20px;background:${CREAM};border-left:3px solid ${ACCENT};">
                    <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.7;color:${CHARCOAL};white-space:pre-wrap;">
                      ${escapeHtml(payload.message)}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:4px 40px 32px;">
              <p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${MIST};">
                Fotografías${photoCount ? ` · ${photoCount}` : ""}
              </p>
              ${photoGrid}
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 40px;" align="left">
              <a href="${escapeHtml(replyHref)}" style="display:inline-block;padding:14px 28px;background:${NAVY};color:${CREAM};font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;text-decoration:none;">
                Responder al cliente
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 40px;background:${CREAM};border-top:1px solid ${CREAM_DEEP};">
              <p style="margin:0 0 6px;font-family:Georgia,'Times New Roman',serif;font-size:14px;color:${NAVY};">
                ${escapeHtml(site.name)}
              </p>
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:${MIST};">
                ${escapeHtml(site.descriptor)} · ${escapeHtml(site.region)}<br />
                <a href="${escapeHtml(siteUrl)}" style="color:${NAVY_SOFT};text-decoration:none;">${escapeHtml(siteUrl.replace(/^https?:\/\//, ""))}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `${site.name}`,
    site.tagline,
    "",
    "NUEVA SOLICITUD DE SERVICIO",
    `Recibida el ${receivedAt}`,
    "",
    `Servicio: ${payload.serviceLabel}`,
    `Cliente: ${payload.name}`,
    `Teléfono: ${payload.phone}`,
    `Email: ${payload.email}`,
    `Propiedad: ${payload.propertyLabel}`,
    "",
    "Mensaje",
    payload.message,
    "",
    photoCount
      ? `Fotografías: ${payload.photos.map((file) => file.name || "foto").join(", ")}`
      : "Sin fotografías.",
    "",
    siteUrl,
  ].join("\n");

  return {
    html,
    text,
    attachments: logo ? [logo, ...photoAttachments] : photoAttachments,
  };
}
