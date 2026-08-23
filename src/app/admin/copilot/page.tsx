import Link from "next/link";
import { AdminTopBar } from "@/components/admin/AdminTopBar";
import { NeedsAttentionBlock } from "@/components/admin/NeedsAttentionBlock";
import { formatBrief } from "@/lib/copilot/deterministic";
import { getAttentionItems, getBusinessBriefCounts } from "@/lib/analytics-service";
import { COPILOT_PROMPT_VERSION } from "@/lib/copilot/schema";

export const dynamic = "force-dynamic";

export default function AdminCopilotPage() {
  const brief = formatBrief();
  const counts = getBusinessBriefCounts(false);
  const attention = getAttentionItems(false, 8);

  return (
    <>
      <AdminTopBar />
      <main className="mx-auto w-[min(860px,calc(100%-1.5rem))] py-8 md:w-[min(860px,calc(100%-4rem))] md:py-12">
        <p className="text-[0.68rem] tracking-[0.14em] uppercase text-mist">Copiloto de negocio</p>
        <h1 className="mt-2 font-display text-4xl text-navy">Copiloto</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-charcoal/75">
          Misma capa de verdad que Telegram ({COPILOT_PROMPT_VERSION}). Los números son deterministas.
          Usa los accesos directos para ir al lugar correcto.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="/admin/solicitudes?ops=NEEDS_ATTENTION" className="min-h-11 rounded-full bg-navy px-4 py-2.5 text-[0.68rem] tracking-[0.12em] uppercase text-cream">
            Ver pendientes ({counts.pendingRequests})
          </Link>
          <Link href="/admin/citas" className="min-h-11 rounded-full border border-navy/15 px-4 py-2.5 text-[0.68rem] tracking-[0.12em] uppercase text-navy">
            Ver citas hoy ({counts.appointmentsToday})
          </Link>
          <Link href="/admin/clientes" className="min-h-11 rounded-full border border-navy/15 px-4 py-2.5 text-[0.68rem] tracking-[0.12em] uppercase text-navy">
            Buscar cliente
          </Link>
        </div>

        <section className="mt-8 whitespace-pre-wrap rounded-2xl border border-navy/10 bg-white p-5 text-sm leading-relaxed text-charcoal/85">
          {brief}
        </section>

        <section className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ["Solicitudes hoy", counts.requestsToday],
            ["Citas hoy", counts.appointmentsToday],
            ["Pendientes", counts.pendingRequests],
            ["Recovery", counts.recoveryOpen],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-2xl border border-navy/8 bg-white px-4 py-4">
              <p className="text-[0.68rem] tracking-[0.14em] uppercase text-mist">{label}</p>
              <p className="mt-2 font-display text-3xl text-navy">{value}</p>
            </div>
          ))}
        </section>

        <section className="mt-10">
          <NeedsAttentionBlock items={attention} compact />
        </section>

        <p className="mt-10 text-sm text-mist">
          Conversación natural: Telegram → /homestead → Copiloto.
        </p>
      </main>
    </>
  );
}
