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

function toHtmlParagraphs(body: string) {
  return escapeHtml(body)
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 16px 0;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.7;color:${CHARCOAL};">${block.replaceAll("\n", "<br />")}</p>`)
    .join("");
}

export function buildReplyEmail(input: {
  customerName: string;
  body: string;
  requestId: string;
}) {
  const firstName = input.customerName.trim().split(/\s+/)[0] || "cliente";
  const html = `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:${WHITE};border-radius:18px;overflow:hidden;">
          <tr>
            <td style="background:${NAVY};padding:28px 32px;">
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:${ACCENT};">Homestead Services</p>
              <p style="margin:10px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:22px;color:${CREAM};">Respuesta a tu solicitud</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 18px 0;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.7;color:${CHARCOAL};">Hola ${escapeHtml(firstName)},</p>
              ${toHtmlParagraphs(input.body)}
              <p style="margin:28px 0 0;border-top:1px solid rgba(31,51,68,0.1);padding-top:18px;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${MIST};">Referencia</p>
              <p style="margin:8px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:16px;color:${NAVY};">${escapeHtml(input.requestId)}</p>
              <p style="margin:24px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${MIST};">${escapeHtml(site.name)}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
  const text = [
    `Hola ${firstName},`,
    "",
    input.body.trim(),
    "",
    "────────────────────",
    `Referencia: ${input.requestId}`,
    site.name,
  ].join("\n");
  return { html, text };
}
