import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
let failed = 0;
function ok(name, value) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

const site = readFileSync(join(root, "src/lib/site.ts"), "utf8");
const layout = readFileSync(join(root, "src/app/(public)/layout.tsx"), "utf8");
const header = readFileSync(join(root, "src/components/layout/Header.tsx"), "utf8");
const hero = readFileSync(join(root, "src/components/home/Hero.tsx"), "utf8");
const finalCta = readFileSync(join(root, "src/components/home/FinalCTA.tsx"), "utf8");
const mobileBar = readFileSync(join(root, "src/components/layout/MobileBar.tsx"), "utf8");
const services = readFileSync(join(root, "src/components/home/Services.tsx"), "utf8");
const footer = readFileSync(join(root, "src/components/layout/Footer.tsx"), "utf8");
const contact = readFileSync(join(root, "src/components/contact/ContactSection.tsx"), "utf8");
const form = readFileSync(join(root, "src/components/contact/RequestForm.tsx"), "utf8");
const headerCta = readFileSync(join(root, "src/components/brand/WhatsAppHeaderCta.tsx"), "utf8");
const engine = readFileSync(join(root, "src/lib/concierge-engine.ts"), "utf8");
const opsTelegram = readFileSync(join(root, "src/lib/ops-telegram.ts"), "utf8");
const opsEngine = readFileSync(join(root, "src/lib/ops-engine.ts"), "utf8");
const n8n = readFileSync(join(root, "src/lib/n8n.ts"), "utf8");
const customerSrc = readFileSync(join(root, "src/lib/service-requests.ts"), "utf8");
const compose = readFileSync(join(root, "deploy/vps/docker-compose.yml"), "utf8");

const DEST = "50766616580";
function buildWhatsAppUrl(message) {
  const text = message?.trim() ? `?text=${encodeURIComponent(message.trim())}` : "";
  return `https://wa.me/${DEST}${text}`;
}

ok("WA-01 official destination constant", /destination:\s*"50766616580"/.test(site) && /display:\s*"\+507 6661-6580"/.test(site));
ok("WA-02 helper always official wa.me", /wa\.me\/\$\{OFFICIAL_WHATSAPP\.destination\}/.test(site));
ok("WA-03 default message", /Hola, quisiera información sobre los servicios de Homestead\./.test(site));
ok("WA-04 service message", /Hola, quisiera información sobre el servicio de \$\{serviceLabel/.test(site));
ok("WA-05 request message only HS-YYYY-NNNNNN", /HS_PUBLIC_ID/.test(site) && /\\d\{4\}/.test(site) && /consultar sobre mi solicitud/.test(site));
ok("WA-06 appointment message only HA-[hex8]", /HA-\[a-f0-9\]\{8\}/.test(site) && /consultar sobre mi cita/.test(site));

ok("WA-07 no floating WhatsApp", !/WhatsAppFloatButton|wa-float-btn/.test(layout) && /WhatsAppHeaderCta/.test(header));
ok("WA-08 header Solicitar servicio retained", /dictionary\.common\.request/.test(header) && !/wa\.me/.test(header));
ok("WA-09 hero/final/mobile stay AI or form", !/wa\.me|WhatsAppFloatButton/.test(hero + finalCta + mobileBar) && /OpenChatButton/.test(mobileBar));
ok("WA-10 no personal 62594210", !/62594210/.test([site, header, hero, finalCta, mobileBar, services, footer, contact, form, headerCta].join("\n")));

ok("CTX-01 services secondary official link", /whatsappServiceMessage\(item\.title\)/.test(services));
ok("CTX-02 contact + footer use helper", /whatsappHref\(/.test(contact) && /whatsappHref\(/.test(footer));
ok("CTX-03 form success uses service helper", /whatsappServiceMessage/.test(form));
ok("CTX-04 concierge HS uses official request helper", /whatsappRequestMessage\(leadBanner\)/.test(engine));
ok("CTX-05 header CTA uses official default message", /whatsappDefaultMessage\(\)/.test(headerCta) && /noopener noreferrer/.test(headerCta));

ok("ISO-01 Telegram still customerWhatsAppUrl", /customerWhatsAppUrl/.test(opsTelegram) && /customerWhatsAppUrl/.test(opsEngine) && /customerWhatsAppUrl/.test(n8n));
ok("ISO-02 Telegram still gated by public flag", /isPublicWhatsAppEnabled\(\)/.test(opsTelegram) && /isPublicWhatsAppEnabled\(\)/.test(opsEngine));
ok("ISO-03 customer helper unchanged", /export function customerWhatsAppUrl/.test(customerSrc));
ok("ISO-04 compose does not enable Telegram WA", /NEXT_PUBLIC_WHATSAPP_PUBLIC_ENABLED: \$\{NEXT_PUBLIC_WHATSAPP_PUBLIC_ENABLED:-false\}/.test(compose));

ok(
  "URL-01 default",
  buildWhatsAppUrl("Hola, quisiera información sobre los servicios de Homestead.") ===
    `https://wa.me/${DEST}?text=${encodeURIComponent("Hola, quisiera información sobre los servicios de Homestead.")}`,
);
ok(
  "URL-02 service",
  buildWhatsAppUrl("Hola, quisiera información sobre el servicio de pintura de Homestead.") ===
    `https://wa.me/${DEST}?text=${encodeURIComponent("Hola, quisiera información sobre el servicio de pintura de Homestead.")}`,
);
ok(
  "URL-03 request HS only",
  buildWhatsAppUrl("Hola, quisiera consultar sobre mi solicitud HS-2026-000123") ===
    `https://wa.me/${DEST}?text=${encodeURIComponent("Hola, quisiera consultar sobre mi solicitud HS-2026-000123")}`,
);
ok("URL-04 never customer phone", !buildWhatsAppUrl("hola").includes("62594210") && buildWhatsAppUrl().endsWith(`/${DEST}`));

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nOFFICIAL WHATSAPP static checks OK");
