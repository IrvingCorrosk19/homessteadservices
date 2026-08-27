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

const header = readFileSync(join(root, "src/components/layout/Header.tsx"), "utf8");
const contact = readFileSync(join(root, "src/components/contact/ContactSection.tsx"), "utf8");
const footer = readFileSync(join(root, "src/components/layout/Footer.tsx"), "utf8");
const hero = readFileSync(join(root, "src/components/home/Hero.tsx"), "utf8");
const finalCta = readFileSync(join(root, "src/components/home/FinalCTA.tsx"), "utf8");
const mobileBar = readFileSync(join(root, "src/components/layout/MobileBar.tsx"), "utf8");
const social = readFileSync(join(root, "src/components/brand/SocialIcons.tsx"), "utf8");
const waHeader = readFileSync(join(root, "src/components/brand/WhatsAppHeaderButton.tsx"), "utf8");
const site = readFileSync(join(root, "src/lib/site.ts"), "utf8");
const knowledge = readFileSync(join(root, "src/lib/concierge-knowledge.ts"), "utf8");
const envExample = readFileSync(join(root, ".env.example"), "utf8");

ok("HDR-01 no WhatsAppHeaderButton mount", !/WhatsAppHeaderButton/.test(header));
ok("HDR-02 solicitar CTA retained", /dictionary\.common\.request/.test(header));

ok("CONTACT-01 no pending placeholder render", !/dictionary\.contact\.pending/.test(contact));
ok("CONTACT-02 only configured rows", /contact\.email\.isConfigured/.test(contact) && /contact\.phone\.isConfigured/.test(contact));
ok("CONTACT-03 whatsapp only if public flag + configured", /isPublicWhatsAppEnabled\(\)/.test(contact));

ok("FOOTER-01 no pending placeholder", !/dictionary\.contact\.pending/.test(footer));
ok("FOOTER-02 whatsapp gated via whatsappHref", /whatsappHref/.test(footer));

ok("CTA-01 hero no WhatsApp text", !/WhatsApp|wa\.me/.test(hero));
ok("CTA-02 final CTA Hablar con Homestead", /Hablar con Homestead/.test(finalCta) && !/WhatsApp/.test(finalCta));
ok("CTA-03 mobile bar chat not WA", /OpenChatButton/.test(mobileBar) && !/WhatsApp|wa\.me/.test(mobileBar));

ok("SOCIAL-01 only platforms with href", /filter\(\(platform\) => Boolean\(platform\.href\)\)/.test(social));
ok("SOCIAL-02 no próximamente buttons", !/is-soon/.test(social) && !/social\.soon/.test(social));

ok("FLAG-01 public WA off by default", /NEXT_PUBLIC_WHATSAPP_PUBLIC_ENABLED === "true"/.test(site));
ok("FLAG-02 whatsappHref returns null when off", /isPublicWhatsAppEnabled\(\)/.test(site));
ok("FLAG-03 header button null when off", /!isPublicWhatsAppEnabled\(\)\) return null/.test(waHeader));
ok("FLAG-04 env example documents flag", /NEXT_PUBLIC_WHATSAPP_PUBLIC_ENABLED=false/.test(envExample));
ok("FLAG-05 concierge knowledge respects flag", /isPublicWhatsAppEnabled\(\) && contact\.whatsapp\.isConfigured/.test(knowledge));

const publicSurfaces = [header, contact, footer, hero, finalCta, mobileBar, social].join("\n");
ok("PUBLIC-01 no wa.me in public components", !/wa\.me/.test(publicSurfaces));
ok("PUBLIC-02 no 62594210 in public components", !/62594210/.test(publicSurfaces));
ok("PUBLIC-03 no Lo publicaremos placeholder usage", !/Lo publicaremos aquí cuando esté confirmado/.test(publicSurfaces));

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nPUBLIC WHATSAPP REMOVAL static checks OK");
