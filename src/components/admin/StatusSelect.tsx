"use client";

import { useState } from "react";
import { REQUEST_STATUSES, STATUS_LABELS, type RequestStatus } from "@/lib/admin-format";

export function StatusSelect({
  requestId,
  status,
  onChange,
}: {
  requestId: string;
  status: RequestStatus;
  onChange: (status: RequestStatus) => void;
}) {
  const [value, setValue] = useState(status);

  async function update(next: RequestStatus) {
    setValue(next);
    const response = await fetch(`/api/admin/service-requests/${requestId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (!response.ok) {
      setValue(status);
      return;
    }
    onChange(next);
  }

  return (
    <select
      value={value}
      onChange={(event) => void update(event.target.value as RequestStatus)}
      className="rounded-full border border-navy/10 bg-white px-3 py-2 text-[0.72rem] tracking-[0.1em] uppercase"
    >
      {REQUEST_STATUSES.map((item) => (
        <option key={item} value={item}>
          {STATUS_LABELS[item]}
        </option>
      ))}
    </select>
  );
}
