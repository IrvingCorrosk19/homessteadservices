import { readFileSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { applyHomesteadWatermark } from "@/lib/content-images";

function escapeXml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapLines(text: string, max = 18) {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > max && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

export async function composeCampaignFeed(input: {
  sourceAbsPath: string;
  overlayText: string;
  cta: string;
}) {
  const source = readFileSync(input.sourceAbsPath);
  const feed = await sharp(source)
    .rotate()
    .resize(1080, 1350, { fit: "cover", position: "attention" })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();

  const lines = wrapLines(input.overlayText, 18);
  const lineSvg = lines
    .map((line, index) => {
      const y = 980 + index * 64;
      return `<text x="72" y="${y}" font-size="52" font-weight="700" fill="#f4efe6" font-family="Arial, Helvetica, sans-serif">${escapeXml(line)}</text>`;
    })
    .join("");
  const svg = Buffer.from(
    `<svg width="1080" height="1350" xmlns="http://www.w3.org/2000/svg">
      <rect width="1080" height="56" fill="#1f3344"/>
      <text x="540" y="38" text-anchor="middle" font-size="22" fill="#c4a45a" font-family="Arial, Helvetica, sans-serif" letter-spacing="2">IMAGEN ILUSTRATIVA · NO ES UN TRABAJO DOCUMENTADO</text>
      <rect x="0" y="860" width="1080" height="490" fill="rgba(31,51,68,0.88)"/>
      ${lineSvg}
      <text x="72" y="1248" font-size="28" fill="#c4a45a" font-family="Arial, Helvetica, sans-serif">${escapeXml(input.cta.slice(0, 42))}</text>
    </svg>`,
  );

  const composed = await sharp(feed)
    .composite([{ input: svg, top: 0, left: 0 }])
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  return applyHomesteadWatermark(composed);
}

export function publicImageAbs(webPath: string) {
  const rel = webPath.replace(/^\//, "");
  return join(process.cwd(), "public", ...rel.split("/"));
}
