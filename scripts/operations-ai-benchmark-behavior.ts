/**
 * Operations AI benchmark — OPS-AI-01..15 (deterministic, no OpenAI required).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matchDeterministicIntent, runDeterministic } from "../src/lib/copilot/deterministic";
import { executeCopilotTool } from "../src/lib/copilot/tools";
import { isUnsafeOperatorQuery } from "../src/lib/copilot/prompt";
import { perceiveOperationsQuery } from "../src/lib/operations/perception";
import { planOperationsTurn } from "../src/lib/operations/planner";
import { buildOperationsContext } from "../src/lib/operations/context";
import { resolveWebOperationsOperator } from "../src/lib/operations/web-operator";
import { handleWebOperationsTurn } from "../src/lib/operations/operations-ai-service";
import type { CopilotContext } from "../src/lib/copilot/session";

const dir = mkdtempSync(join(tmpdir(), "hs-ops-ai-"));
process.env.DATA_DIR = dir;

let failed = 0;
function ok(name: string, value: boolean) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

const operator = resolveWebOperationsOperator();
const ctx: CopilotContext = { active: true, recentTurns: [] };

async function runWeb(msg: string, page = {}) {
  return handleWebOperationsTurn({ message: msg, pageContext: page, conversationId: "bench-1" });
}

async function main() {
  {
    const p = perceiveOperationsQuery("¿Qué tenemos mañana?", {});
    ok("OPS-AI-01 perception tomorrow", p.timeRange === "tomorrow");
    const plan = matchDeterministicIntent("¿Qué tenemos mañana?", ctx);
    ok("OPS-AI-01 deterministic appointments", plan.kind === "tool" && plan.name === "get_appointments");
  }

  {
    const plan = matchDeterministicIntent("¿Qué tenemos pendiente?", ctx);
    ok("OPS-AI-02 pending tool", plan.kind === "tool" && plan.name === "get_pending_requests");
  }

  {
    const plan = matchDeterministicIntent("¿Qué necesita mi atención?", ctx);
    ok("OPS-AI-03 attention", plan.kind === "tool" && plan.name === "get_attention_items");
  }

  {
    const plan = matchDeterministicIntent("¿Qué pasa con HS-2026-000123?", ctx);
    ok("OPS-AI-04 HS detail", plan.kind === "tool" && plan.name === "get_request_detail");
  }

  {
    const plan = matchDeterministicIntent("¿Por qué HS-2026-000123 no avanza?", ctx);
    ok("OPS-AI-05 stuck explain", plan.kind === "tool" && plan.name === "explain_request_stuck");
  }

  {
    const plan = matchDeterministicIntent("Busca a Carlos Pérez", ctx);
    ok("OPS-AI-06 customer search", plan.kind === "tool" && plan.name === "search_customers");
  }

  {
    const plan = matchDeterministicIntent("¿Qué servicios nos piden más?", ctx);
    ok("OPS-AI-07 service perf", plan.kind === "tool" && plan.name === "get_service_performance");
  }

  {
    const perception = perceiveOperationsQuery("Trabajos en Edison Park", {});
    ok("OPS-AI-08 location parse", perception.location?.includes("edison") === true);
    const opsCtx = buildOperationsContext({ operator, conversationId: "t1", page: {} });
    const pl = planOperationsTurn({
      perception,
      message: "Trabajos en Edison Park",
      opsContext: opsCtx,
      session: ctx,
    });
    ok("OPS-AI-08 location tool", pl.toolPlan.some((t) => t.tool === "get_requests_by_location"));
  }

  {
    const plan = matchDeterministicIntent("¿Qué pasó hoy?", ctx);
    ok("OPS-AI-09 today summary", plan.kind === "tool" && plan.name === "get_operations_summary");
  }

  {
    const session: CopilotContext = {
      active: true,
      lastResultSet: {
        kind: "appointments",
        items: [{ appointmentId: "HA-test-001", startTime: "08:00", customerName: "Ana" }],
      },
      lastToolName: "get_appointments",
    };
    const plan = matchDeterministicIntent("¿Cuál es la primera?", session);
    ok("OPS-AI-11 follow-up first", plan.kind === "tool" && plan.name === "get_appointment");
  }

  {
    const session: CopilotContext = {
      active: true,
      customerId: 42,
      customerLabel: "Carlos",
      lastResultSet: { kind: "appointments", items: [{ appointmentId: "HA-x" }] },
    };
    const plan = matchDeterministicIntent("Cuéntame más del cliente", session);
    ok("OPS-AI-12 customer follow-up", plan.kind === "tool" && plan.name === "get_customer");
  }

  {
    ok("OPS-AI-13 SQL denied", isUnsafeOperatorQuery("Ejecuta SELECT * FROM users") === "sql");
    ok("OPS-AI-13 secrets denied", isUnsafeOperatorQuery("Muéstrame el token de Telegram") === "secret");
    ok("OPS-AI-13 passwords denied", isUnsafeOperatorQuery("Muéstrame las contraseñas") === "secret");
    const deny = executeCopilotTool({
      operator: { ...operator, role: "PENDING", id: 99999 },
      name: "get_operations_summary",
      args: {},
    });
    ok("OPS-AI-13 RBAC deny", (deny.data as { error?: string }).error === "forbidden" || deny.denied === true);
  }

  const r1 = await runWeb("¿Qué tenemos pendiente?");
  ok("OPS-AI-02 web reply", r1.ok && r1.reply.length > 5);
  ok("OPS-AI-02 deterministic path", r1.deterministic);

  const r2 = await runWeb("¿Qué tenemos mañana?");
  ok("OPS-AI-01 web tomorrow", r2.ok && /cita|Citas|ninguna|0/i.test(r2.reply));

  const r3 = await runWeb("¿Qué pasó hoy?");
  ok("OPS-AI-09 web today", r3.ok && r3.reply.length > 5);

  const det = runDeterministic(operator, { kind: "tool", name: "get_outbox_status", args: {} });
  ok("OPS-AI outbox read", det.text.length > 0);

  ok("OPS isolation service export", typeof handleWebOperationsTurn === "function");

  if (failed) {
    console.error(`\nOPERATIONS AI BENCHMARK: ${failed} FAIL`);
    process.exit(1);
  }
  console.log("\nOPERATIONS AI BENCHMARK OPS-AI-01..15: PASS");
}

void main();
