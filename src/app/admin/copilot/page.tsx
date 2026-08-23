import Link from "next/link";
import { AdminTopBar } from "@/components/admin/AdminTopBar";
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
        <p className="text-[0.68rem] tracking-[0.14em] uppercase text-mist">AI Business Copilot</p>
        <h1 className="mt-2 font-display text-4xl text-navy">Copiloto</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-charcoal/75">
          Misma capa de verdad que Telegram ({COPILOT_PROMPT_VERSION}). Los números son deterministas
          (Wave F). El lenguaje natural vive en Telegram; aquí el brief ejecutivo sin depender de OpenAI.
        </p>

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
          <h2 className="font-display text-2xl text-navy">Atención</h2>
          <ul className="mt-4 space-y-2 text-sm text-charcoal/80">
            {attention.length === 0 ? (
              <li>Sin ítems prioritarios.</li>
            ) : (
              attention.map((item) => (
                <li key={item.id}>
                  <Link href={item.href} className="text-navy underline-offset-2 hover:underline">
                    [{item.kind}] {item.title}
                  </Link>
                  {item.detail ? ` — ${item.detail}` : ""}
                </li>
              ))
            )}
          </ul>
        </section>

        <p className="mt-10 text-sm text-mist">
          Conversación natural: Telegram → /homestead → 🤖 Copiloto.
        </p>
      </main>
    </>
  );
}
