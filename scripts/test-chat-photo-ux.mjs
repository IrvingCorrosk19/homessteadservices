import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const widget = readFileSync(join(root, "src/components/concierge/ConciergeWidget.tsx"), "utf8");
const icons = readFileSync(join(root, "src/components/concierge/ConciergePhotoIcons.tsx"), "utf8");
const cta = readFileSync(join(root, "src/lib/concierge-photo-cta.ts"), "utf8");
const clientPhoto = readFileSync(join(root, "src/lib/concierge-client-photo.ts"), "utf8");
const transaction = readFileSync(join(root, "src/lib/concierge-transaction.ts"), "utf8");
const processMod = readFileSync(join(root, "src/lib/concierge-photo-process.ts"), "utf8");
const photoRoute = readFileSync(join(root, "src/app/api/concierge/photo/route.ts"), "utf8");
const chatRoute = readFileSync(join(root, "src/app/api/concierge/chat/route.ts"), "utf8");
const engine = readFileSync(join(root, "src/lib/concierge-engine.ts"), "utf8");

let failed = 0;
function ok(name, value) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

ok("PHUX-01 no ambiguous plus attach", !/>\s*\+\s*<\/button>/.test(widget) && /CameraIcon/.test(widget));
ok("PHUX-02 camera menu take photo", /Tomar una foto|Tomar foto/.test(widget));
ok("PHUX-03 gallery menu choose photo", /Elegir una fotograf|Adjuntar imagen/.test(widget));
ok("PHUX-04 mobile capture input", /capture="environment"/.test(widget));
ok("PHUX-05 separate gallery input", /galleryRef/.test(widget));
ok("PHUX-06 aria send photo", /aria-label="Enviar fotograf/.test(widget));
ok("PHUX-07 desktop tooltip", /title="Enviar foto"/.test(widget));
ok("PHUX-08 preview before send", /pendingPhotos/.test(widget) && /Preparando foto/.test(widget));
ok("PHUX-09 remove pending", /Eliminar fotograf/.test(widget) && /removePendingPhoto/.test(widget));
ok("PHUX-10 replace pending", /Cambiar fotograf/.test(widget) && /setReplacePhotoId/.test(widget));
ok("PHUX-11 multi pending strip", /Agregar otra foto/.test(widget) && /photoPreviewUrls/.test(widget));
ok("PHUX-12 lightbox pending", /setLightboxSrc\(photo\.previewUrl\)/.test(widget));
ok("PHUX-13 sent bubble no delete", !/Eliminar fotograf/.test(widget.split("imageSources.map")[0] || widget));
ok("PHUX-14 contextual cta", /contextualPhotoCta/.test(widget) && /assistantRequestsPhoto/.test(widget));
ok("PHUX-15 showPhotoCta session", /showPhotoCta/.test(transaction) && /showPhotoCta/.test(chatRoute));
ok("PHUX-16 photos remaining cap", /photosRemaining/.test(transaction) && /photosRemainingFromCount/.test(cta));
ok("PHUX-17 premium icons component", /CameraIcon/.test(icons) && /ImageIcon/.test(icons) && /TrashIcon/.test(icons));
ok("PHUX-18 client exif orientation", /imageOrientation:\s*"from-image"/.test(clientPhoto));
ok("PHUX-19 server exif rotate", /\.rotate\(\)/.test(processMod));
ok("PHUX-20 normalization 1920", /CONCIERGE_PHOTO_LONG_EDGE = 1920/.test(processMod));
ok("PHUX-21 human errors", /demasiado grande|No pudimos leer/.test(photoRoute + widget));
ok("PHUX-22 double send guard", /pendingRef/.test(widget));
ok("PHUX-23 single turn multi upload", /uploadPhotoTurn\(snapshot/.test(widget) && /method: "PUT"/.test(widget));
ok("PHUX-24 playbook photo cta", /PHOTO_REVIEW_FIRST/.test(transaction));
ok("PHUX-25 no svg accept", !/image\/svg/.test(widget));
ok("PHUX-26 touch target 44px", /min-h-11 min-w-11/.test(widget));
ok("PHUX-27 revoke blob urls", /revokePreparedPhoto/.test(widget));
ok("PHUX-28 engine photo count metadata", /photoCount\(/.test(engine));
ok("PHUX-29 placeholder when photo selected", /Añade un mensaje/.test(widget));
ok("PHUX-30 no multiple on single input", !/type="file"[\s\S]*multiple/.test(widget));

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nCHAT PHOTO UX static checks OK");
