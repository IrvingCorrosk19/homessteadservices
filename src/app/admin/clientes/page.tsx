import Link from "next/link";
import { AdminTopBar } from "@/components/admin/AdminTopBar";
import { listCustomers } from "@/lib/customer-360";
import { formatPanamaDate } from "@/lib/admin-format";

export const dynamic = "force-dynamic";

export default async function ClientesListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; segment?: string; page?: string }>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() || "";
  const segment = params.segment?.trim() || "";
  const page = Math.max(Number(params.page || "0") || 0, 0);
  const limit = 40;
  const result = listCustomers({ q, segment, includeTest: false, limit, offset: page * limit });

  return (
    <>
      <AdminTopBar />
      <main className="mx-auto w-[min(1120px,calc(100%-1.5rem))] py-8 md:w-[min(1120px,calc(100%-4rem))] md:py-12">
        <p className="text-[0.68rem] tracking-[0.14em] uppercase text-mist">Customer 360</p>
        <h1 className="mt-2 font-display text-4xl text-navy">Clientes</h1>
        <p className="mt-3 max-w-2xl text-sm text-charcoal/75">
          Una identidad estable. Sin fusionar por nombre. {result.total} registros.
        </p>

        <form className="mt-6 grid gap-3 md:grid-cols-[1fr_180px_auto]" action="/admin/clientes">
          <input
            name="q"
            defaultValue={q}
            placeholder="Nombre, teléfono, email o HS-*"
            className="rounded-xl border border-navy/10 bg-white px-4 py-3 text-sm outline-none focus:border-accent"
          />
          <select name="segment" defaultValue={segment} className="rounded-xl border border-navy/10 bg-white px-3 py-3 text-sm">
            <option value="">Todos</option>
            <option value="REPEAT">Repeat</option>
            <option value="RECOVERY_OPEN">Recovery abierto</option>
          </select>
          <button type="submit" className="rounded-xl bg-navy px-5 py-3 text-[0.68rem] tracking-[0.12em] uppercase text-cream">
            Buscar
          </button>
        </form>

        <div className="mt-8 space-y-3">
          {result.rows.map((row) => (
            <Link
              key={row.customerId}
              href={`/admin/clientes/${row.customerId}`}
              className="block rounded-2xl border border-navy/8 bg-white px-5 py-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-display text-xl text-navy">{row.name || "Sin nombre"}</p>
                  <p className="mt-1 text-sm text-charcoal/70">
                    {row.phone || "Sin teléfono"}
                    {row.email ? ` · ${row.email}` : ""}
                  </p>
                  <p className="mt-1 text-xs uppercase tracking-[0.12em] text-mist">
                    {row.isRepeat ? "REPEAT" : "CLIENTE"} · Última actividad{" "}
                    {formatPanamaDate(row.lastActivityAt)}
                  </p>
                </div>
                <p className="font-display text-2xl text-navy">{row.jobsCompleted}</p>
              </div>
            </Link>
          ))}
          {!result.rows.length ? (
            <p className="text-sm text-mist">No hay clientes para estos filtros.</p>
          ) : null}
        </div>

        <div className="mt-8 flex gap-3">
          {page > 0 ? (
            <Link
              href={`/admin/clientes?q=${encodeURIComponent(q)}&segment=${encodeURIComponent(segment)}&page=${page - 1}`}
              className="text-sm text-navy"
            >
              ← Anterior
            </Link>
          ) : null}
          {(page + 1) * limit < result.total ? (
            <Link
              href={`/admin/clientes?q=${encodeURIComponent(q)}&segment=${encodeURIComponent(segment)}&page=${page + 1}`}
              className="text-sm text-navy"
            >
              Siguiente →
            </Link>
          ) : null}
        </div>
      </main>
    </>
  );
}
