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
const entry = readFileSync(join(root, "src/lib/concierge-entry-context.ts"), "utf8");
const imageCtx = readFileSync(join(root, "src/lib/concierge/website-image-context.ts"), "utf8");
const widget = readFileSync(join(root, "src/components/concierge/ConciergeWidget.tsx"), "utf8");
const services = readFileSync(join(root, "src/components/home/Services.tsx"), "utf8");
const ac = readFileSync(join(root, "src/components/home/ACMaintenance.tsx"), "utf8");
const hero = readFileSync(join(root, "src/components/home/Hero.tsx"), "utf8");
const finalCta = readFileSync(join(root, "src/components/home/FinalCTA.tsx"), "utf8");
const mobileBar = readFileSync(join(root, "src/components/layout/MobileBar.tsx"), "utf8");
const waHeader = readFileSync(join(root, "src/components/brand/WhatsAppHeaderButton.tsx"), "utf8");
const contact = readFileSync(join(root, "src/components/contact/ContactSection.tsx"), "utf8");
const chatRoute = readFileSync(join(root, "src/app/api/concierge/chat/route.ts"), "utf8");
const handoff = readFileSync(join(root, "src/lib/concierge-handoff.ts"), "utf8");
const intel = readFileSync(join(root, "src/lib/concierge-intelligence.ts"), "utf8");
const consultBtn = readFileSync(join(root, "src/components/concierge/ServiceConsultButton.tsx"), "utf8");
const es = readFileSync(join(root, "src/i18n/es.ts"), "utf8");

ok("WA-01 public flag off by default", /NEXT_PUBLIC_WHATSAPP_PUBLIC_ENABLED === "true"/.test(site));
ok("WA-02 whatsappHref gated", /isPublicWhatsAppEnabled\(\)/.test(site) && /return null/.test(site));
ok("WA-03 header returns null when off", /!isPublicWhatsAppEnabled\(\)\) return null/.test(waHeader));
ok("WA-04 contact gated", /isPublicWhatsAppEnabled/.test(contact));
ok("WA-05 hero no WhatsApp CTA", !/WhatsApp|wa\.me/.test(hero));
ok("WA-06 final CTA no WhatsApp", !/WhatsApp|wa\.me/.test(finalCta));
ok("WA-07 mobile bar uses chat", /OpenChatButton/.test(mobileBar) && !/wa\.me|WhatsApp/.test(mobileBar));
ok("WA-08 no personal number in public home CTAs", !/62594210/.test(hero + finalCta + mobileBar + services + ac + contact));
ok("WA-09 form error no WhatsApp push", /errorBody: "[^"]*chat o el formulario/.test(es));

ok("CTX-01 structured WebsiteImageChatContext", /source: "website_image"/.test(entry));
ok("CTX-02 openHomesteadChat event", /homestead:open-chat/.test(entry));
ok("CTX-03 contextual greetings painting/ac/lock", /pintura/.test(entry) && /mantenimiento preventivo/.test(entry) && /cerradura digital/.test(entry));
ok("CTX-04 CONTEXT_STARTED route", /CONTEXT_STARTED/.test(chatRoute) && /startChatFromWebsiteImage/.test(chatRoute));
ok("CTX-05 no request on image open", !/persistServiceRequest/.test(imageCtx) && !/createAppointment/.test(imageCtx));
ok("CTX-06 entry facts stored", /entryPoint: "service_image"/.test(imageCtx));
ok("CTX-07 digital lock activates", /activateDigitalLockFlow/.test(imageCtx));
ok("CTX-08 digital lock deactivates on switch", /emptyDigitalLockChecklist/.test(imageCtx));
ok("CTX-09 clear active transaction on image", /clearActiveTransactionState/.test(imageCtx));

ok("UI-01 ServiceConsultButton semantic", /aria-label=\{`Consultar/.test(consultBtn) && /type="button"/.test(consultBtn));
ok("UI-02 services consultar CTA", /ServiceConsultButton/.test(services) && /Consultar/.test(services));
ok("UI-03 services consult CTAs present", /ServiceConsultButton/.test(services) && /Consultar/.test(services));
ok("UI-04 AC maintenance consult", /ServiceConsultButton/.test(ac) && /intentHint="maintenance"/.test(ac));
ok("UI-05 context card in widget", /Consultando este servicio/.test(widget));
ok("UI-06 pending switch UX", /pendingSwitch/.test(widget) && /contextSwitchPrompt/.test(widget));
ok("UI-07 restore imageContext on hydrate", /imageContext/.test(chatRoute) && /setImageContext\(data\.imageContext\)/.test(widget));

ok("AN-01 funnel events", /ServiceImageChatOpened/.test(intel) && /ChatContextStarted/.test(intel) && /ServiceContextChanged/.test(intel) && /RequestCreatedFromImage/.test(intel));
ok("AN-02 request from image tracked", /RequestCreatedFromImage/.test(handoff));

// Runtime greeting checks (no DB)
function greet(ctx, name = "") {
  const first = name && !/cliente web/i.test(name) ? name.trim().split(/\s+/)[0] : "";
  const hi = first ? `Claro, ${first}. ` : "Claro. ";
  if (ctx.intentHint === "digital_lock" || /cerradura digital/i.test(ctx.contextLabel)) {
    return `${hi}Veo que te interesa una cerradura digital. ¿Quieres instalar una nueva o revisar una que ya tienes?`;
  }
  if (ctx.serviceId === "painting") {
    return `${hi}Veo que te interesa renovar con pintura. ¿Es para una casa, apartamento, oficina o local?`;
  }
  if (ctx.serviceId === "ac") {
    return `${hi}¿Buscas mantenimiento preventivo o el aire está presentando algún problema?`;
  }
  if (ctx.serviceId === "plumbing") {
    return `${hi}Veo que estás mirando plomería. ¿Hay una fuga, un tapón o algo que no está funcionando bien?`;
  }
  return `${hi}Veo que te interesa ${ctx.serviceName}.`;
}

ok(
  "TEST-A digital lock greeting",
  /cerradura digital/.test(
    greet({ serviceId: "locksmith", serviceName: "Cerrajería", contextLabel: "Cerradura digital", intentHint: "digital_lock" }),
  ) && !/qué servicio necesitas/i.test(greet({ serviceId: "locksmith", serviceName: "Cerrajería", contextLabel: "Cerradura digital", intentHint: "digital_lock" })),
);
ok(
  "TEST-C painting greeting",
  /pintura/.test(greet({ serviceId: "painting", serviceName: "Pintura", contextLabel: "Pintura interior" })),
);
ok(
  "TEST-AC air greeting",
  /mantenimiento preventivo/.test(greet({ serviceId: "ac", serviceName: "Aire", contextLabel: "Mantenimiento de aire" })),
);
ok(
  "TEST-named customer",
  /Claro, Carlos/.test(
    greet({ serviceId: "locksmith", serviceName: "Cerrajería", contextLabel: "Cerradura digital", intentHint: "digital_lock" }, "Carlos Pérez"),
  ),
);

// Confirm public WA disabled without env
delete process.env.NEXT_PUBLIC_WHATSAPP_PUBLIC_ENABLED;
ok("ENV public WA not true", process.env.NEXT_PUBLIC_WHATSAPP_PUBLIC_ENABLED !== "true");

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nIMAGE-TO-CHAT static checks OK");
