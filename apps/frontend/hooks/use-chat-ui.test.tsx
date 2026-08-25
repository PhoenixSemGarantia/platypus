import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ChatErrorTreatment } from "@/lib/chat-recovery";
import { useChatUI } from "./use-chat-ui";

describe("useChatUI error dialog", () => {
  const withError = (error: Error | undefined, treatment: ChatErrorTreatment) =>
    renderHook(
      (props: { error: Error | undefined; treatment: ChatErrorTreatment }) =>
        useChatUI(props.error, props.treatment),
      { initialProps: { error, treatment } },
    );

  it("stays closed while nothing has gone wrong", () => {
    expect(withError(undefined, "none").result.current.showErrorDialog).toBe(
      false,
    );
  });

  it("opens on a run that failed", () => {
    const { result } = withError(new Error("boom"), "failure");
    expect(result.current.showErrorDialog).toBe(true);
  });

  // The reported symptom: backgrounding the tab tore down the stream and the
  // user was shown a modal saying the turn had failed, while the run was
  // healthy and went on to finish.
  it("stays closed for a dropped connection to a live run", () => {
    const { result } = withError(new Error("Failed to fetch"), "recovering");
    expect(result.current.showErrorDialog).toBe(false);
  });

  it("stays closed for a stream that ended after its run finished", () => {
    const { result } = withError(new Error("Failed to fetch"), "none");
    expect(result.current.showErrorDialog).toBe(false);
  });

  // The dialog is keyed on the error so it can be dismissed while the error
  // persists; a later error still reopens it.
  it("reopens for a second, different failure", () => {
    const { result, rerender } = withError(new Error("first"), "failure");
    result.current.setShowErrorDialog(false);
    rerender({ error: new Error("second"), treatment: "failure" });

    expect(result.current.showErrorDialog).toBe(true);
  });
});
