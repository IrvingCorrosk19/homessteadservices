import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const widget = readFileSync(join(root, "src/components/concierge/ConciergeWidget.tsx"), "utf8");
const photoRoute = readFileSync(join(root, "src/app/api/concierge/photo/route.ts"), "utf8");
const photoGet = readFileSync(join(root, "src/app/api/concierge/photos/[storedAs]/route.ts"), "utf8");
const processMod = readFileSync(join(root, "src/lib/concierge-photo-process.ts"), "utf8");
const clientPhoto = readFileSync(join(root, "src/lib/concierge-client-photo.ts"), "utf8");
const photos = readFileSync(join(root, "src/lib/photos.ts"), "utf8");
const chatRoute = readFileSync(join(root, "src/app/api/concierge/chat/route.ts"), "utf8");
const engine = readFileSync(join(root, "src/lib/concierge-engine.ts"), "utf8");
const nginx = readFileSync(join(root, "deploy/vps/nginx-homestead.conf"), "utf8");

let failed = 0;
function ok(name, value) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

ok("IMG-01 preview before send", /pendingPhoto/.test(widget) && /Preparando foto/.test(widget));
ok("IMG-02 remove before send", /Quitar imagen/.test(widget));
ok("IMG-03 object-fit cover preview", /object-cover/.test(widget));
ok("IMG-04 sent image bubble", /photoSrc/.test(widget) && /max-h-44/.test(widget));
ok("IMG-05 lightbox", /lightboxSrc/.test(widget));
ok("IMG-06 uploading state", /Enviando foto/.test(widget));
ok("IMG-07 revoke blob urls", /revokePreparedPhoto/.test(widget));
ok("IMG-08 send enabled with photo only", /canSend/.test(widget));
ok("IMG-09 no auto duplicate photo text", !/Te envié una foto de la zona/.test(widget));

ok("IMG-10 server normalize module", /normalizeConciergePhoto/.test(processMod));
ok("IMG-11 max long edge 1920", /CONCIERGE_PHOTO_LONG_EDGE = 1920/.test(processMod));
ok("IMG-12 withoutEnlargement", /withoutEnlargement:\s*true/.test(processMod));
ok("IMG-13 exif rotate", /\.rotate\(\)/.test(processMod));
ok("IMG-14 jpeg output quality 85", /quality: CONCIERGE_PHOTO_QUALITY/.test(processMod));
ok("IMG-15 dimension bomb guard", /MAX_PHOTO_DIMENSION/.test(processMod));

ok("IMG-16 input max 15mb", /MAX_PHOTO_INPUT_BYTES/.test(photos));
ok("IMG-17 heic declared allowed", /image\/heic/.test(photos));
ok("IMG-18 concierge photo get route", /readConciergePhoto/.test(photoGet));
ok("IMG-19 cookie gated photo serve", /hs_cid/.test(photoGet));

ok("IMG-20 server validates before store", /normalizeConciergePhoto/.test(photoRoute));
ok("IMG-21 structured logs no image data", /ConciergePhotoNormalized/.test(photoRoute) && !/base64/.test(photoRoute));
ok("IMG-22 heic human message", /formato que todavía no podemos procesar/.test(photoRoute));
ok("IMG-23 caption in upload", /caption/.test(photoRoute));
ok("IMG-24 photo turn without duplicate user msg", /skipUserMessage/.test(engine) && /method: "PUT"/.test(widget));

ok("IMG-25 chat history photoId", /parseConciergePhotoMessage/.test(chatRoute) && /photoId/.test(chatRoute));
ok("IMG-26 client side prepare", /prepareConciergePhoto/.test(clientPhoto));
ok("IMG-27 no svg accepted", !/image\/svg/.test(widget));

ok("IMG-28 nginx upload limit documented", /client_max_body_size 12m/.test(nginx));
ok("IMG-29 single file picker", !/multiple/.test(widget.match(/type="file"[\s\S]*?onChange/)?.[0] || ""));
ok("IMG-30 photo link copy preserved", /copyConciergePhotosToRequest/.test(engine));

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nCHAT IMAGE EXPERIENCE static checks OK");
