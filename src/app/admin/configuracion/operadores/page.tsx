import Link from "next/link";
import { AdminTopBar } from "@/components/admin/AdminTopBar";
import {
  listOperators,
  getTelegramMetric,
  type TelegramOperator,
} from "@/lib/telegram-operators";
import { OperatorsAdminClient } from "@/components/admin/OperatorsAdminClient";

export const dynamic = "force-dynamic";

function statusLabel(op: TelegramOperator) {
  if (op.role === "PENDING") return "Pendiente";
  if (!op.isActive) return "Inactivo";
  return "Activo";
}

export default async function OperadoresAdminPage() {
  const operators = listOperators({ includeInactive: true });
  const metrics = {
    active: getTelegramMetric("active_telegram_operators"),
    pending: getTelegramMetric("pending_telegram_operators"),
    denied: getTelegramMetric("telegram_permission_denied"),
    stale: getTelegramMetric("telegram_stale_callback"),
  };

  return (
    <>
      <AdminTopBar />
      <main className="mx-auto w-[min(960px,calc(100%-1.5rem))] py-8 md:w-[min(960px,calc(100%-4rem))] md:py-12">
        <p className="text-[0.68rem] tracking-[0.14em] uppercase text-mist">Telegram · un solo bot</p>
        <h1 className="mt-2 font-display text-4xl text-navy">Operadores</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-charcoal/75">
          La identidad es la cuenta de Telegram. Homestead decide rol, estado y permisos. El bot es solo la
          interfaz.
        </p>

        <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: "Activos", value: metrics.active },
            { label: "Pendientes", value: metrics.pending },
            { label: "Permiso denegado", value: metrics.denied },
            { label: "Callback obsoleto", value: metrics.stale },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl border border-navy/8 bg-white px-4 py-4">
              <p className="text-[0.68rem] tracking-[0.14em] uppercase text-mist">{item.label}</p>
              <p className="mt-2 font-display text-3xl text-navy">{item.value}</p>
            </div>
          ))}
        </div>

        <OperatorsAdminClient
          initial={operators.map((op) => ({
            id: op.id,
            displayName: op.displayName,
            role: op.role,
            status: statusLabel(op),
            isActive: op.isActive,
            lastSeenAt: op.lastSeenAt,
            notifyRequests: op.notifyRequests,
            notifyAppointments: op.notifyAppointments,
            notifyLeads: op.notifyLeads,
            notifySla: op.notifySla,
            notifyContent: op.notifyContent,
            notifyDailyBrief: op.notifyDailyBrief,
            telegramSuffix: op.telegramUserId.slice(-4),
          }))}
        />

        <p className="mt-10 text-sm text-mist">
          <Link href="/admin/solicitudes" className="underline-offset-2 hover:underline">
            Volver a solicitudes
          </Link>
        </p>
      </main>
    </>
  );
}
