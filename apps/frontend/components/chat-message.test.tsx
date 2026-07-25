import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Agent } from "@platypus/schemas";
import type { PlatypusUIMessage } from "@platypus/backend/src/types";

// Streamdown pulls in shiki and a worker-ish runtime that jsdom can't host;
// the assertions here only care about the avatar rendered beside the message.
vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

import { ChatMessage } from "./chat-message";

const agents: Agent[] = [
  {
    id: "agent-1",
    name: "Research Agent",
    avatarUrl: "https://example.com/agent-1.png",
  } as unknown as Agent,
];

const assistantMessage = (
  metadata?: PlatypusUIMessage["metadata"],
): PlatypusUIMessage => ({
  id: "m1",
  role: "assistant",
  metadata,
  parts: [{ type: "text", text: "Hello" }],
});

function renderMessage(message: PlatypusUIMessage) {
  return render(
    <ChatMessage
      message={message}
      isLastMessage
      status="ready"
      isEditing={false}
      editContent=""
      editTextareaRef={{ current: null }}
      agents={agents}
      setEditContent={vi.fn()}
      onEditStart={vi.fn()}
      onEditCancel={vi.fn()}
      onEditSubmit={vi.fn()}
      onMessageDelete={vi.fn()}
      onRegenerate={vi.fn()}
      onCopyMessage={vi.fn()}
      copiedMessageId={null}
    />,
  );
}

describe("ChatMessage agent attribution", () => {
  it("renders the agent avatar when the message is attributed to an agent", () => {
    renderMessage(assistantMessage({ agentId: "agent-1" }));

    const avatar = screen.getByAltText("Research Agent");
    expect(avatar).toHaveAttribute("src", "https://example.com/agent-1.png");
  });

  it("falls back to the generic bot avatar for a run with no attribution", () => {
    const { container } = renderMessage(assistantMessage());

    expect(screen.queryByAltText("Research Agent")).toBeNull();
    expect(container.querySelector("svg.lucide-bot")).not.toBeNull();
  });

  it("falls back to the generic bot avatar when the agent is unknown", () => {
    const { container } = renderMessage(assistantMessage({ agentId: "gone" }));

    expect(screen.queryByAltText("Research Agent")).toBeNull();
    expect(container.querySelector("svg.lucide-bot")).not.toBeNull();
  });
});
