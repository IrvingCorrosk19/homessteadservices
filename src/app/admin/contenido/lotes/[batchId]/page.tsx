import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminTopBar } from "@/components/admin/AdminTopBar";
import { ControlDisplayPill } from "@/components/admin/control/ControlDisplayPill";
import { ControlSubnav } from "@/components/admin/control/ControlSubnav";
import { getControlBatch } from "@/lib/control-service";

export const dynamic = "force-dynamic";

export default async function ControlBatchPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = await params;
  const batch = getControlBatch(batchId);
  if (!batch) notFound();

  return (
    <>
      <AdminTopBar />
      <main className="mx-auto w-[min(880px,calc(100%-1.5rem))] py-8">
        <ControlSubnav current="/admin/contenido/lotes" />
        <h1 className="mt-6 font-display text-4xl text-navy">{batch.publicId}</h1>
        <p className="mt-2 text-sm text-mist">
          Carrusel: no soportado. Cada miembro es una publicación independiente.
        </p>
        <ul className="mt-6 space-y-3">
          {batch.members.map((member) => (
            <li key={member.publicId} className="rounded-2xl border border-navy/8 bg-white px-4 py-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <Link href={`/admin/contenido/${member.publicId}`} className="font-medium text-navy underline">
                  {member.publicId}
                </Link>
                {member.job ? <ControlDisplayPill state={member.job.displayState} /> : null}
              </div>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
