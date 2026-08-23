"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { StatusPill } from "@/components/admin/StatusPill";
import { formatPanamaDateTime, type RequestStatus } from "@/lib/admin-format";
import {
  buildReturnTo,
  readOpsHideAttended,
  readOpsListScroll,
  saveOpsListContext,
} from "@/lib/ops-navigation-state";
import {
  matchesOpsFilter,
  opsFilterCounts,
  OPS_FILTERS,
  resolveRequestVisual,
  type OpsFilter,
} from "@/lib/request-status-visual";
import { useToast } from "@/components/ui/Toast";

export type OpsRequestRow = {
  publicId: string;
  createdAt: string;
  updatedAt: string;
  status: RequestStatus;
  name: string;
  service: string;
  serviceLabel: string;
  phone: string;
  photoCount: number;
  replied: boolean;
  slaFirstAlertedAt?: string | null;
  slaEscalatedAt?: string | null;
};

type SolicitudesOperationsClientProps = {
  initialRequests: OpsRequestRow[];
  statusCounts: Record<RequestStatus, number>;
  initialFilter: OpsFilter;
};

function emptyMessageForFilter(filter: OpsFilter) {
  if (filter === "NEEDS_ATTENTION") return "No tienes solicitudes pendientes.";
  if (filter === "IN_PROGRESS") return "No hay solicitudes en gestión.";
  if (filter === "ATTENDED") return "No hay solicitudes atendidas con este filtro.";
  return "No hay solicitudes con este filtro.";
}

