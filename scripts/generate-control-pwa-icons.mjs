import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "public", "images", "homesteadservices.png");
const outDir = join(root, "public", "admin", "icons");
mkdirSync(outDir, { recursive: true });

const sharp = (await import("sharp")).default;
const navy = { r: 31, g: 51, b: 68, alpha: 1 };

async function square(size, padding) {
  const inner = Math.max(1, size - padding * 2);
  const logo = await sharp(source).resize(inner, inner, { fit: "contain", background: navy }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: navy } })
    .composite([{ input: logo, left: padding, top: padding }])
    .png()
    .toFile(join(outDir, `icon-${size}.png`));
}

async function maskable(size) {
  const inner = Math.round(size * 0.72);
  const logo = await sharp(source).resize(inner, inner, { fit: "contain", background: navy }).png().toBuffer();
  const left = Math.round((size - inner) / 2);
  return sharp({ create: { width: size, height: size, channels: 4, background: navy } })
    .composite([{ input: logo, left, top: left }])
    .png()
    .toFile(join(outDir, `icon-maskable-${size}.png`));
}

await square(192, 24);
await square(512, 64);
await maskable(192);
await maskable(512);
await sharp(source)
  .resize(180, 180, { fit: "contain", background: navy })
  .png()
  .toFile(join(outDir, "apple-touch-180.png"));

console.log("PWA icons written", outDir);
