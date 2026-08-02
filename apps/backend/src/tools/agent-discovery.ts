import { tool, type Tool } from "ai";
import { z } from "zod";
import { and, eq, or } from "drizzle-orm";
import { db } from "../index.ts";
import {
  agent as agentTable,
  mcp as mcpTable,
  provider as providerTable,
} from "../db/schema.ts";
import { getToolSets } from "../tools/index.ts";
import { buildResourceUrl } from "../utils/resource-url.ts";
import { providerModelReferences } from "../services/model-capability.ts";
import type { Provider } from "@platypus/schemas";

/**
 * Standalone factory for the listAgents tool so it can be shared across
 * multiple tool sets (e.g. agent-discovery AND kanban).
 */
export function createListAgentsTool(workspaceId: string): Tool {
  return tool({
    description: "List all agents in the current workspace.",
    inputSchema: z.object({}),
    execute: async () => {
      const agents = await db
        .select({
          id: agentTable.id,
          name: agentTable.name,
          description: agentTable.description,
          modelId: agentTable.modelId,
          providerId: agentTable.providerId,
        })
        .from(agentTable)
        .where(eq(agentTable.workspaceId, workspaceId));
      return agents;
    },
  });
}

export function createAgentDiscoveryTools(
  workspaceId: string,
  orgId: string,
  frontendUrl: string | undefined,
): Record<string, Tool> {
  const listToolSets = tool({
    description:
      "List all available tool sets and MCP servers. Use the returned IDs when assigning toolSetIds to agents.",
    inputSchema: z.object({}),
    execute: async () => {
      const toolSetsList = Object.entries(getToolSets()).map(
        ([id, toolSet]) => ({
          id,
          name: toolSet.name,
          category: toolSet.category,
          description: toolSet.description,
        }),
      );

      const mcps = await db
        .select()
        .from(mcpTable)
        .where(eq(mcpTable.workspaceId, workspaceId));
      const mcpList = mcps.map((mcp) => ({
        id: mcp.id,
        name: mcp.name,
        category: "MCP",
      }));

      return [...toolSetsList, ...mcpList];
    },
  });

  const listModelProviders = tool({
    description:
      "List all configured providers and their available model IDs. Use the returned provider IDs and model IDs when creating or updating agents, and pass a model ID back exactly as returned. An entry of the form 'alias:<name>' is a Model alias the provider gave one of its models: submit it unchanged rather than the vendor model id it currently points at, so the agent follows the alias when an admin repoints it.",
    inputSchema: z.object({}),
    execute: async () => {
      const providers = await db
        .select({
          id: providerTable.id,
          name: providerTable.name,
          modelIds: providerTable.modelIds,
        })
        .from(providerTable)
        .where(
          or(
            eq(providerTable.workspaceId, workspaceId),
            eq(providerTable.organizationId, orgId),
          ),
        );
      // Advertise the reference an alias-aware picker would submit — the alias
      // for an aliased model, the concrete id otherwise — regardless of whether
      // the row stores the new per-model objects or a legacy `string[]` (issues
      // #328, #386). This tool is the agentic counterpart of the Agent model
      // picker, so it must offer the same choices: handing back the concrete id
      // of an aliased model would silently opt every agent created this way out
      // of the next repoint (ADR-0017). Only `modelIds` is read, so the partial
      // row is cast to satisfy the resolver's signature.
      return providers.map((p) => ({
        ...p,
        modelIds: providerModelReferences(p as unknown as Provider),
      }));
    },
  });

  const listAgents = createListAgentsTool(workspaceId);

  const getAgent = tool({
    description: "Get full agent details by ID (excludes avatar).",
    inputSchema: z.object({
      agentId: z.string().describe("The ID of the agent to retrieve"),
      label: z.string().describe("The agent name (for display purposes)"),
    }),
    execute: async ({ agentId }) => {
      const result = await db
        .select({
          id: agentTable.id,
          workspaceId: agentTable.workspaceId,
          name: agentTable.name,
          description: agentTable.description,
          providerId: agentTable.providerId,
          modelId: agentTable.modelId,
          instructions: agentTable.instructions,
          maxSteps: agentTable.maxSteps,
          temperature: agentTable.temperature,
          topP: agentTable.topP,
          topK: agentTable.topK,
          seed: agentTable.seed,
          presencePenalty: agentTable.presencePenalty,
          frequencyPenalty: agentTable.frequencyPenalty,
          toolSetIds: agentTable.toolSetIds,
          skillIds: agentTable.skillIds,
          subAgentIds: agentTable.subAgentIds,
          inputPlaceholder: agentTable.inputPlaceholder,
          createdAt: agentTable.createdAt,
          updatedAt: agentTable.updatedAt,
        })
        .from(agentTable)
        .where(
          and(
            eq(agentTable.id, agentId),
            eq(agentTable.workspaceId, workspaceId),
          ),
        )
        .limit(1);

      if (result.length === 0) {
        return { error: "Agent not found" };
      }

      const url = buildResourceUrl(
        frontendUrl,
        orgId,
        workspaceId,
        `agents/${agentId}`,
      );

      return { ...result[0], ...(url && { url }) };
    },
  });

  return {
    listToolSets,
    listModelProviders,
    listAgents,
    getAgent,
  };
}
