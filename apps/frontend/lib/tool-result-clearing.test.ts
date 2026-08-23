import { describe, it, expect } from "vitest";
import type { UIMessage } from "ai";
import { clearedToolCallIds } from "./tool-result-clearing";

const toolResultMessage = (toolName: string, toolCallId: string): UIMessage =>
  ({
    id: `m-${toolCallId}`,
    role: "assistant",
    parts: [
      {
        type: `tool-${toolName}`,
        toolCallId,
        state: "output-available",
        input: {},
        output: { ok: true },
      },
    ],
  }) as unknown as UIMessage;

describe("clearedToolCallIds", () => {
  it("returns nothing when the Context window is unknown", () => {
    const messages = [
      toolResultMessage("read_url", "t1"),
      toolResultMessage("read_url", "t2"),
      toolResultMessage("read_url", "t3"),
      toolResultMessage("read_url", "t4"),
      toolResultMessage("read_url", "t5"),
      toolResultMessage("read_url", "t6"),
    ];
    expect(
      clearedToolCallIds(messages, { occupancy: 95, contextWindow: undefined }),
    ).toEqual(new Set());
  });

  it("returns nothing below the shared threshold", () => {
    const messages = [
      toolResultMessage("read_url", "t1"),
      toolResultMessage("read_url", "t2"),
    ];
    expect(
      clearedToolCallIds(messages, { occupancy: 10, contextWindow: 100 }),
    ).toEqual(new Set());
  });

  it("marks all but the shared keep-recent count as cleared, at threshold", () => {
    const messages = Array.from({ length: 6 }, (_, i) =>
      toolResultMessage("read_url", `t${i}`),
    );
    const result = clearedToolCallIds(messages, {
      occupancy: 95,
      contextWindow: 100,
    });
    // TOOL_RESULT_CLEARING_KEEP_RECENT is 4, so the first two are stale.
    expect(result).toEqual(new Set(["t0", "t1"]));
  });

  it("never marks a non-allowlisted tool's result as cleared", () => {
    const messages = Array.from({ length: 6 }, (_, i) =>
      toolResultMessage("fsWrite", `w${i}`),
    );
    const result = clearedToolCallIds(messages, {
      occupancy: 95,
      contextWindow: 100,
    });
    expect(result).toEqual(new Set());
  });

  it("ignores a clearable tool call that hasn't produced its result yet", () => {
    const inFlight = {
      id: "m-x",
      role: "assistant",
      parts: [
        {
          type: "tool-read_url",
          toolCallId: "x1",
          state: "input-available",
        },
      ],
    } as unknown as UIMessage;

    const messages = [
      ...Array.from({ length: 6 }, (_, i) =>
        toolResultMessage("read_url", `t${i}`),
      ),
      inFlight,
    ];
    const result = clearedToolCallIds(messages, {
      occupancy: 95,
      contextWindow: 100,
    });
    expect(result.has("x1")).toBe(false);
  });
});
