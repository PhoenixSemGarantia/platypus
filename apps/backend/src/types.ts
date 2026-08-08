import { type UIMessage, type InferUITool, type UIDataTypes } from "ai";
import { createLoadSkillTool } from "./tools/skill.ts";

/**
 * Metadata the run pipeline attaches to a streamed assistant message.
 *
 * Every field is optional and each is emitted on its own stream chunk: the
 * client merges metadata chunks into the message rather than replacing it, so
 * a run that resolves no agent but ends truncated still carries the truncation
 * flag, and a truncated agent run keeps its attribution.
 *
 * A key that does not apply is absent rather than `false`, so a message's
 * metadata says only what is true of it.
 */
export type ChatMessageMetadata = {
  /** Agent the run resolved; the chat UI renders its name and avatar. */
  agentId?: string;
  /**
   * The turn's terminal finish hit the model's output token ceiling, so the
   * answer stops mid-thought. The chat marks the message as cut short.
   */
  truncatedByTokenLimit?: true;
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
