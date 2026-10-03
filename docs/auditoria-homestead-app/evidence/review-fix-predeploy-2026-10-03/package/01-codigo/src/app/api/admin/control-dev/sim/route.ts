import { NextResponse } from "next/server";
import { requireAdminMutation, requireAdminSession } from "@/lib/control-auth";
import {
  getSimulatedGraphScenario,
  getSimulatedNotifyScenario,
  isControlIsolated,
  listSimulatedCalls,
  resetSimulatedCalls,
  setSimulatedGraphScenario,
  setSimulatedNotifyScenario,
  type SimulatedGraphScenario,
  type SimulatedNotifyScenario,
} from "@/lib/control-isolation";

export const runtime = "nodejs";

const GRAPH: SimulatedGraphScenario[] = [
  "ok",
  "fail_facebook",
  "fail_instagram",
  "fail_all",
  "uncertain_facebook",
  "fail_ig_second_child",
  "fail_ig_child_wait",
  "fail_ig_carousel_parent",
];
const NOTIFY: SimulatedNotifyScenario[] = ["ok", "fail_once", "fail"];

function forbidUnlessIsolated() {
  if (!isControlIsolated()) {
    return NextResponse.json({ ok: false, error: "not_isolated" }, { status: 404 });
  }
  return null;
}

export async function GET(request: Request) {
  const blocked = forbidUnlessIsolated();
  if (blocked) return blocked;
  const gate = await requireAdminSession(request);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  return NextResponse.json({
    ok: true,
    isolated: true,
    graphScenario: getSimulatedGraphScenario(),
    notifyScenario: getSimulatedNotifyScenario(),
    simulatedCalls: listSimulatedCalls().slice(-40),
  });
}

export async function POST(request: Request) {
  const blocked = forbidUnlessIsolated();
  if (blocked) return blocked;
  const gate = await requireAdminMutation(request);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  const body = (await request.json().catch(() => ({}))) as {
    graphScenario?: string;
    notifyScenario?: string;
    resetCalls?: boolean;
  };
  if (body.resetCalls) resetSimulatedCalls();
  if (body.graphScenario) {
    if (!GRAPH.includes(body.graphScenario as SimulatedGraphScenario)) {
      return NextResponse.json({ ok: false, error: "bad_graph_scenario" }, { status: 400 });
    }
    setSimulatedGraphScenario(body.graphScenario as SimulatedGraphScenario);
  }
  if (body.notifyScenario) {
    if (!NOTIFY.includes(body.notifyScenario as SimulatedNotifyScenario)) {
      return NextResponse.json({ ok: false, error: "bad_notify_scenario" }, { status: 400 });
    }
    setSimulatedNotifyScenario(body.notifyScenario as SimulatedNotifyScenario);
  }
  return NextResponse.json({
    ok: true,
    graphScenario: getSimulatedGraphScenario(),
    notifyScenario: getSimulatedNotifyScenario(),
    simulatedCalls: listSimulatedCalls().slice(-20),
  });
}
