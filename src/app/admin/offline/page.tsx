import Link from "next/link";

export const dynamic = "force-dynamic";

export default function ControlOfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-cream px-5 py-16">
      <div className="w-full max-w-md rounded-[28px] border border-navy/10 bg-white p-8">
        <p className="text-[0.72rem] tracking-[0.2em] uppercase text-accent">Homestead Control</p>
        <h1 className="mt-4 font-display text-4xl text-navy">Sin conexión</h1>
        <p className="mt-3 text-sm leading-6 text-charcoal/80">
          Esta pantalla es genérica y no muestra datos de clientes ni de contenido. Publicar, aprobar, consultar
          colas o usar IA requiere internet.
        </p>
        <Link href="/admin" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-navy px-5 text-sm text-cream">
          Reintentar
        </Link>
      </div>
    </main>
  );
}
