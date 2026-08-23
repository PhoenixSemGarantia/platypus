import {
  CLEARABLE_TOOL_NAMES,
  TOOL_RESULT_CLEARING_KEEP_RECENT,
  TOOL_RESULT_CLEARING_THRESHOLD,
} from "@platypus/schemas";
import { isToolUIPart, type UIMessage } from "ai";

/**
 * The client-side mirror of Tool-result clearing's "which results are stale"
 * rule (ADR-0018 Notes, `apps/backend/src/runs/tool-result-clearing.ts`, issue
 * #524) — derived, never persisted, so it can never drift into a stored lie
 * about a message that a later turn changes the answer for.
 *
 * Shares its constants with the backend via `@platypus/schemas`, so this and
 * the actual clearing decision can't silently disagree on the threshold or how
 * many recent results survive; only the "what was sent" mechanics differ,
 * because this reads UI messages rather than `ModelMessage[]`.
 */

type ToolLikePart = {
  type: string;
  toolCallId: string;
  state: string;
  toolName?: string;
};

const isToolLikePart = (part: unknown): part is ToolLikePart =>
  typeof part === "object" &&
  part !== null &&
  "toolCallId" in part &&
  "state" in part &&
  "type" in part;

/** The bare tool name a UI message part carries, static or dynamic. */
const toolNameOf = (part: ToolLikePart): string =>
  part.type === "dynamic-tool"
    ? (part.toolName ?? "")
    : isToolUIPart(part as never)
      ? part.type.slice("tool-".length)
      : "";

/**
 * The `toolCallId`s of tool results this session's Chat meter would report as
 * cleared: allowlisted, output-available, and NOT among the most recent
 * `TOOL_RESULT_CLEARING_KEEP_RECENT` such results, given the Context occupancy
 * reading is at or above the shared threshold.
 *
 * Returns an empty set — clears nothing visually — the same way clearing
 * itself does nothing when occupancy or the Context window is unknown.
 */
export const clearedToolCallIds = (
  messages: readonly UIMessage[],
  reading: { occupancy?: number; contextWindow?: number },
): ReadonlySet<string> => {
  const { occupancy, contextWindow } = reading;
  if (occupancy === undefined || contextWindow === undefined) {
    return new Set();
  }
  if (occupancy / contextWindow < TOOL_RESULT_CLEARING_THRESHOLD) {
    return new Set();
  }

  const clearableIds: string[] = [];
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (!isToolLikePart(part)) continue;
      if (part.state !== "output-available") continue;
      if (!CLEARABLE_TOOL_NAMES.has(toolNameOf(part))) continue;
      clearableIds.push(part.toolCallId);
    }
  }

  const staleCount = Math.max(
    0,
    clearableIds.length - TOOL_RESULT_CLEARING_KEEP_RECENT,
  );
  return new Set(clearableIds.slice(0, staleCount));
};
