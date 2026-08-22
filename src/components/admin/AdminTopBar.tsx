"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export function AdminTopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const title = pathname.startsWith("/admin/citas")
    ? "Citas"
    : pathname.startsWith("/admin/trabajos")
      ? "Trabajos"
      : pathname.startsWith("/admin/clientes")
        ? "Cliente"
        : "Solicitudes";

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <header className="border-b border-white/10 bg-navy text-cream">
      <div className="mx-auto flex w-[min(1200px,calc(100%-1.5rem))] items-center justify-between gap-4 py-4 md:w-[min(1200px,calc(100%-4rem))]">
        <div>
          <p className="text-[0.68rem] tracking-[0.18em] uppercase text-accent">
            Homestead Services
          </p>
          <p className="mt-1 font-display text-2xl">{title}</p>
          <nav className="mt-3 flex flex-wrap gap-4 text-[0.72rem] tracking-[0.14em] uppercase" aria-label="Administración">
            <Link className={pathname.startsWith("/admin/solicitudes") ? "text-accent" : "text-cream/60 hover:text-cream"} href="/admin/solicitudes">
              Solicitudes
            </Link>
            <Link className={pathname.startsWith("/admin/citas") ? "text-accent" : "text-cream/60 hover:text-cream"} href="/admin/citas">
              Citas
            </Link>
            <Link className={pathname.startsWith("/admin/trabajos") ? "text-accent" : "text-cream/60 hover:text-cream"} href="/admin/trabajos">
              Trabajos
            </Link>
          </nav>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className="text-[0.72rem] tracking-[0.14em] uppercase text-cream/70 hover:text-cream"
        >
          Cerrar sesión
        </button>
      </div>
    </header>
  );
}
