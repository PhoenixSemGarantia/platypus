import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ChatStatus } from "ai";
import { useTurnEstablished } from "./use-turn-established";

describe("useTurnEstablished", () => {
  const walk = (statuses: ChatStatus[]) => {
    const { result, rerender } = renderHook(
      ({ status }: { status: ChatStatus }) => useTurnEstablished(status),
      { initialProps: { status: statuses[0] } },
    );
    for (const status of statuses.slice(1)) rerender({ status });
    return result;
  };

  it("starts out with nothing established", () => {
    expect(walk(["ready"]).current).toBe(false);
  });

  // A request the server refused — a rejected attachment, a duplicate
  // submission answered 409, a network that was never there. Nothing streamed,
  // so there is no run to recover and the user has to be told.
  it("reads a turn that failed before streaming as never established", () => {
    expect(walk(["ready", "submitted", "error"]).current).toBe(false);
  });

  // The reported case: the stream was arriving and the browser tore the
  // connection down. The run behind it is healthy.
  it("reads a turn that streamed and then broke as established", () => {
    expect(walk(["ready", "submitted", "streaming", "error"]).current).toBe(
      true,
    );
  });

  it("is answered on the render the status changes, not the one after", () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: ChatStatus }) => useTurnEstablished(status),
      { initialProps: { status: "submitted" as ChatStatus } },
    );

    rerender({ status: "streaming" });
    expect(result.current).toBe(true);
  });

  // A second turn in the same Chat must be judged on its own stream, not the
  // previous turn's.
  it("forgets an earlier turn's stream when a new one is submitted", () => {
    expect(
      walk(["submitted", "streaming", "ready", "submitted", "error"]).current,
    ).toBe(false);
  });

  it("keeps the answer while a broken turn sits there", () => {
    expect(walk(["submitted", "streaming", "error", "error"]).current).toBe(
      true,
    );
  });
});
