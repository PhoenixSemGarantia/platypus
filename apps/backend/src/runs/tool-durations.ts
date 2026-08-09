import { isToolUIPart } from "ai";
import type { PlatypusUIMessage } from "../types.ts";

/**
 * Folds recorded tool execution times into the run's final messages.
 *
 * Kept pure and separate from the runner because the SDK gives no seam for
 * writing this while streaming: the UI message stream's `tool-output-available`
 * reducer keeps the *stored* invocation's `toolMetadata` and drops whatever the
 * output chunk carried. So the duration is stamped once, on the finished
 * messages, just before the sink writes them.
 *
 * Durations are keyed by `toolCallId`, which both static (`tool-*`) and dynamic
 * tool parts carry. Existing metadata is merged, not replaced — the field is
 * provider-populated in principle even though nothing else sets it today.
 *
 * The SDK measures on a high-resolution clock and reports figures like
 * `706.9857919998467`. Nothing reads below a millisecond, so the value is
 * rounded before it goes into the message rather than storing sixteen
 * significant digits per tool call for the lifetime of the chat.
 */
export const applyToolDurations = (
  messages: PlatypusUIMessage[],
  durations: ReadonlyMap<string, number>,
): PlatypusUIMessage[] => {
  if (durations.size === 0) return messages;

  return messages.map((message) => {
    let patched = false;
    const parts = message.parts.map((part) => {
      // Covers both static (`tool-*`) and dynamic tool invocations.
      if (!isToolUIPart(part)) return part;
      const durationMs = durations.get(part.toolCallId);
      if (durationMs === undefined) return part;
      patched = true;
      return {
        ...part,
        toolMetadata: {
          ...part.toolMetadata,
          durationMs: Math.round(durationMs),
        },
      };
    });
    return patched ? { ...message, parts } : message;
  });
};
