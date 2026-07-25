import { type UIMessage, type InferUITool, type UIDataTypes } from "ai";
import { createLoadSkillTool } from "./tools/skill.ts";

/**
 * Metadata the run pipeline attaches to a streamed assistant message.
 *
 * Omitted entirely for runs that resolved no agent (a direct provider/model
 * chat), which is why `UIMessage["metadata"]` stays optional rather than the
 * fields inside it.
 */
export type ChatMessageMetadata = {
  /** Agent the run resolved; the chat UI renders its name and avatar. */
  agentId: string;
};

/**
 * Tools whose input/output shapes are consumed by bespoke chat UI.
 *
 * Deliberately not the whole tool surface, and it cannot be one: the native
 * tool sets are plugins loaded at runtime (ADR-0013), third-party plugins
 * contribute tools under namespaced contribution ids, and MCP tools are
 * unknown until connect time. Add an entry only when a component needs that
 * tool's typed input or output — every other tool renders through the generic
 * `ToolUIPart` path. Sub-agent delegate tools cannot be listed either: their
 * names are generated per sub-agent, so the renderer matches on the
 * `tool-delegateTo` prefix instead of a static key.
 */
export type CustomUITools = {
  loadSkill: InferUITool<ReturnType<typeof createLoadSkillTool>>;
};

export type PlatypusUIMessage = UIMessage<
  ChatMessageMetadata,
  UIDataTypes,
  CustomUITools
>;