export function SolicitudesOperationsClient({
  initialRequests,
  statusCounts,
  initialFilter,
}: SolicitudesOperationsClientProps) {
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [items, setItems] = useState(initialRequests);
  const [counts, setCounts] = useState(statusCounts);
  const [filter, setFilter] = useState<OpsFilter>(initialFilter);
  const [hideAttended, setHideAttended] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [flashId, setFlashId] = useState("");

  useEffect(() => {
    const savedHide = readOpsHideAttended();
    if (savedHide !== null) setHideAttended(savedHide);
    const scroll = readOpsListScroll();
    if (scroll !== null) window.requestAnimationFrame(() => window.scrollTo(0, scroll));
  }, []);

  useEffect(() => {
    setItems(initialRequests);
    setCounts(statusCounts);
  }, [initialRequests, statusCounts]);

  const returnTo = useMemo(() => {
    const params: Record<string, string> = { ops: filter };
    if (searchParams.get("q")) params.q = searchParams.get("q") || "";
    if (searchParams.get("service")) params.service = searchParams.get("service") || "";
    if (searchParams.get("date")) params.date = searchParams.get("date") || "";
    return buildReturnTo(pathname, params);
  }, [filter, pathname, searchParams]);

  const bucketCounts = useMemo(() => opsFilterCounts(counts), [counts]);

  const visible = useMemo(() => {
    return items.filter((item) => {
      if (!matchesOpsFilter(item.status, filter)) return false;
      if (hideAttended && item.status === "CONTACTED" && filter === "ALL") return false;
      return true;
    });
  }, [items, filter, hideAttended]);

  function applyFilter(next: OpsFilter) {
    setFilter(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set("ops", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function openDetail(publicId: string) {
    saveOpsListContext(filter, hideAttended);
    router.push(
      `/admin/solicitudes/${publicId}?returnTo=${encodeURIComponent(returnTo)}`,
    );
  }

  async function markAttended(request: OpsRequestRow, event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (request.status !== "NEW" && request.status !== "IN_PROGRESS") return;
    if (busyId) return;

    const snapshot = { ...request };
    const countSnapshot = { ...counts };
    setBusyId(request.publicId);
    setItems((current) =>
      current.map((row) =>
        row.publicId === request.publicId
          ? { ...row, status: "CONTACTED", updatedAt: new Date().toISOString() }
          : row,
      ),
    );
    setCounts((current) => ({
      ...current,
      NEW: Math.max(0, current.NEW - (snapshot.status === "NEW" ? 1 : 0)),
      IN_PROGRESS: Math.max(0, current.IN_PROGRESS - (snapshot.status === "IN_PROGRESS" ? 1 : 0)),
      CONTACTED: current.CONTACTED + (snapshot.status === "CONTACTED" ? 0 : 1),
    }));

    const response = await fetch(`/api/admin/service-requests/${request.publicId}/contacted`, {
      method: "POST",
    });
    const data = await response.json().catch(() => ({}));
    setBusyId("");

    if (!response.ok) {
      setItems((current) => current.map((row) => (row.publicId === request.publicId ? snapshot : row)));
      setCounts(countSnapshot);
      toast.push({
        kind: "error",
        title: "No pudimos marcar la solicitud",
        body: "Intenta de nuevo en un momento.",
      });
      return;
    }

    if (data.request) {
      setItems((current) =>
        current.map((row) => (row.publicId === request.publicId ? { ...row, ...data.request } : row)),
      );
    }

    setFlashId(request.publicId);
    window.setTimeout(() => setFlashId(""), 1800);
    toast.push({
      kind: "success",
      title: "✓ Solicitud atendida",
      body: data.already ? "Ya estaba registrada como atendida." : `${request.publicId} quedó marcada.`,
    });
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {OPS_FILTERS.map((item) => {
          const count =
            item.id === "ALL"
              ? bucketCounts.all
              : item.id === "NEEDS_ATTENTION"
                ? bucketCounts.needsAttention
                : item.id === "IN_PROGRESS"
                  ? bucketCounts.inProgress
                  : bucketCounts.attended;
          const active = filter === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={active}
              className={`min-h-11 rounded-full border px-4 py-2 text-left text-[0.68rem] tracking-[0.1em] uppercase transition ${
                active ? "border-navy bg-navy text-cream" : "border-navy/15 bg-white text-navy"
              }`}
              onClick={() => applyFilter(item.id)}
            >
              {item.label}
              {count > 0 ? <span className="ml-2 opacity-80">{count}</span> : null}
            </button>
          );
        })}
      </div>

      <label className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm text-charcoal">
        <input
          type="checkbox"
          className="size-4 rounded border-navy/20"
          checked={hideAttended}
          onChange={(event) => setHideAttended(event.target.checked)}
        />
        Ocultar atendidas
      </label>

      <div className="mt-6 space-y-3">
        {visible.length === 0 ? (
          <p className="rounded-2xl border border-navy/8 bg-white px-5 py-8 text-center text-mist">
            {emptyMessageForFilter(filter)}
          </p>
        ) : (
          visible.map((request) => {
            const visual = resolveRequestVisual({
              status: request.status,
              slaEscalatedAt: request.slaEscalatedAt,
              slaFirstAlertedAt: request.slaFirstAlertedAt,
            });
            const canMark = request.status === "NEW" || request.status === "IN_PROGRESS";
            const flashing = flashId === request.publicId;

            return (
              <article
                key={request.publicId}
                className={`relative overflow-hidden rounded-2xl border px-4 py-4 transition-all duration-300 md:px-5 ${visual.cardClass} ${visual.ringClass} ${flashing ? "scale-[0.995] opacity-90" : ""}`}
              >
                <button type="button" className="block w-full min-w-0 text-left" onClick={() => openDetail(request.publicId)}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.72rem] tracking-[0.14em] uppercase text-accent">{request.publicId}</p>
                      <h2 className="mt-1 truncate font-display text-xl text-navy md:text-2xl">{request.name}</h2>
                      <p className="mt-1 truncate text-sm text-mist">{request.serviceLabel}</p>
                    </div>
                    <StatusPill
                      status={request.status}
                      slaEscalatedAt={request.slaEscalatedAt}
                      slaFirstAlertedAt={request.slaFirstAlertedAt}
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3 text-[0.72rem] tracking-[0.08em] uppercase text-mist">
                    <span>{formatPanamaDateTime(request.createdAt)}</span>
                    {request.photoCount ? <span>{request.photoCount} fotos</span> : null}
                    {request.replied ? <span>Respondida</span> : null}
                  </div>
                </button>

                {canMark ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {request.phone ? (
                      <a
                        href={`tel:${request.phone.replace(/[^\d+]/g, "")}`}
                        className="min-h-11 rounded-xl border border-navy/15 px-4 py-2.5 text-[0.68rem] tracking-[0.12em] uppercase text-navy"
                        onClick={(event) => event.stopPropagation()}
                      >
                        Contactar
                      </a>
                    ) : null}
                    <button
                      type="button"
                      disabled={busyId === request.publicId}
                      className="min-h-11 rounded-xl bg-navy px-4 py-2.5 text-[0.68rem] tracking-[0.12em] uppercase text-cream disabled:opacity-50"
                      onClick={(event) => void markAttended(request, event)}
                    >
                      {busyId === request.publicId ? "Guardando…" : "Marcar como atendida"}
                    </button>
                  </div>
                ) : null}

                {flashing ? (
                  <p className="mt-3 text-sm text-navy-soft" role="status" aria-live="polite">
                    ✓ Solicitud atendida
                  </p>
                ) : null}
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
