/**
 * Tool loop protection — per-turn budgets.
 */
export type ToolLoopBudget = {
  maxPlanningIterations: number;
  maxToolCalls: number;
  maxSameToolCalls: number;
  timeoutMs: number;
};

export const DEFAULT_TOOL_BUDGET: ToolLoopBudget = {
  maxPlanningIterations: 3,
  maxToolCalls: 6,
  maxSameToolCalls: 2,
  timeoutMs: 28_000,
};

export class ToolLoopGuard {
  private counts = new Map<string, number>();
  private total = 0;
  private started = Date.now();

  constructor(private budget: ToolLoopBudget = DEFAULT_TOOL_BUDGET) {}

  canCall(toolName: string): { ok: boolean; reason?: string } {
    if (Date.now() - this.started > this.budget.timeoutMs) {
      return { ok: false, reason: "timeout_budget" };
    }
    if (this.total >= this.budget.maxToolCalls) {
      return { ok: false, reason: "max_tool_calls" };
    }
    const same = this.counts.get(toolName) || 0;
    if (same >= this.budget.maxSameToolCalls) {
      return { ok: false, reason: "max_same_tool" };
    }
    return { ok: true };
  }

  record(toolName: string) {
    this.total += 1;
    this.counts.set(toolName, (this.counts.get(toolName) || 0) + 1);
  }

  snapshot() {
    return { total: this.total, byTool: Object.fromEntries(this.counts) };
  }
}
