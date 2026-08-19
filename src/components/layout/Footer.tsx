import Link from "next/link";
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
          <ul className="mt-4 space-y-2 text-sm text-navy">
            {whatsapp && (
              <li>
                <a href={whatsapp} target="_blank" rel="noopener noreferrer">
                  WhatsApp
                </a>
              </li>
            )}
            {phone && (
              <li>
                <a href={phone}>{contact.phone.value}</a>
              </li>
            )}
            {email && (
              <li>
                <a href={email}>{contact.email.value}</a>
              </li>
            )}
            {!whatsapp && !phone && !email && (
              <li className="text-mist">{dictionary.contact.pending}</li>
            )}
          </ul>
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
