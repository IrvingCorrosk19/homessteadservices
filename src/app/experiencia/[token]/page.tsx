import { Logo } from "@/components/brand/Logo";
import { configuredReviewUrl, SATISFACTION_LABELS } from "@/lib/job-config";
import { getSatisfactionPage } from "@/lib/post-service";
import { SatisfactionForm } from "@/components/experience/SatisfactionForm";

export const dynamic = "force-dynamic";

export default async function ExperienciaPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const page = getSatisfactionPage(token);
  if (!page.ok) {
    const message =
      page.reason === "expired"
        ? "Este enlace ya no está disponible. Si necesitas ayuda, escríbenos a Homestead."
        : "No encontramos esta invitación. Si llegaste aquí por error, puedes cerrar la página.";
    return (
      <main className="mx-auto flex min-h-dvh w-[min(560px,calc(100%-1.5rem))] flex-col justify-center py-12">
        <Logo href="/" variant="header" />
        <h1 className="mt-10 font-display text-4xl text-navy">Gracias por tu tiempo</h1>
        <p className="mt-4 text-lg leading-relaxed text-mist">{message}</p>
      </main>
    );
  }
  return (
    <main className="mx-auto flex min-h-dvh w-[min(560px,calc(100%-1.5rem))] flex-col justify-center py-12">
      <Logo href="/" variant="header" />
      <p className="mt-10 text-[0.72rem] tracking-[0.18em] uppercase text-accent">Homestead Services</p>
      <h1 className="mt-3 font-display text-4xl text-navy">¿Cómo quedó todo?</h1>
      <p className="mt-4 text-lg leading-relaxed text-mist">
        Gracias por confiar en Homestead para {page.job.serviceLabel.toLowerCase()}. Queremos asegurarnos de que todo haya
        quedado bien.
      </p>
      {page.already ? (
        <section className="mt-8 rounded-3xl bg-white p-6">
          <p className="text-navy">
            Ya registramos tu respuesta
            {page.response ? `: ${SATISFACTION_LABELS[page.response as keyof typeof SATISFACTION_LABELS] || page.response}` : "."}
          </p>
          {page.response === "NEEDS_HELP" ? (
            <p className="mt-3 text-mist">Un miembro del equipo te va a contactar. No te pediremos una reseña ahora.</p>
          ) : configuredReviewUrl() ? (
            <p className="mt-3 text-mist">Si deseas compartir tu experiencia, puedes dejar una reseña cuando quieras.</p>
          ) : (
            <p className="mt-3 text-mist">Gracias. Eso nos ayuda a cuidar el servicio.</p>
          )}
        </section>
      ) : (
        <SatisfactionForm token={token} />
      )}
    </main>
  );
}
