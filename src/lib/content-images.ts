import { readFileSync } from "fs";
import { join } from "path";
import sharp from "sharp";

const FEED = { width: 1080, height: 1350 };
const SQUARE = { width: 1080, height: 1080 };

function logoPath() {
  return join(process.cwd(), "public", "images", "homesteadservices.png");
}

export async function metadataOf(bytes: Buffer) {
  const meta = await sharp(bytes).rotate().metadata();
  return {
    width: meta.width || null,
    height: meta.height || null,
  };
}

export async function enhanceDeterministic(bytes: Buffer) {
  return sharp(bytes)
    .rotate()
    .normalize({ lower: 2, upper: 98 })
    .modulate({ brightness: 1.03, saturation: 1.05 })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}

async function coverCrop(bytes: Buffer, width: number, height: number) {
  return sharp(bytes)
    .rotate()
    .resize(width, height, { fit: "cover", position: "attention" })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}

export async function applyHomesteadWatermark(bytes: Buffer) {
  const meta = await sharp(bytes).rotate().metadata();
  const width = meta.width || 1080;
  const logoWidth = Math.max(96, Math.round(width * 0.16));
  const logo = await sharp(readFileSync(logoPath())).resize({ width: logoWidth }).png().toBuffer();
  const logoMeta = await sharp(logo).metadata();
  const overlay = await sharp({
    create: {
      width: (logoMeta.width || logoWidth) + 24,
      height: (logoMeta.height || 40) + 16,
      channels: 4,
      background: { r: 31, g: 51, b: 68, alpha: 0.32 },
    },
  })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toBuffer();

  const output = await sharp(bytes)
    .rotate()
    .composite([{ input: overlay, gravity: "southeast" }])
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  return { bytes: output.data, width: output.info.width, height: output.info.height };
}

export async function brandedSocialSet(bytes: Buffer) {
  const feed = await coverCrop(bytes, FEED.width, FEED.height);
  const square = await coverCrop(bytes, SQUARE.width, SQUARE.height);
  return {
    feed: await applyHomesteadWatermark(feed),
    square: await applyHomesteadWatermark(square),
  };
}
