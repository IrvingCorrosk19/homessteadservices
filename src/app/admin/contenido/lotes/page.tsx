import Link from "next/link";
import { AdminTopBar } from "@/components/admin/AdminTopBar";
import { ControlSubnav } from "@/components/admin/control/ControlSubnav";
import { getHomesteadDb } from "@/lib/service-requests";
import { getControlBatch } from "@/lib/control-service";

export const dynamic = "force-dynamic";

export default function ControlBatchesPage() {
  const rows = getHomesteadDb()
    .prepare("SELECT public_id FROM content_photo_batches ORDER BY created_at DESC")
    .all() as Array<{ public_id: string }>;
  const batches = rows.map((row) => getControlBatch(row.public_id)).filter(Boolean);

  return (
    <>
      <AdminTopBar />
      <main className="mx-auto w-[min(1120px,calc(100%-1.5rem))] py-8 md:w-[min(1120px,calc(100%-4rem))]">
        <h1 className="font-display text-4xl text-navy">Lotes</h1>
        <ControlSubnav current="/admin/contenido/lotes" />
        <ul className="mt-6 space-y-3">
          {batches.map((batch) =>
            batch ? (
              <li key={batch.publicId}>
                <Link
                  href={`/admin/contenido/lotes/${batch.publicId}`}
                  className="block rounded-2xl border border-navy/8 bg-white px-4 py-4"
                >
                  <p className="font-medium text-navy">{batch.publicId}</p>
                  <p className="text-sm text-mist">
                    {batch.members.length} piezas · {batch.status === "proposed" ? "propuesto" : batch.status}
                  </p>
                </Link>
              </li>
            ) : null,
          )}
        </ul>
        {!batches.length ? <p className="mt-8 text-sm text-mist">No hay lotes. Carga fotos para crear uno.</p> : null}
      </main>
    </>
  );
}
