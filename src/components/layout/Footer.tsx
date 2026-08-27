import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/Logo";
import { SocialIcons } from "@/components/brand/SocialIcons";
import { contact, emailHref, phoneHref, site, whatsappHref } from "@/lib/site";
import { getDictionary } from "@/i18n/get-dictionary";

export function Footer() {
  const dictionary = getDictionary();
  const year = new Date().getFullYear();
  const phone = phoneHref();
  const email = emailHref();
  const whatsapp = whatsappHref(dictionary.whatsapp.defaultMessage);

  const contactItems: Array<{ key: string; node: ReactNode }> = [];
  if (whatsapp) {
    contactItems.push({
      key: "whatsapp",
      node: (
        <a href={whatsapp} target="_blank" rel="noopener noreferrer">
          WhatsApp
        </a>
      ),
    });
  }
  if (phone) {
    contactItems.push({
      key: "phone",
      node: <a href={phone}>{contact.phone.value}</a>,
    });
  }
  if (email) {
    contactItems.push({
      key: "email",
      node: <a href={email}>{contact.email.value}</a>,
    });
  }
  if (contact.hours.isConfigured) {
    contactItems.push({ key: "hours", node: contact.hours.value });
  }
  if (contact.serviceArea.isConfigured) {
    contactItems.push({ key: "area", node: contact.serviceArea.value });
  }

  return (
    <footer className="border-t border-line bg-cream-deep">
      <div className="container-home grid gap-10 py-14 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Logo href="/" variant="footer" />
          <p className="mt-5 max-w-sm text-sm leading-6 text-navy-soft">
            {dictionary.footer.note}
          </p>
          <div className="mt-8">
            <SocialIcons variant="footer" />
          </div>
        </div>

        <div>
          <p className="text-[0.68rem] font-medium tracking-[0.18em] uppercase text-mist">
            Navegación
          </p>
          <ul className="mt-4 space-y-2 text-sm text-navy">
            <li>
              <Link href="/">Inicio</Link>
            </li>
            <li>
              <Link href="/services">Servicios</Link>
            </li>
            <li>
              <Link href="/#como-funciona">Cómo funciona</Link>
            </li>
            <li>
              <Link href="/contact">Contacto</Link>
            </li>
          </ul>
        </div>

        <div>
          <p className="text-[0.68rem] font-medium tracking-[0.18em] uppercase text-mist">
            Contacto
          </p>
          {contactItems.length > 0 ? (
            <ul className="mt-4 space-y-2 text-sm text-navy">
              {contactItems.map((item) => (
                <li key={item.key}>{item.node}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      <div className="border-t border-line">
        <div className="container-home flex flex-col gap-2 py-5 text-xs text-mist md:flex-row md:justify-between">
          <p>
            © {year} {site.name}. {dictionary.footer.rights}
          </p>
          <p>{site.region}</p>
        </div>
      </div>
    </footer>
  );
}
