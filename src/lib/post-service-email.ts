import { site } from "@/lib/site";

const NAVY = "#1f3344";
const CREAM = "#f6f3ee";
const WHITE = "#fcfaf7";
const MIST = "#7d868c";
const ACCENT = "#c17a4a";
const CHARCOAL = "#2a2d31";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function wrap(title: string, inner: string) {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:${WHITE};border-radius:18px;overflow:hidden;">
          <tr>
            <td style="background:${NAVY};padding:28px 32px;">
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:${ACCENT};">Homestead Services</p>
              <p style="margin:10px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:22px;color:${CREAM};">${escapeHtml(title)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">${inner}</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
}

export function buildPostServiceEmail(input: {
  firstName: string;
  serviceLabel: string;
  feedbackUrl: string;
  jobNumber: string;
}) {
  const hello = input.firstName ? `Hola ${input.firstName}` : "Hola";
  const service = input.serviceLabel.toLowerCase();
  const subject = "¿Cómo quedó todo?";
  const text = [
    `${hello},`,
    "",
    `Gracias por confiar en Homestead para el servicio de ${service}.`,
    "",
    "Queríamos confirmar que todo haya quedado funcionando correctamente.",
    "",
    "¿Cómo fue tu experiencia?",
    input.feedbackUrl,
    "",
    "Si algo no quedó como esperabas, dínoslo. Lo atendemos con prioridad.",
    "",
    site.name,
  ].join("\n");
  const html = wrap(
    "¿Cómo quedó todo?",
    `
      <p style="margin:0 0 16px 0;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.7;color:${CHARCOAL};">${escapeHtml(hello)},</p>
      <p style="margin:0 0 16px 0;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.7;color:${CHARCOAL};">Gracias por confiar en Homestead para el servicio de ${escapeHtml(service)}.</p>
      <p style="margin:0 0 24px 0;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.7;color:${CHARCOAL};">Queríamos confirmar que todo haya quedado funcionando correctamente.</p>
      <p style="margin:0 0 18px 0;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.7;color:${CHARCOAL};">¿Cómo fue tu experiencia?</p>
      <p style="margin:0 0 24px 0;">
        <a href="${escapeHtml(input.feedbackUrl)}" style="display:inline-block;background:${ACCENT};color:${CREAM};text-decoration:none;padding:14px 22px;border-radius:999px;font-family:Arial,Helvetica,sans-serif;font-size:14px;letter-spacing:0.04em;">Contarnos cómo quedó</a>
      </p>
      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${MIST};">Si algo no quedó como esperabas, dínoslo. Lo atendemos con prioridad.</p>
    `,
  );
  return { subject, text, html };
}

export function buildReviewRequestEmail(input: { firstName: string; reviewUrl: string }) {
  const hello = input.firstName ? `Hola ${input.firstName}` : "Hola";
  const subject = "Tu experiencia ayuda a otras personas";
  const text = [
    `${hello},`,
    "",
    "Nos alegra saber que el servicio quedó bien.",
    "",
    "Si deseas compartir tu experiencia, tu reseña ayuda a otras personas a encontrar un servicio confiable.",
    "",
    input.reviewUrl,
    "",
    site.name,
  ].join("\n");
  const html = wrap(
    "Gracias por tu confianza",
    `
      <p style="margin:0 0 16px 0;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.7;color:${CHARCOAL};">${escapeHtml(hello)},</p>
      <p style="margin:0 0 16px 0;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.7;color:${CHARCOAL};">Nos alegra saber que el servicio quedó bien.</p>
      <p style="margin:0 0 24px 0;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.7;color:${CHARCOAL};">Si deseas compartir tu experiencia, tu reseña ayuda a otras personas a encontrar un servicio confiable.</p>
      <p style="margin:0;">
        <a href="${escapeHtml(input.reviewUrl)}" style="display:inline-block;background:${NAVY};color:${CREAM};text-decoration:none;padding:14px 22px;border-radius:999px;font-family:Arial,Helvetica,sans-serif;font-size:14px;letter-spacing:0.04em;">Dejar una reseña</a>
      </p>
    `,
  );
  return { subject, text, html };
}
