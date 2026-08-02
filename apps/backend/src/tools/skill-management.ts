import { tool, type Tool } from "ai";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { skillBaseSchema } from "@platypus/schemas";
import { db } from "../index.ts";
import { skill as skillTable, agent as agentTable } from "../db/schema.ts";
import { buildResourceUrl } from "../utils/resource-url.ts";

// Field constraints come from the shared schema so the agent-facing tool can
// never drift from the bounds the HTTP routes and the web form enforce.
const skillFields = skillBaseSchema.shape;

export function createSkillManagementTools(
  workspaceId: string,
  orgId: string,
  frontendUrl: string | undefined,
): Record<string, Tool> {
  const listSkills = tool({
    description: "List all skills in the current workspace.",
    inputSchema: z.object({}),
    execute: async () => {
      const skills = await db
        .select({
          id: skillTable.id,
          name: skillTable.name,
          description: skillTable.description,
          createdAt: skillTable.createdAt,
          updatedAt: skillTable.updatedAt,
        })
        .from(skillTable)
        .where(eq(skillTable.workspaceId, workspaceId));
      return skills;
    },
  });

  const getSkill = tool({
    description: "Get the full content of a skill by name.",
    inputSchema: z.object({
      name: z.string().describe("The name of the skill to retrieve"),
    }),
    execute: async ({ name }) => {
      const result = await db
        .select()
        .from(skillTable)
        .where(
          and(
            eq(skillTable.workspaceId, workspaceId),
            eq(skillTable.name, name),
          ),
        )
        .limit(1);

      if (result.length === 0) {
        return { error: "Skill not found" };
      }

      const url = buildResourceUrl(
        frontendUrl,
        orgId,
        workspaceId,
        `skills/${result[0].id}`,
      );

      return { ...result[0], ...(url && { url }) };
    },
  });

  const upsertSkill = tool({
    description:
      "Create a new skill or update an existing skill by name. If a skill with the given name already exists in this workspace, it will be updated.",
    inputSchema: z.object({
      name: skillFields.name.describe(
        "Kebab-case name of the skill, unique within the workspace",
      ),
      description: skillFields.description.describe(
        "Short summary of what the skill does and when to use it",
      ),
      body: skillFields.body.describe("The Markdown content of the skill"),
    }),
    execute: async ({ name, description, body }) => {
      const { nanoid } = await import("nanoid");
      const now = new Date();

      const record = await db
        .insert(skillTable)
        .values({
          id: nanoid(),
          workspaceId,
          name,
          description,
          body,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [skillTable.workspaceId, skillTable.name],
          set: {
            description,
            body,
            updatedAt: now,
          },
        })
        .returning();

      const url = buildResourceUrl(
        frontendUrl,
        orgId,
        workspaceId,
        `skills/${record[0].id}`,
      );

      return { ...record[0], ...(url && { url }) };
    },
  });

  const deleteSkill = tool({
    description:
      "Delete a skill by name. Will fail if the skill is referenced by one or more agents.",
    inputSchema: z.object({
      name: z.string().describe("The name of the skill to delete"),
    }),
    execute: async ({ name }) => {
      const existing = await db
        .select({ id: skillTable.id })
        .from(skillTable)
        .where(
          and(
            eq(skillTable.workspaceId, workspaceId),
            eq(skillTable.name, name),
          ),
        )
        .limit(1);

      if (existing.length === 0) {
        return { error: "Skill not found" };
      }

      const skillId = existing[0].id;

      const referencingAgents = await db
        .select({ id: agentTable.id })
        .from(agentTable)
        .where(
          and(
            eq(agentTable.workspaceId, workspaceId),
            sql`${agentTable.skillIds} @> ${JSON.stringify([skillId])}::jsonb`,
          ),
        )
        .limit(1);

      if (referencingAgents.length > 0) {
        return {
          error:
            "Cannot delete skill because it is referenced by one or more agents",
        };
      }

      await db
        .delete(skillTable)
        .where(
          and(
            eq(skillTable.id, skillId),
            eq(skillTable.workspaceId, workspaceId),
          ),
        );

      return { success: true };
    },
  });

  return {
    listSkills,
    getSkill,
    upsertSkill,
    deleteSkill,
  };
}
