"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const PRIMARY = [
  { href: "/admin", label: "Inicio", match: (path: string) => path === "/admin" },
  {
    href: "/admin/solicitudes?ops=NEEDS_ATTENTION",
    label: "Solicitudes",
    match: (path: string) => path.startsWith("/admin/solicitudes"),
  },
  { href: "/admin/citas", label: "Citas", match: (path: string) => path.startsWith("/admin/citas") },
  { href: "/admin/clientes", label: "Clientes", match: (path: string) => path.startsWith("/admin/clientes") },
];

const MORE = [
  { href: "/admin/trabajos", label: "Trabajos" },
  { href: "/admin/retencion", label: "Retención" },
  { href: "/admin/copilot", label: "Copiloto" },
  { href: "/admin/configuracion/operadores", label: "Operadores" },
];

export function AdminMobileNav() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const onMore =
    mounted &&
    (pathname.startsWith("/admin/trabajos") ||
      pathname.startsWith("/admin/retencion") ||
      pathname.startsWith("/admin/copilot") ||
      pathname.startsWith("/admin/configuracion"));

  if (!mounted) {
    return (
      <nav
        className="fixed inset-x-0 bottom-0 z-50 border-t border-navy/10 bg-cream/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden"
        aria-label="Navegación operativa móvil"
      />
    );
  }

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-navy/10 bg-cream/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden"
      aria-label="Navegación operativa móvil"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5 gap-1 px-2 pt-2">
        {PRIMARY.map((item) => {
          const active = item.match(pathname);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-12 flex-col items-center justify-center rounded-xl px-1 text-[0.62rem] tracking-[0.08em] uppercase ${
                  active ? "bg-navy text-cream" : "text-navy-soft"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
        <li>
          <details className="group relative">
            <summary
              className={`flex min-h-12 cursor-pointer list-none flex-col items-center justify-center rounded-xl px-1 text-[0.62rem] tracking-[0.08em] uppercase marker:content-none ${
                onMore ? "bg-navy text-cream" : "text-navy-soft"
              }`}
            >
              Más
            </summary>
            <div className="absolute bottom-[calc(100%+0.5rem)] right-0 min-w-44 rounded-2xl border border-navy/10 bg-white p-2 shadow-[0_12px_40px_rgba(31,51,68,0.12)]">
              {MORE.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block rounded-xl px-3 py-2.5 text-sm text-navy hover:bg-cream-deep"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </details>
        </li>
      </ul>
    </nav>
  );
}
