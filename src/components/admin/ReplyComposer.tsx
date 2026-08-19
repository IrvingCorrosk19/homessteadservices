"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Loader } from "@/components/ui/Loader";
import { formatPanamaDateTime } from "@/lib/admin-format";
import type { RequestStatus } from "@/lib/admin-format";

export function ReplyComposer({
  requestId,
  customerEmail,
  defaultSubject,
  onSent,
}: {
  requestId: string;
  customerEmail: string;
  defaultSubject: string;
  onSent: (next: { status: RequestStatus; updatedAt: string; body: string }) => void;
}) {
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sentAt, setSentAt] = useState("");

  async function send() {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/service-requests/${requestId}/reply`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        status?: RequestStatus;
        updatedAt?: string;
      };
      if (!response.ok || !payload.ok) {
        setError("No pudimos enviar la respuesta. Tu mensaje permanece guardado. Intenta nuevamente.");
        return;
      }
      setSentAt(payload.updatedAt || new Date().toISOString());
      onSent({
        status: payload.status || "CONTACTED",
        updatedAt: payload.updatedAt || new Date().toISOString(),
        body,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-[24px] border border-navy/8 bg-white p-6 md:p-8">
      <p className="text-[0.72rem] tracking-[0.16em] uppercase text-mist">
        Responder al cliente
      </p>
      <div className="mt-5 space-y-4">
        <label className="block">
          <span className="text-[0.68rem] tracking-[0.12em] uppercase text-mist">Para</span>
          <p className="mt-2 text-navy">{customerEmail}</p>
        </label>
        <label className="block">
          <span className="text-[0.68rem] tracking-[0.12em] uppercase text-mist">Asunto</span>
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            className="mt-2 w-full rounded-xl border border-navy/10 px-4 py-3 text-sm outline-none focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="text-[0.68rem] tracking-[0.12em] uppercase text-mist">Mensaje</span>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={8}
            className="mt-2 w-full rounded-xl border border-navy/10 px-4 py-3 text-sm leading-7 outline-none focus:border-accent"
            placeholder="Escribe la respuesta para el cliente"
          />
        </label>
        {error ? <p className="text-sm text-accent-deep">{error}</p> : null}
        {sentAt ? (
          <p className="text-sm text-navy">
            ✓ Respuesta enviada · {formatPanamaDateTime(sentAt)}
          </p>
        ) : null}
        <Button type="button" loading={loading} disabled={loading} onClick={() => void send()} className="w-full md:w-auto">
          {loading ? (
            <>
              <Loader /> Enviando respuesta...
            </>
          ) : (
            "Enviar respuesta"
          )}
        </Button>
      </div>
    </section>
  );
}
