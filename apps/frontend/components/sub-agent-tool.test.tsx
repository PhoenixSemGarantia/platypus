import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ToolUIPart } from "ai";

// Streamdown pulls in shiki and a worker-ish runtime that jsdom can't host; the
// assertions here only care about the card's header.
vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

import { SubAgentTool } from "./sub-agent-tool";

const delegateCall = (toolMetadata?: Record<string, unknown>): ToolUIPart =>
  ({
    type: "tool-delegateToResearchBot",
    toolCallId: "call-1",
    state: "output-available",
    input: { task: "Find the release date" },
    output: { entries: [], text: "It shipped in March." },
    toolMetadata,
  }) as unknown as ToolUIPart;

// A delegated run is the longest thing that happens in a chat, so its card is
// the one where the duration matters most.
describe("SubAgentTool duration", () => {
  it("renders the recorded duration in the header", () => {
    render(<SubAgentTool toolPart={delegateCall({ durationMs: 42_000 })} />);

    expect(screen.getByText(/42\.0s/)).toBeInTheDocument();
  });

  it("renders no duration for a delegation recorded before timing existed", () => {
    render(<SubAgentTool toolPart={delegateCall()} />);

    expect(screen.getByText("Research Bot")).toBeInTheDocument();
    expect(screen.queryByText(/\d+(\.\d+)?(ms|s)/)).toBeNull();
  });
});
