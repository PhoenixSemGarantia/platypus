import {
  APICallError,
  InvalidToolInputError,
  LoadAPIKeyError,
  NoSuchToolError,
} from "ai";
import { logger } from "../logger.ts";

/**
 * What an unattended caller is told when a generation stopped because it ran
 * out of output budget rather than because it was finished.
 *
 * A constant so the wording is asserted in tests without restating the prose.
 * Currently appended only by the unattended (`generate`) path — the streaming
 * path reports truncation to the operator via `logger.warn` and has no seam for
 * injecting text into an already-flushed stream.
 */
export const TRUNCATED_BY_TOKEN_LIMIT =
  "The response was truncated because it reached the maximum output token limit. Retry with a shorter response, or split the work across several steps.";

/** The unified finish reason the SDK reports for an output-budget cutoff. */
export const isTruncatedByTokenLimit = (
  finishReason: string | undefined,
): boolean => finishReason === "length";

/** How much of a single validation issue is worth repeating back. */
const MAX_ISSUE_LENGTH = 160;
/** Beyond a handful of issues the list stops being diagnostic. */
const MAX_ISSUES = 5;

/** A Zod issue, structurally — avoids coupling to a specific zod version. */
type ZodLikeIssue = { path?: unknown[]; message?: string };

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * Walk an error's `cause` chain looking for Zod's `issues` array.
 *
 * The SDK nests these two deep — `InvalidToolInputError` → `TypeValidationError`
 * → `ZodError` — and the depth is an implementation detail we shouldn't encode,
 * so this searches rather than reaching through a fixed path.
 */
const findIssues = (error: unknown, depth = 0): ZodLikeIssue[] | undefined => {
  if (depth > 5 || error == null || typeof error !== "object") return undefined;
  const issues = (error as { issues?: unknown }).issues;
  if (Array.isArray(issues) && issues.length > 0)
    return issues as ZodLikeIssue[];
  return findIssues((error as { cause?: unknown }).cause, depth + 1);
};

/** `["body"]` → `body`, `["items", 2, "id"]` → `items[2].id`, `[]` → `(root)`. */
const formatPath = (path: unknown[] | undefined): string => {
  if (!path || path.length === 0) return "(root)";
  return path.reduce<string>((acc, segment) => {
    if (typeof segment === "number") return `${acc}[${segment}]`;
    return acc ? `${acc}.${String(segment)}` : String(segment);
  }, "");
};

/**
 * Describe why a tool's arguments were rejected, in one line per failing field.
 *
 * Deliberately does NOT include the rejected value. The SDK's own message
 * embeds the entire value plus the serialized `ZodError`, which is how a
 * single over-long field became several thousand characters of unreadable
 * output for the user and the model alike (issue #406).
 */
const formatIssues = (issues: ZodLikeIssue[]): string => {
  const shown = issues
    .slice(0, MAX_ISSUES)
    .map(
      (issue) =>
        `${formatPath(issue.path)}: ${truncate(
          (issue.message ?? "invalid").replace(/\s+/g, " ").trim(),
          MAX_ISSUE_LENGTH,
        )}`,
    );
  const omitted = issues.length - shown.length;
  return shown.join("; ") + (omitted > 0 ? ` (+${omitted} more)` : "");
};

const describeValidationFailure = (error: InvalidToolInputError): string => {
  const issues = findIssues(error.cause);
  if (issues) return formatIssues(issues);
  // No structured issues to unpack — fall back to the cause's own text,
  // capped, which is still better than the full SDK message.
  const cause = error.cause;
  const message =
    cause instanceof Error ? cause.message : stringify(cause ?? "unknown");
  return truncate(message.replace(/\s+/g, " ").trim(), MAX_ISSUE_LENGTH);
};

/**
 * The same failure, arriving as a string instead of an `Error`.
 *
 * The streaming path never hands us the instance: an invalid tool call becomes
 * a `tool-error` stream part whose `error` is `getErrorMessage(cause)` — which
 * is `error.toString()` — and that string is what reaches `onError`. So the
 * `isInstance` branches below cannot fire for the case this issue is about, and
 * without this the real production failure lands in the generic fallback.
 *
 * Matching on the SDK's message format is unavoidably coupled to that format.
 * It degrades safely: an unrecognised shape falls through to returning the
 * string unchanged, which is still better than discarding it.
 */
