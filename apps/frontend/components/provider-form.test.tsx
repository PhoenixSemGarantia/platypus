import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Provider } from "@platypus/schemas";

// --- Module mocks ------------------------------------------------------------

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/app/client-context", () => ({
  useBackendUrl: () => "http://test",
}));

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ user: { id: "u1" } }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

// The provider the edit form loads. Set per test before rendering.
let loadedProvider: Provider | undefined;

vi.mock("swr", () => ({
  __esModule: true,
  default: () => ({
    data: loadedProvider,
    isLoading: false,
    mutate: vi.fn(),
  }),
}));

import { ProviderForm } from "./provider-form";

// --- Helpers -----------------------------------------------------------------

function renderEditForm(modelIds: Provider["modelIds"]) {
  loadedProvider = {
    id: "p1",
    name: "OpenAI",
    providerType: "OpenAI",
    apiKey: "sk-test",
    apiMode: "responses",
    modelIds,
    taskModelId: "gpt-4o",
    memoryExtractionModelId: "gpt-4o",
  } as unknown as Provider;
  return render(<ProviderForm orgId="org1" providerId="p1" />);
}

// --- Tests -------------------------------------------------------------------

describe("ProviderForm model rows", () => {
  afterEach(() => {
    loadedProvider = undefined;
    vi.restoreAllMocks();
  });

  it("labels the Model ID input rather than relying on its placeholder", () => {
    renderEditForm([{ id: "gpt-4o", passthroughFileTypes: [] }]);

    expect(screen.getByLabelText("Model ID")).toHaveValue("gpt-4o");
  });

  it("gives every model field an info control carrying its help text", () => {
    renderEditForm([{ id: "gpt-4o", passthroughFileTypes: ["image/*"] }]);

    for (const label of [
      "Model ID",
      "Alias",
      "Native file types",
      "Max extracted text characters",
    ]) {
      expect(
        screen.getByRole("button", { name: `About ${label}` }),
      ).toBeInTheDocument();
    }
  });

  it("hides the file-handling fields until the row is expanded", () => {
    renderEditForm([{ id: "gpt-4o", passthroughFileTypes: [] }]);

    expect(screen.queryByLabelText("Native file types")).toBeNull();
    expect(screen.queryByLabelText("Max extracted text characters")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));

    expect(screen.getByLabelText("Native file types")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Max extracted text characters"),
    ).toBeInTheDocument();
  });

  it("opens a row already carrying file-handling config, so nothing set is hidden", () => {
    renderEditForm([
      {
        id: "gpt-4o",
        passthroughFileTypes: ["image/*", "application/pdf"],
        maxExtractedTextChars: 1000,
      },
    ]);

    expect(screen.getByLabelText("Native file types")).toHaveValue(
      "image/*, application/pdf",
    );
    expect(screen.getByLabelText("Max extracted text characters")).toHaveValue(
      1000,
    );
  });

  it("expands only the row that has config, leaving its neighbours collapsed", () => {
    renderEditForm([
      { id: "gpt-4o", passthroughFileTypes: [] },
      { id: "gpt-4o-mini", passthroughFileTypes: ["image/*"] },
    ]);

    // One expanded row means one visible pair of file-handling inputs.
    expect(screen.getAllByLabelText("Native file types")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Advanced" })).toHaveLength(2);
  });
});
