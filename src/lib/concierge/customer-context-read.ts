/**
 * Read-only customer context for concierge memory (no writes).
 */
import { classifyPhone } from "@/lib/phone";
import { getHomesteadDb } from "@/lib/service-requests";

export type CustomerContextSnapshot = {
  customerId: number;
  name: string;
  phone: string;
  generalLocation: string;
  priorRequests: Array<{
    publicId: string;
    service: string;
    status: string;
    createdAt: string;
  }>;
};

export function getCustomerContextByPhone(phone: string): CustomerContextSnapshot | null {
  const assessed = classifyPhone(phone);
  const digits = assessed.digits || phone.replace(/\D/g, "");
  if (!digits) return null;

  const db = getHomesteadDb();
  const customer = db
    .prepare(
      `SELECT id, name, phone, general_location FROM revenue_customers
       WHERE normalized_phone = ? OR phone = ? OR phone = ? OR phone = ?
       ORDER BY id ASC LIMIT 1`,
    )
    .get(digits, digits, assessed.e164 || digits, phone) as
    | { id: number; name: string; phone: string; general_location: string }
    | undefined;

  if (!customer) return null;

  const rows = db
    .prepare(
      `SELECT public_id, service, status, created_at FROM service_requests
       WHERE phone = ? OR phone = ? OR phone = ?
       ORDER BY created_at DESC LIMIT 8`,
    )
    .all(phone, digits, assessed.e164 || digits) as Array<{
    public_id: string;
    service: string;
    status: string;
    created_at: string;
  }>;

  return {
    customerId: customer.id,
    name: customer.name || "",
    phone: customer.phone || phone,
    generalLocation: customer.general_location || "",
    priorRequests: rows.map((r) => ({
      publicId: r.public_id,
      service: r.service,
      status: r.status,
      createdAt: r.created_at,
    })),
  };
}
