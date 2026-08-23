import { describe, it, expect } from "vitest";
import type { ModelMessage } from "ai";
import { buildModelInvocation, type RunPlan } from "./run-plan.ts";
import { CLEARED_TOOL_RESULT_MARKER } from "./tool-result-clearing.ts";

/**
 * `buildModelInvocation` is the one seam every Drive shares (`drive.ts`), so
 * these tests lock the `prepareStep` wiring for Tool-result clearing
 * (ADR-0018 Notes, issue #524) at the level every Drive inherits it from,
 * without a run around it.
 */

const BASE_PLAN: Omit<RunPlan, "model" | "tools" | "maxSteps"> = {};

const planOf = (overrides: Partial<RunPlan> = {}): RunPlan => ({
  model: {} as RunPlan["model"],
  tools: {},
  maxSteps: 5,
  ...BASE_PLAN,
  ...overrides,
});

const toolResultMessages = (n: number): ModelMessage[] =>
  Array.from({ length: n }, (_, i) => ({
    role: "tool" as const,
    content: [
      {
        type: "tool-result" as const,
        toolCallId: `t${i}`,
        toolName: "read_url",
        output: { type: "text" as const, value: `content ${i}` },
      },
    ],
  }));

const invoke = (plan: RunPlan) =>
  buildModelInvocation(plan, { abortSignal: new AbortController().signal });

describe("buildModelInvocation prepareStep", () => {
  it("is a no-op on the first call when no initialOccupancy is set", async () => {
    const { prepareStep } = invoke(
      planOf({ contextWindow: 100 }),
    ) as unknown as {
      prepareStep: (opts: {
        steps: unknown[];
        messages: ModelMessage[];
      }) => Promise<Record<string, unknown>> | Record<string, unknown>;
    };
    const messages = toolResultMessages(10);
    const result = await prepareStep({ steps: [], messages });
    expect(result).toEqual({});
  });

  it("clears stale results on the first call when initialOccupancy is already past threshold", async () => {
    const { prepareStep } = invoke(
      planOf({ contextWindow: 100, initialOccupancy: 90 }),
    ) as unknown as {
      prepareStep: (opts: {
        steps: unknown[];
        messages: ModelMessage[];
      }) => Promise<{ messages?: ModelMessage[] }>;
    };
    const messages = toolResultMessages(10);
    const result = await prepareStep({ steps: [], messages });
    expect(result.messages).toBeDefined();
    const firstOutput = (
      result.messages![0] as {
        content: Array<{ output: { value: string } }>;
      }
    ).content[0].output;
    expect(firstOutput.value).toBe(CLEARED_TOOL_RESULT_MARKER);
  });

  it("reads occupancy from the last completed step on later calls, not initialOccupancy", async () => {
    const { prepareStep } = invoke(
      planOf({ contextWindow: 100, initialOccupancy: 0 }),
    ) as unknown as {
      prepareStep: (opts: {
        steps: Array<{ usage?: { inputTokens?: number } }>;
        messages: ModelMessage[];
      }) => Promise<{ messages?: ModelMessage[] }>;
    };
    const messages = toolResultMessages(10);
    const result = await prepareStep({
      steps: [{ usage: { inputTokens: 95 } }],
      messages,
    });
    expect(result.messages).toBeDefined();
  });

  it("does nothing when the Context window is undeclared", async () => {
    const { prepareStep } = invoke(
      planOf({ initialOccupancy: 1_000_000 }),
    ) as unknown as {
      prepareStep: (opts: {
        steps: unknown[];
        messages: ModelMessage[];
      }) => Promise<Record<string, unknown>>;
    };
    const messages = toolResultMessages(10);
    const result = await prepareStep({ steps: [], messages });
    expect(result).toEqual({});
  });
});
