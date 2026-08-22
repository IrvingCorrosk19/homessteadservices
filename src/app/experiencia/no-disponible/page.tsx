import { Logo } from "@/components/brand/Logo";

export default function ExperienciaNoDisponible() {
  return (
    <main className="mx-auto flex min-h-dvh w-[min(560px,calc(100%-1.5rem))] flex-col justify-center py-12">
      <Logo href="/" variant="header" />
      <h1 className="mt-10 font-display text-4xl text-navy">Enlace no disponible</h1>
      <p className="mt-4 text-lg text-mist">
        No hay una reseña configurada o este enlace no es válido. Homestead no inventa destinos de reseña.
      </p>
    </main>
  );
}
