import { notFound } from "next/navigation";
import { AdminTopBar } from "@/components/admin/AdminTopBar";
import { RequestDetailClient } from "@/components/admin/RequestDetailClient";
import { PUBLIC_ID_PATTERN } from "@/lib/admin-format";
import { getDictionary } from "@/i18n/get-dictionary";
import {
  customerWhatsAppUrl,
  getRequestByPublicId,
  getRequestSlaMeta,
  listRequestMessages,
} from "@/lib/service-requests";
import type { FormService } from "@/lib/site";
import { adminFactRows } from "@/lib/concierge/playbook-engine";
import { buildAdminPhotoEvidenceMap } from "@/lib/concierge/digital-lock-vision";

export const dynamic = "force-dynamic";

export default async function SolicitudDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ requestId: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { requestId } = await params;
  const query = await searchParams;  if (!PUBLIC_ID_PATTERN.test(requestId)) notFound();
  const request = getRequestByPublicId(requestId);
  if (!request) notFound();
  const messages = listRequestMessages(requestId);
  const dictionary = getDictionary();
  const serviceLabel =
    dictionary.form.serviceOptions[request.service as FormService] ?? request.service;
  const whatsappUrl = customerWhatsAppUrl(
    request.phone,
    `Hola ${request.name}, le contactamos de Homestead Services con relación a su solicitud ${request.publicId}.`,
  );
  const sla = getRequestSlaMeta(requestId);

  return (
    <>
      <AdminTopBar />
      <RequestDetailClient
        request={request}
        messages={messages}
        serviceLabel={serviceLabel}
        whatsappUrl={whatsappUrl}
        slaFirstAlertedAt={sla.slaFirstAlertedAt}
        slaEscalatedAt={sla.slaEscalatedAt}
        returnTo={query.returnTo}
        factRows={adminFactRows({
          service: request.service,
          photos: request.photos.length,
          factsJson: request.factsJson,
        })}
        photoEvidenceByFile={buildAdminPhotoEvidenceMap(
          request.photos.map((photo) => ({
            storedAs: photo.storedAs,
            sourceStoredAs: (photo as { sourceStoredAs?: string }).sourceStoredAs,
          })),
          request.factsJson,
        )}
      />
    </>
  );
}
