import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  APICallError,
  InvalidToolInputError,
  LoadAPIKeyError,
  NoSuchToolError,
  TypeValidationError,
} from "ai";
import { z } from "zod";
import { formatStreamError, TRUNCATED_BY_TOKEN_LIMIT } from "./stream-error.ts";

vi.mock("../logger.ts", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

/**
 * The real error the SDK raises when a tool call's arguments fail their input
 * schema: an `InvalidToolInputError` wrapping a `TypeValidationError` wrapping
 * the `ZodError`. Built from a real Zod failure so the shape can't drift from
 * what the SDK actually produces.
 */
const invalidToolInput = (opts: {
  toolName: string;
  schema: z.ZodType;
  value: unknown;
}) => {
  const parsed = opts.schema.safeParse(opts.value);
  const cause = new TypeValidationError({
    value: opts.value,
    cause: parsed.error,
  });
  return new InvalidToolInputError({
    toolName: opts.toolName,
    toolInput: JSON.stringify(opts.value),
    cause,
  });
};

describe("formatStreamError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("existing branches are preserved", () => {
    it("names a missing API key", () => {
      expect(
        formatStreamError(new LoadAPIKeyError({ message: "no key" })),
      ).toBe("AI provider API key is missing or not configured.");
    });

    it.each([
      [401, "AI provider authentication failed"],
      [403, "AI provider authentication failed"],
      [429, "rate limit exceeded"],
      [500, "currently unavailable"],
      [503, "currently unavailable"],
    ])("maps HTTP %i to a specific message", (statusCode, expected) => {
      const error = new APICallError({
        message: "boom",
        url: "https://example.test",
        requestBodyValues: {},
        statusCode,
      });
      expect(formatStreamError(error)).toContain(expected);
    });

    it("falls back to the message of an unrecognised Error", () => {
      expect(formatStreamError(new Error("something specific"))).toBe(
        "something specific",
      );
    });
  });

  describe("invalid tool input", () => {
    const schema = z.object({ body: z.string().min(1).max(2000) });

    it("names the tool and the failing field rather than returning the raw message", () => {
      const error = invalidToolInput({
        toolName: "updateNotification",
        schema,
        value: { body: "x".repeat(2900) },
      });

      const formatted = formatStreamError(error);

      expect(formatted).toContain("updateNotification");
      expect(formatted).toContain("body");
      expect(formatted).toMatch(/2000/);
      // The whole point: this must REPLACE the SDK's message, which embeds the
      // entire rejected value plus the serialized ZodError.
      expect(formatted).not.toBe(error.message);
      expect(formatted).not.toContain("x".repeat(50));
    });

    it("stays short even when the rejected value is enormous", () => {
      const error = invalidToolInput({
        toolName: "updateNotification",
        schema,
        value: { body: "y".repeat(40000) },
      });

      expect(formatStreamError(error).length).toBeLessThan(500);
    });

    it("reports every failing field when more than one is invalid", () => {
      const multi = z.object({
        title: z.string().max(5),
        body: z.string().min(10),
      });
      const error = invalidToolInput({
        toolName: "createNotification",
        schema: multi,
        value: { title: "far too long", body: "short" },
      });

      const formatted = formatStreamError(error);
      expect(formatted).toContain("title");
      expect(formatted).toContain("body");
    });

    it("still names the tool when the cause carries no Zod issues", () => {
      const error = new InvalidToolInputError({
        toolName: "mysteryTool",
        toolInput: "{}",
        cause: new Error("unparseable"),
      });

      const formatted = formatStreamError(error);
      expect(formatted).toContain("mysteryTool");
      expect(formatted).toContain("unparseable");
    });
  });

  describe("unknown tool", () => {
    it("names the tool the model tried to call", () => {
      const error = new NoSuchToolError({
        toolName: "delegateToDashboardAgent",
        availableTools: ["delegateToObsidianAgent"],
      });

      const formatted = formatStreamError(error);
      expect(formatted).toContain("delegateToDashboardAgent");
      expect(formatted).not.toBe("An unexpected error occurred.");
    });
  });

  describe("generic fallback", () => {
    it.each([
      ["a string throw", "just a string"],
      ["a plain object throw", { nope: true }],
      ["a null throw", null],
    ])("records what actually arrived for %s", (_label, thrown) => {
      const formatted = formatStreamError(thrown);
      expect(formatted).toContain("An unexpected error occurred");
      // Must carry enough to identify the value that arrived — the reported
      // failure hit this branch and the type was never captured.
      expect(formatted.length).toBeGreaterThan(
        "An unexpected error occurred.".length,
      );
    });
  });
});

describe("TRUNCATED_BY_TOKEN_LIMIT", () => {
  it("states the cause in terms an agent can act on", () => {
    expect(TRUNCATED_BY_TOKEN_LIMIT).toMatch(/truncated/i);
    expect(TRUNCATED_BY_TOKEN_LIMIT).toMatch(/token limit/i);
  });
});
