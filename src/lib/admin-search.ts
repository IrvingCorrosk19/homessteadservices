import { listCustomers } from "@/lib/customer-360";
import { getHomesteadDb, listServiceRequestsForOps } from "@/lib/service-requests";
import { appointmentServiceLabel } from "@/lib/appointment-time";

export type AdminSearchResult =
  | { type: "customer"; id: string; title: string; subtitle: string; href: string }
  | { type: "request"; id: string; title: string; subtitle: string; href: string }
  | { type: "appointment"; id: string; title: string; subtitle: string; href: string };

export function adminGlobalSearch(query: string, limit = 6): AdminSearchResult[] {
  const q = query.trim();
  if (q.length < 2) return [];

  const out: AdminSearchResult[] = [];
  const customers = listCustomers({ q, includeTest: false, limit, offset: 0 }).rows;
  for (const row of customers) {
    out.push({
      type: "customer",
      id: String(row.customerId),
      title: row.name || "Cliente sin nombre",
      subtitle: row.phone || row.email || "Cliente",
      href: `/admin/clientes/${row.customerId}`,
    });
  }

  for (const row of listServiceRequestsForOps({ q }).slice(0, limit)) {
    out.push({
      type: "request",
      id: row.publicId,
      title: row.publicId,
      subtitle: `${row.name} · ${row.service}`,
      href: `/admin/solicitudes/${row.publicId}`,
    });
  }

  const like = `%${q.toLowerCase()}%`;
  const phoneLike = `%${q.replace(/\D/g, "")}%`;
  const appts = getHomesteadDb()
    .prepare(
      `SELECT a.appointment_id, c.name, a.date, a.start_time, a.service, a.status
       FROM revenue_appointments a
       JOIN revenue_customers c ON c.id = a.customer_id
       WHERE lower(a.appointment_id) LIKE ?
          OR lower(c.name) LIKE ?
          OR c.phone LIKE ?
       ORDER BY a.date DESC, a.start_time DESC
       LIMIT ?`,
    )
    .all(like, like, phoneLike, limit) as Array<{
    appointment_id: string;
    name: string;
    date: string;
    start_time: string;
    service: string;
    status: string;
  }>;

  for (const row of appts) {
    out.push({
      type: "appointment",
      id: row.appointment_id,
      title: row.appointment_id.slice(0, 12),
      subtitle: `${row.name} · ${appointmentServiceLabel(row.service)} · ${row.date} ${row.start_time}`,
      href: `/admin/citas?id=${encodeURIComponent(row.appointment_id)}`,
    });
  }

  return out.slice(0, limit * 2);
}
