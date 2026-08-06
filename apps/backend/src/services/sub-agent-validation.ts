import { db } from "../index.ts";
import { listScoped, type ScopeContext } from "./scoped-resource.ts";

/**
 * Save-time guard on an Agent's `subAgentIds`, applied wherever a Workspace
 * surface writes them (the Agent routes and the agent-management tools).
 *
 * A sub-Agent must be **visible in this Workspace** — Workspace-scoped here, or
 * an Organization-scoped (Shared) Agent attached here (ADR-0007) — which is the
 * same rule the Chat turn applies when it loads them. Validating at Workspace
 * scope alone rejected an attached Shared Agent, so promoting a sub-Agent left
 * its parent unsavable from the Workspace surface.
 *
 * Promotion is a separate, stricter rule: a Shared Agent may reference only
 * other Shared resources (`findNonSharedReferences`).
 */
export const validateSubAgentAssignment = async (
  ctx: ScopeContext,
  agentId: string,
  subAgentIds: string[],
): Promise<{ valid: boolean; error?: string }> => {
  // 1. Check self-assignment
  if (subAgentIds.includes(agentId)) {
    return {
      valid: false,
      error: "An agent cannot assign itself as a sub-agent",
    };
  }

  if (subAgentIds.length === 0) return { valid: true };

  // 2. Every proposed sub-agent must be visible in this workspace at either scope
  const visible = await listScoped(db, "agent", ctx);
  const visibleIds = new Set(visible.map(({ row }) => row.id));

  if (subAgentIds.some((id) => !visibleIds.has(id))) {
    return {
      valid: false,
      error: "One or more sub-agents are not available in this workspace",
    };
  }

  // Note: We allow agents that have their own sub-agents to BE sub-agents.
  // The depth limit is enforced at runtime - sub-agent tools are only created
  // for parent agents, so sub-agents cannot delegate to further sub-agents.

  return { valid: true };
};
