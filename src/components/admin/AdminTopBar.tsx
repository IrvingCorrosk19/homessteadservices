"use client";

import { useRouter } from "next/navigation";

export function AdminTopBar() {
  const router = useRouter();

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <header className="border-b border-white/10 bg-navy text-cream">
      <div className="mx-auto flex w-[min(1120px,calc(100%-1.5rem))] items-center justify-between py-4 md:w-[min(1120px,calc(100%-4rem))]">
        <div>
          <p className="text-[0.68rem] tracking-[0.18em] uppercase text-accent">
            Homestead Services
          </p>
          <p className="mt-1 font-display text-2xl">Solicitudes</p>
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
