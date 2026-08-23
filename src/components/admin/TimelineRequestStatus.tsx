"use client";

import Link from "next/link";
import { StatusPill } from "@/components/admin/StatusPill";
import { isRequestStatus, type RequestStatus } from "@/lib/admin-format";

export function TimelineRequestStatus({
  status,
  entityId,
  label,
  href,
}: {
  status?: string;
  entityId: string;
  label: string;
  href?: string;
}) {
  const content = (
    <>
      {entityId} · {label}
      {status && isRequestStatus(status) ? (
        <span className="ml-2 inline-flex align-middle">
          <StatusPill status={status as RequestStatus} compact />
        </span>
      ) : status ? (
        <span className="ml-2 text-mist">· {status}</span>
      ) : null}
    </>
  );

  if (href) {
    return (
      <Link href={href} className="mt-1 block text-navy">
        {content}
      </Link>
    );
  }

  return <p className="mt-1 text-navy">{content}</p>;
}
