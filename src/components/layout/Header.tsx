"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import { ButtonLink } from "@/components/ui/Button";
import { navItems, whatsappHref } from "@/lib/site";
import { getDictionary } from "@/i18n/get-dictionary";

export function Header() {
  const pathname = usePathname();
  const dictionary = getDictionary();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const whatsapp = whatsappHref(dictionary.whatsapp.defaultMessage);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function navHref(item: (typeof navItems)[number]) {
    if (item.key === "home") return "/";
    if (item.key === "services") {
      return pathname === "/" ? "#servicios" : "/services";
    }
    if (item.key === "process") {
      return pathname === "/" ? "#como-funciona" : "/#como-funciona";
    }
    if (item.key === "contact") {
      return pathname === "/" ? "#contacto" : "/contact";
    }
    return "/";
  }

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${
        scrolled || open ? "header-solid" : "header-clear"
      }`}
    >
      <div className="container-home flex h-[72px] items-center justify-between gap-3 md:h-[80px] md:gap-4">
        <Logo href="/" variant="header" />

        <nav className="hidden items-center gap-8 lg:flex" aria-label="Principal">
          {navItems.map((item) => {
            const to = navHref(item);
            const current =
              (item.key === "home" && pathname === "/") ||
              (item.key === "services" && pathname.startsWith("/services")) ||
              (item.key === "contact" && pathname.startsWith("/contact"));
            return (
              <Link
                key={item.key}
                href={to}
                className={`text-[0.92rem] transition-colors ${
                  current ? "text-navy" : "text-navy-soft hover:text-navy"
                }`}
              >
                {dictionary.nav[item.key]}
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-4 lg:flex">
          {whatsapp && (
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[0.92rem] text-navy-soft transition-colors hover:text-navy"
            >
              {dictionary.whatsapp.label}
            </a>
          )}
          <ButtonLink
            href="/contact"
            variant="primary"
            className="min-h-11 px-5 text-[0.72rem]"
          >
            {dictionary.common.request}
          </ButtonLink>
        </div>

        <div className="flex items-center gap-2 lg:hidden">
          <ButtonLink
            href="/contact"
            variant="primary"
            className="min-h-10 px-4 text-[0.68rem]"
          >
            {dictionary.common.request}
          </ButtonLink>
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-navy"
            aria-expanded={open}
            aria-label={open ? "Cerrar menú" : "Abrir menú"}
            onClick={() => setOpen((value) => !value)}
          >
            <span className="sr-only">Menú</span>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
              {open ? (
                <path d="M6 6l12 12M18 6L6 18" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h10" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-line bg-cream px-5 py-6 lg:hidden">
          <nav className="flex flex-col gap-4" aria-label="Móvil">
            {navItems.map((item) => (
              <Link
                key={item.key}
                href={navHref(item)}
                className="text-lg text-navy"
                onClick={() => setOpen(false)}
              >
                {dictionary.nav[item.key]}
              </Link>
            ))}
            {whatsapp && (
              <a
                href={whatsapp}
                target="_blank"
                rel="noopener noreferrer"
                className="text-lg text-navy"
              >
                {dictionary.whatsapp.label}
              </a>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
