import { writeFileSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { brandedSocialSet } from "../../../../src/lib/content-images.ts";

const dir = join(import.meta.dirname, "assets");

async function make(label: string, color: string, name: string) {
  const svg = Buffer.from(
    `<svg width="1200" height="1600" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${color}"/><text x="80" y="820" font-size="96" fill="white" font-family="Arial">${label}</text></svg>`,
  );
  const jpeg = await sharp(svg).jpeg({ quality: 92 }).toBuffer();
  writeFileSync(join(dir, name), jpeg);
  return jpeg;
}

const jpeg1 = await make("FOTO-A", "rgb(40,90,140)", "photo1.jpg");
await make("FOTO-B", "rgb(140,70,40)", "photo2.jpg");
await make("FOTO-C", "rgb(40,120,70)", "photo3.jpg");
console.log("photos written");
try {
  const set = await brandedSocialSet(jpeg1);
  writeFileSync(join(dir, "branded-test.jpg"), set.feed.bytes);
  console.log("branded ok", set.feed.width, set.feed.height, set.feed.bytes.length);
} catch (e) {
  console.error("brand failed", e);
  process.exit(1);
}
