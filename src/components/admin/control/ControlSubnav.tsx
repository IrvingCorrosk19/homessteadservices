import Link from "next/link";
import { ControlIsolatedBanner } from "@/components/admin/control/ControlIsolatedBanner";

const LINKS = [
  { href: "/admin/contenido", label: "Cola" },
  { href: "/admin/contenido/nuevo", label: "Cargar fotos" },
  { href: "/admin/contenido/lotes", label: "Lotes" },
  { href: "/admin/contenido/campanas", label: "Campañas" },
  { href: "/admin/contenido/errores", label: "Errores" },
];

export function ControlSubnav({ current }: { current: string }) {
  return (
    <>
      <nav className="mt-4 flex flex-wrap gap-2" aria-label="Homestead Control">
        {LINKS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`min-h-10 rounded-full px-4 py-2 text-[0.68rem] tracking-[0.12em] uppercase ${
              current === item.href ? "bg-navy text-cream" : "border border-navy/15 bg-white text-navy"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <ControlIsolatedBanner />
    </>
  );
}
