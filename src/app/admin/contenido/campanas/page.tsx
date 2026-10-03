import Link from "next/link";
import { AdminTopBar } from "@/components/admin/AdminTopBar";
import { ControlSubnav } from "@/components/admin/control/ControlSubnav";
import { listControlCampaigns } from "@/lib/control-service";

export const dynamic = "force-dynamic";

export default function ControlCampaignsPage() {
  const campaigns = listControlCampaigns();
  return (
    <>
      <AdminTopBar />
      <main className="mx-auto w-[min(1120px,calc(100%-1.5rem))] py-8 md:w-[min(1120px,calc(100%-4rem))]">
        <h1 className="font-display text-4xl text-navy">Campañas</h1>
        <ControlSubnav current="/admin/contenido/campanas" />
        <ul className="mt-6 space-y-3">
          {campaigns.map((campaign) => (
            <li key={campaign.publicId}>
              <Link
                href={`/admin/contenido/campanas/${campaign.publicId}`}
                className="block rounded-2xl border border-navy/8 bg-white px-4 py-4"
              >
                <p className="font-medium text-navy">{campaign.publicId}</p>
                <p className="text-sm text-mist">
                  {campaign.status} · {campaign.pieceCount} piezas · {campaign.failures} con fallo
                </p>
              </Link>
            </li>
          ))}
        </ul>
        {!campaigns.length ? (
          <p className="mt-8 text-sm text-mist">
            No hay campañas en esta base. El módulo existe; no hay datos de demostración inventados.
          </p>
        ) : null}
      </main>
    </>
  );
}
