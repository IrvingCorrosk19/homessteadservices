import { phoneHref, whatsappHref } from "@/lib/site";
import { getDictionary } from "@/i18n/get-dictionary";

export function MobileBar() {
  const dictionary = getDictionary();
  const phone = phoneHref();
  const whatsapp = whatsappHref(dictionary.whatsapp.defaultMessage);
  const columns = phone ? "grid-cols-3" : "grid-cols-2";

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-cream/95 backdrop-blur-md md:hidden"
      aria-label="Acceso rápido"
    >
      <div className={`grid ${columns}`}>
        {phone && (
          <a
            href={phone}
            className="flex min-h-14 flex-col items-center justify-center text-[0.68rem] tracking-[0.12em] uppercase text-navy"
          >
            {dictionary.common.call}
          </a>
        )}
        <a
          href={whatsapp ?? "/contact"}
          target={whatsapp ? "_blank" : undefined}
          rel={whatsapp ? "noopener noreferrer" : undefined}
          className="flex min-h-14 flex-col items-center justify-center border-x border-line text-[0.68rem] tracking-[0.12em] uppercase text-navy"
        >
          {dictionary.whatsapp.label}
        </a>
        <a
          href="/contact"
          className="flex min-h-14 flex-col items-center justify-center bg-navy text-[0.68rem] tracking-[0.12em] uppercase text-cream"
        >
          Solicitar
        </a>
      </div>
    </nav>
  );
}