const TOOL_INPUT_MESSAGE =
  /^(?:AI_)?InvalidToolInputError: Invalid input for tool (\S+?):\s*([\s\S]*)$/;
/** The SDK appends the serialized ZodError after this marker. */
const ISSUES_MARKER = "Error message:";

const describeStringifiedToolInputError = (
  text: string,
): string | undefined => {
  const match = TOOL_INPUT_MESSAGE.exec(text);
  if (!match) return undefined;
  const [, toolName, detail] = match;

  const markerAt = detail.lastIndexOf(ISSUES_MARKER);
  if (markerAt !== -1) {
    try {
      const parsed: unknown = JSON.parse(
        detail.slice(markerAt + ISSUES_MARKER.length).trim(),
      );
      if (Array.isArray(parsed) && parsed.length > 0) {
        return `Invalid input for tool "${toolName}": ${formatIssues(parsed as ZodLikeIssue[])}`;
      }
    } catch {
      // Fall through to the capped detail below.
    }
  }
  // Strip the echoed value, which is the bulk of the SDK's message.
  const withoutValue = detail.split(/Value:/)[0] || detail;
  return `Invalid input for tool "${toolName}": ${truncate(
    withoutValue.replace(/\s+/g, " ").trim(),
    MAX_ISSUE_LENGTH,
  )}`;
};

/**
 * Converts AI SDK errors into user-facing strings for the UI message stream.
 *
 * The text produced here reaches both the user and, on a failed step, the
 * model — so it has to be short enough to read and specific enough to act on.
 */
export const formatStreamError = (error: unknown): string => {
  logger.error({ error }, "Chat stream error");

  if (LoadAPIKeyError.isInstance(error)) {
    return "AI provider API key is missing or not configured.";
  }
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      return "AI provider authentication failed. Your API key may be invalid or expired.";
    }
    if (error.statusCode === 429) {
      return "AI provider rate limit exceeded. Please try again later.";
    }
    if (error.statusCode != null && error.statusCode >= 500) {
      return "AI provider is currently unavailable. Please try again later.";
    }
    return `AI provider error: ${error.message}`;
  }
  // Checked before the generic `Error` branch: both of these ARE Errors, so
  // without this they fall through to `error.message` — which for an invalid
  // tool input is the unreadable wall of validator output.
  if (InvalidToolInputError.isInstance(error)) {
    return `Invalid input for tool "${error.toolName}": ${describeValidationFailure(error)}`;
  }
  if (NoSuchToolError.isInstance(error)) {
    return `The tool "${error.toolName}" does not exist and cannot be called.`;
  }
  // The streaming path stringifies tool-call failures before they reach here,
  // so the same two cases have to be recognised again in text form.
  if (typeof error === "string") {
    const asToolInput = describeStringifiedToolInputError(error);
    if (asToolInput) return asToolInput;
    const noSuchTool = /^(?:AI_)?NoSuchToolError:\s*([\s\S]*)$/.exec(error);
    if (noSuchTool) {
      return truncate(
        noSuchTool[1].replace(/\s+/g, " ").trim(),
        MAX_ISSUE_LENGTH,
      );
    }
    // Any other string is returned as-is: it used to be discarded entirely in
    // favour of the generic fallback, which is how the reported failure lost
    // the one sentence that named its cause.
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  // The reported failure landed here and the runtime type was never captured,
  // which is why nobody could tell what had actually been thrown.
  return `An unexpected error occurred (received ${describeNonError(error)}).`;
};

/**
 * Render an unknown value as text without ever producing "[object Object]",
 * which is the failure mode this whole branch exists to avoid.
 */
const stringify = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    typeof value === "symbol"
  ) {
    return value.toString();
  }
  if (typeof value === "function")
    return `function ${value.name || "anonymous"}`;
  try {
    return (
      JSON.stringify(value) ?? String(value === null ? "null" : "undefined")
    );
  } catch {
    return "[unserializable]";
  }
};

/** Identify a non-`Error` throw well enough to recognise it in a bug report. */
const describeNonError = (value: unknown): string => {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "object") {
    const name = value.constructor?.name ?? "object";
    return truncate(`${name} ${stringify(value)}`, MAX_ISSUE_LENGTH);
  }
  return truncate(`${typeof value} ${stringify(value)}`, MAX_ISSUE_LENGTH);
};
