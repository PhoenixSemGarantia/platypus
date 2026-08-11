import { describe, it, expect, vi } from "vitest";
import { readUIMessageStream, stepCountIs, streamText, tool } from "ai";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { z } from "zod";

vi.mock("../logger.ts", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { createMessageMetadata } from "./message-metadata.ts";
import type { PlatypusUIMessage } from "../types.ts";

/**
 * Context occupancy, driven through a real multi-step stream.
 *
 * The run-lifecycle suite mocks the AI SDK wholesale: the model is a sentinel
 * and the usage numbers are whatever the test author typed, so an
 * implementation reading the SDK's cumulative usage passes it happily. This
 * suite is the only one that can fail on ADR-0018's central trap — three
 * numbers look like occupancy and two of them are sums.
 *
 * Per-step usage is deliberately different, and deliberately not a multiple of
 * itself, so the last step's count, the sum, and any average are three
 * distinguishable numbers.
 */

const usage = (inputTotal: number, outputTotal: number) => ({
  inputTokens: {
    total: inputTotal,
    noCache: inputTotal,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: outputTotal, text: outputTotal, reasoning: undefined },
});

/** A Provider that reports no token usage — occupancy is then unknowable. */
const NO_USAGE = {
  inputTokens: {
    total: undefined,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
};

/** The tool the model calls to force a second round trip. */
const ping = tool({
  description: "Ping a service.",
  inputSchema: z.object({}),
  execute: () => Promise.resolve("pong"),
});

/**
 * The provider-level stream result and part types, reached through the mock
 * model's own signature — `@ai-sdk/provider`, which declares them, is a
 * transitive dependency rather than one this app imports directly.
 */
type StreamResult = Extract<
  NonNullable<ConstructorParameters<typeof MockLanguageModelV4>[0]>["doStream"],
  ReadonlyArray<unknown>
>[number];
type StreamPart = StreamResult extends { stream: ReadableStream<infer Part> }
  ? Part
  : never;
/** What a Provider reports for one model call. */
type ProviderUsage = Extract<StreamPart, { type: "finish" }>["usage"];

const chunks = (parts: StreamPart[]): StreamResult => ({
  stream: simulateReadableStream({ chunks: parts }),
});

/** Step one: the model calls the tool. */
const toolCallStep = (reported: ProviderUsage) =>
  chunks([
    { type: "stream-start", warnings: [] },
    { type: "tool-input-start", id: "call-1", toolName: "ping" },
    { type: "tool-input-delta", id: "call-1", delta: "{}" },
    { type: "tool-input-end", id: "call-1" },
    { type: "tool-call", toolCallId: "call-1", toolName: "ping", input: "{}" },
    {
      type: "finish",
      finishReason: { unified: "tool-calls", raw: "tool_use" },
      usage: reported,
    },
  ]);

/** Step two: the tool result is back in the prompt, and the model answers. */
const answerStep = (reported: ProviderUsage) =>
  chunks([
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: "The service answered." },
    { type: "text-end", id: "t1" },
    {
      type: "finish",
      finishReason: { unified: "stop", raw: "end_turn" },
      usage: reported,
    },
  ]);

const mockModel = (steps: StreamResult[]) =>
  new MockLanguageModelV4({
    provider: "anthropic",
    modelId: "claude-opus-4-5",
    doStream: steps,
  });

/**
 * Consume a UI message stream the way both the client and the run's own
 * snapshot reader do, and return the message they end up with — metadata
 * chunks merged, which is where a reading either survives or is overwritten.
 */
const lastSnapshot = async (
  stream: Parameters<
    typeof readUIMessageStream<PlatypusUIMessage>
  >[0]["stream"],
): Promise<PlatypusUIMessage | undefined> => {
  let message: PlatypusUIMessage | undefined;
  for await (const snapshot of readUIMessageStream<PlatypusUIMessage>({
    stream,
  })) {
    message = snapshot;
  }
  return message;
};

/** The production wiring: the runner passes exactly this to the SDK. */
const uiStreamOf = (result: {
  toUIMessageStream: (opts: {
    messageMetadata: ReturnType<typeof createMessageMetadata>;
  }) => Parameters<typeof lastSnapshot>[0];
}) =>
  result.toUIMessageStream({
    messageMetadata: createMessageMetadata("agent-1"),
  });

/**
 * A two-step turn: 1,000 tokens in on the first call, 4,200 on the second
 * because the tool call and its result are now part of the prompt. Returns the
 * finished message alongside the SDK's own cumulative figure, so a test can
 * name the number occupancy must not be.
 */
const runTurn = async () => {
  const result = streamText({
    model: mockModel([
      toolCallStep(usage(1_000, 30)),
      answerStep(usage(4_200, 70)),
    ]),
    prompt: "Ping the service and tell me what it said.",
    tools: { ping },
    stopWhen: [stepCountIs(5)],
  });

  const message = await lastSnapshot(uiStreamOf(result));
  return { message, totalUsage: await result.totalUsage };
};

describe("Context occupancy over a real multi-step stream", () => {
  it("records the last model call's input tokens, not the sum across steps", async () => {
    const { message, totalUsage } = await runTurn();

    expect(message?.metadata?.contextOccupancy).toEqual({
      inputTokens: 4_200,
      outputTokens: 70,
    });
    // The number the implementation must not have read. It is the SDK's
    // cumulative usage — correct as a billing figure, and on a twenty-step
    // turn it reads roughly an order of magnitude high.
    expect(totalUsage.inputTokens).toBe(5_200);
  });

  it("keeps the agent attribution on the same message", async () => {
    const { message } = await runTurn();

    expect(message?.metadata?.agentId).toBe("agent-1");
  });

  // A cancelled turn never emits a terminal finish part, and cancelling a long
  // turn is exactly when the context had grown most.
  it("keeps the reading from a turn cancelled mid-stream", async () => {
    const controller = new AbortController();
    const result = streamText({
      model: mockModel([
        toolCallStep(usage(1_000, 30)),
        answerStep(usage(4_200, 70)),
      ]),
      prompt: "Ping the service and tell me what it said.",
      tools: { ping },
      stopWhen: [stepCountIs(5)],
      abortSignal: controller.signal,
      // Cancelled the moment the first step lands, so the turn ends with one
      // step's reading taken and no terminal finish part.
      onStepFinish: () => controller.abort(),
    });

    const message = await lastSnapshot(uiStreamOf(result));

    // The turn really did stop early: the second step's answer never arrived.
    expect(message?.parts).not.toContainEqual(
      expect.objectContaining({ type: "text" }),
    );
    expect(message?.metadata?.contextOccupancy).toEqual({
      inputTokens: 1_000,
      outputTokens: 30,
    });
  });

  it("records nothing when the Provider reports no usage at all", async () => {
    const result = streamText({
      model: mockModel([answerStep(NO_USAGE)]),
      prompt: "Hi.",
    });

    const message = await lastSnapshot(uiStreamOf(result));

    // Attributed, but nothing estimated from the text it produced.
    expect(message?.metadata?.agentId).toBe("agent-1");
    expect(message?.metadata).not.toHaveProperty("contextOccupancy");
  });

  // The first step's 1,000 tokens are not this turn's context size, and the
  // merge would keep them on the message unless something concrete replaces
  // them.
  it("does not leave an earlier step's figure standing when the last step reports no usage", async () => {
    const result = streamText({
      model: mockModel([toolCallStep(usage(1_000, 30)), answerStep(NO_USAGE)]),
      prompt: "Ping the service and tell me what it said.",
      tools: { ping },
      stopWhen: [stepCountIs(5)],
    });

    const message = await lastSnapshot(uiStreamOf(result));

    expect(message?.metadata?.contextOccupancy).toBeNull();
  });
});
