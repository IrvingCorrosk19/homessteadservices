import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminTopBar } from "@/components/admin/AdminTopBar";
import { ControlDisplayPill } from "@/components/admin/control/ControlDisplayPill";
import { ControlSubnav } from "@/components/admin/control/ControlSubnav";
import { getControlCampaign } from "@/lib/control-service";
import { ControlCampaignPause } from "@/components/admin/control/ControlCampaignPause";

export const dynamic = "force-dynamic";

export default async function ControlCampaignPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;
  const campaign = getControlCampaign(campaignId);
  if (!campaign) notFound();

  return (
    <>
      <AdminTopBar />
      <main className="mx-auto w-[min(880px,calc(100%-1.5rem))] py-8">
        <ControlSubnav current="/admin/contenido/campanas" />
        <h1 className="mt-6 font-display text-4xl text-navy">{campaign.publicId}</h1>
        <p className="mt-2 text-sm text-mist">
          {campaign.service} · {campaign.zone} · {campaign.status}
        </p>
        <p className="mt-3 text-sm text-mist">Métricas todavía no disponibles. El recolector de Meta no mide.</p>
        <ControlCampaignPause campaignId={campaign.publicId} paused={campaign.status === "PAUSED"} />
        <ul className="mt-6 space-y-3">
          {campaign.pieces.map((piece) => (
            <li key={piece.publicId} className="rounded-2xl border border-navy/8 bg-white px-4 py-4">
              <p className="text-sm text-mist">{piece.publicId}</p>
              {piece.contentJobId ? (
                <Link href={`/admin/contenido/${piece.contentJobId}`} className="font-medium text-navy underline">
                  {piece.contentJobId}
                </Link>
              ) : (
                <p className="text-sm text-mist">Pieza de campaña sin job de contenido.</p>
              )}
              <p className="mt-1 text-xs text-mist">
                {piece.status}
                {piece.scheduledAt ? ` · ${piece.scheduledAt}` : ""}
              </p>
              {piece.job ? (
                <div className="mt-2">
                  <ControlDisplayPill state={piece.job.displayState} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
