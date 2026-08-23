"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AdminGlobalSearch } from "@/components/admin/AdminGlobalSearch";
import { AdminMobileNav } from "@/components/admin/AdminMobileNav";

const DESKTOP_NAV = [
  { href: "/admin", label: "Dashboard", match: (path: string) => path === "/admin" },
  { href: "/admin/solicitudes?ops=NEEDS_ATTENTION", label: "Solicitudes", match: (path: string) => path.startsWith("/admin/solicitudes") },
  { href: "/admin/citas", label: "Citas", match: (path: string) => path.startsWith("/admin/citas") },
  { href: "/admin/trabajos", label: "Trabajos", match: (path: string) => path.startsWith("/admin/trabajos") },
  { href: "/admin/clientes", label: "Clientes", match: (path: string) => path.startsWith("/admin/clientes") },
  { href: "/admin/retencion", label: "Retención", match: (path: string) => path.startsWith("/admin/retencion") },
  { href: "/admin/copilot", label: "Copiloto", match: (path: string) => path.startsWith("/admin/copilot") },
  { href: "/admin/configuracion/operadores", label: "Operadores", match: (path: string) => path.startsWith("/admin/configuracion") },
];

export function AdminTopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const title =
    pathname === "/admin"
      ? "Inicio operativo"
      : pathname.startsWith("/admin/citas")
        ? "Citas"
        : pathname.startsWith("/admin/trabajos")
          ? "Trabajos"
          : pathname.startsWith("/admin/clientes")
            ? "Clientes"
            : pathname.startsWith("/admin/retencion")
              ? "Retención"
              : pathname.startsWith("/admin/copilot")
                ? "Copiloto"
                : pathname.startsWith("/admin/configuracion")
                  ? "Configuración"
                  : "Solicitudes";

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <>
      <header className="border-b border-white/10 bg-navy text-cream">
        <div className="mx-auto flex w-[min(1200px,calc(100%-1.5rem))] flex-col gap-4 py-4 md:w-[min(1200px,calc(100%-4rem))] md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-[0.68rem] tracking-[0.18em] uppercase text-accent">Homestead Services</p>
            <p className="mt-1 font-display text-2xl">{title}</p>
            <nav
              className="mt-3 hidden flex-wrap gap-4 text-[0.72rem] tracking-[0.14em] uppercase md:flex"
              aria-label="Administración"
            >
              {DESKTOP_NAV.map((item) => (
                <Link
                  key={item.href}
                  className={item.match(pathname) ? "text-accent" : "text-cream/60 hover:text-cream"}
                  href={item.href}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex w-full shrink-0 flex-col gap-3 md:max-w-md">
            <AdminGlobalSearch />
            <button
              type="button"
              onClick={() => void logout()}
              className="self-end text-[0.72rem] tracking-[0.14em] uppercase text-cream/70 hover:text-cream"
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </header>
      <AdminMobileNav />
    </>
  );
}
