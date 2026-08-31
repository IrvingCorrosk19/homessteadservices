/**
 * Multi-need cognitive model — separate actionable needs from information inquiries.
 */
import { detectServices } from "@/lib/concierge/playbook-engine";

export type ServiceNeedGoal = "ACTIONABLE" | "INFORMATION";
export type ServiceNeedStatus = "ACTIVE" | "DEFERRED" | "INFORMATION_ONLY";

export type ServiceNeed = {
  id: string;
  serviceType: string;
  goal: ServiceNeedGoal;
  status: ServiceNeedStatus;
  priority: number;
  facts: Record<string, string>;
  summary: string;
};

const LEAK_RE = /\b(fuga|gotea|goteo|filtraci[oó]n)\b/i;
const MAINT_RE = /\b(mantenimiento|servicio)\b.*\b(aires?|ac|equipos?)\b/i;
const PAINT_PRICE_RE = /\b(cu[aá]nto|cuesta|precio|costo|cotiz)\b.*\bpint/i;

function needId(service: string, index: number) {
  return `${service}-${index + 1}`;
}

export function extractServiceNeeds(text: string): ServiceNeed[] {
  const services = detectServices(text);
  const needs: ServiceNeed[] = [];
  let priority = 1;

  if (MAINT_RE.test(text) || (services.includes("ac") && /\b(aires?|ac|equipos?)\b/i.test(text))) {
    needs.push({
      id: needId("ac", needs.length),
      serviceType: "ac",
      goal: "ACTIONABLE",
      status: "ACTIVE",
      priority: priority++,
      facts: {},
      summary: "AC maintenance or service",
    });
  }

  if (LEAK_RE.test(text) || services.includes("plumbing")) {
    if (!needs.some((n) => n.serviceType === "plumbing")) {
      needs.push({
        id: needId("plumbing", needs.length),
        serviceType: "plumbing",
        goal: "ACTIONABLE",
        status: "ACTIVE",
        priority: priority++,
        facts: {},
        summary: "Plumbing leak or water issue",
      });
    }
  }

  if (PAINT_PRICE_RE.test(text) || (services.includes("painting") && /\b(cu[aá]nto|cuesta|precio)\b/i.test(text))) {
    needs.push({
      id: needId("painting", needs.length),
      serviceType: "painting",
      goal: "INFORMATION",
      status: "INFORMATION_ONLY",
      priority: priority++,
      facts: {},
      summary: "Painting pricing inquiry",
    });
  } else if (services.includes("painting") && !needs.some((n) => n.serviceType === "painting")) {
    needs.push({
      id: needId("painting", needs.length),
      serviceType: "painting",
      goal: "ACTIONABLE",
      status: "ACTIVE",
      priority: priority++,
      facts: {},
      summary: "Painting service",
    });
  }

  return needs;
}

export function reprioritizeNeeds(needs: ServiceNeed[], urgentService: string): ServiceNeed[] {
  const urgent = urgentService.toLowerCase();
  return [...needs]
    .map((n) => {
      const status: ServiceNeedStatus =
        n.serviceType === urgent ? "ACTIVE" : n.status === "INFORMATION_ONLY" ? "INFORMATION_ONLY" : "DEFERRED";
      return {
        ...n,
        priority: n.serviceType === urgent ? 0 : n.priority + 1,
        status,
      };
    })
    .sort((a, b) => a.priority - b.priority);
}
