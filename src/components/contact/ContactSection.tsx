import { RequestForm } from "@/components/contact/RequestForm";
import { contact, emailHref, isPublicWhatsAppEnabled, phoneHref, whatsappHref } from "@/lib/site";
import { getDictionary } from "@/i18n/get-dictionary";

type ContactDetail = {
  label: string;
  value: string;
  href: string | null;
};

export function ContactSection({
  defaultService = "",
  defaultIntent = "",
}: {
  defaultService?: string;
  defaultIntent?: string;
}) {
  const dictionary = getDictionary();
  const phone = phoneHref();
  const email = emailHref();
  const whatsapp =
    isPublicWhatsAppEnabled() && contact.whatsapp.isConfigured
      ? whatsappHref(dictionary.whatsapp.defaultMessage)
      : null;

  // Only real, usable public contact data — never placeholders.
  const details: ContactDetail[] = [];

  if (whatsapp && contact.whatsapp.isConfigured) {
    details.push({
      label: dictionary.contact.whatsapp,
      value: contact.whatsapp.value,
      href: whatsapp,
    });
  }
  if (contact.phone.isConfigured && phone) {
    details.push({
      label: dictionary.contact.phone,
      value: contact.phone.value,
      href: phone,
    });
  }
  if (contact.email.isConfigured && email) {
    details.push({
      label: dictionary.contact.email,
      value: contact.email.value,
      href: email,
    });
  }
  if (contact.hours.isConfigured) {
    details.push({
      label: dictionary.contact.hours,
      value: contact.hours.value,
      href: null,
    });
  }
  if (contact.serviceArea.isConfigured) {
    details.push({
      label: dictionary.contact.area,
      value: contact.serviceArea.value,
      href: null,
    });
  }

  return (
    <section id="contacto" className="bg-cream py-20 md:py-28">
      <div className="container-home grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
        <div>
          <h2 className="font-display text-4xl text-navy md:text-5xl">
            {dictionary.contact.title}
          </h2>
          <p className="mt-5 text-lg leading-8 text-navy-soft">
            {dictionary.contact.body}
          </p>
          {details.length > 0 && (
            <dl className="mt-10 space-y-5">
              {details.map((item) => (
                <div key={item.label}>
                  <dt className="text-[0.68rem] tracking-[0.16em] uppercase text-mist">
                    {item.label}
                  </dt>
                  <dd className="mt-1 text-navy">
                    {item.href ? (
                      <a
                        href={item.href}
                        target={item.href.startsWith("http") ? "_blank" : undefined}
                        rel={item.href.startsWith("http") ? "noopener noreferrer" : undefined}
                      >
                        {item.value}
                      </a>
                    ) : (
                      item.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <div className="rounded-2xl border border-line bg-white p-6 md:p-8">
          <h3 className="font-display text-2xl text-navy">{dictionary.form.title}</h3>
          <p className="mt-2 mb-6 text-navy-soft">{dictionary.form.body}</p>
          <RequestForm
            defaultService={defaultService}
            defaultIntent={defaultIntent}
          />
        </div>
      </div>
    </section>
  );
}
