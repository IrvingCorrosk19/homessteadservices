import { notFound } from "next/navigation";
import { AdminTopBar } from "@/components/admin/AdminTopBar";
import { JobDetailClient } from "@/components/admin/JobDetailClient";
import { JOB_ID_PATTERN } from "@/lib/job-config";
import { getServiceJob } from "@/lib/job-store";
import { customerWhatsAppUrl } from "@/lib/service-requests";

export const dynamic = "force-dynamic";

export default async function TrabajoDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  if (!JOB_ID_PATTERN.test(jobId)) notFound();
  const job = getServiceJob(jobId);
  if (!job) notFound();
  const whatsappUrl = customerWhatsAppUrl(
    job.phone,
    `Hola ${job.customerName}, le contactamos de Homestead Services con relación al trabajo ${job.jobNumber}.`,
  );
  return (
    <>
      <AdminTopBar />
      <JobDetailClient job={job} whatsappUrl={whatsappUrl} />
    </>
  );
}
