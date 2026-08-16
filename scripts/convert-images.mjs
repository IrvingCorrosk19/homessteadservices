import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const raw = path.resolve("public/images/raw");
const out = path.resolve("public/images");

const jobs = [
  { src: "hero.jpg", dest: "hero.webp", width: 2000 },
  { src: "contact.jpg", dest: "cta.webp", width: 1920 },
  { src: "contact.jpg", dest: "contact.webp", width: 1600 },
  { src: "plumbing-alt.jpg", dest: "services/ac.webp", width: 1400 },
  { src: "plumbing-alt.jpg", dest: "features/ac-maintenance.webp", width: 1600 },
  { src: "plumbing.jpg", dest: "services/plumbing.webp", width: 1400 },
  { src: "painting.jpg", dest: "services/painting.webp", width: 1400 },
  { src: "electrical.jpg", dest: "services/electrical.webp", width: 1400 },
  { src: "locksmith.jpg", dest: "services/locksmith.webp", width: 1400 },
  { src: "repairs-alt.jpg", dest: "services/repairs.webp", width: 1400 },
  { src: "remodeling.jpg", dest: "services/remodeling.webp", width: 1400 },
];

await mkdir(path.join(out, "services"), { recursive: true });
await mkdir(path.join(out, "features"), { recursive: true });

for (const job of jobs) {
  const dest = path.join(out, job.dest);
  await sharp(path.join(raw, job.src))
    .rotate()
    .resize({ width: job.width, withoutEnlargement: true })
    .webp({ quality: 78 })
    .toFile(dest);
  console.log("wrote", job.dest);
}
