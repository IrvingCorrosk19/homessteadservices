"use client";

export default function ControlError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto w-[min(720px,calc(100%-1.5rem))] py-16">
      <h1 className="font-display text-3xl text-navy">No pude cargar esta pantalla</h1>
      <p className="mt-3 text-sm text-charcoal/75">El fallo es de esta vista. Tus datos no se publicaron.</p>
      <button type="button" onClick={() => reset()} className="mt-6 min-h-11 rounded-full bg-navy px-5 text-sm text-cream">
        Reintentar
      </button>
    </main>
  );
}
