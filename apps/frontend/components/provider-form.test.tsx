import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

/** A server rejection carrying standardschema issues, as the API returns them. */
function mockRejectedSave(issues: Array<{ path: unknown[]; message: string }>) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status: 400,
    json: async () => ({ error: issues }),
  } as unknown as Response);
}

const save = () =>
  fireEvent.click(screen.getByRole("button", { name: "Update" }));

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

describe("ProviderForm validation errors on model rows", () => {
  afterEach(() => {
    loadedProvider = undefined;
    vi.restoreAllMocks();
  });

  const threeModels = () => [
    { id: "a", passthroughFileTypes: [] },
    { id: "b", alias: "dup", passthroughFileTypes: [] },
    { id: "c", alias: "DUP", passthroughFileTypes: [] },
  ];

  // Keyed on the first path segment, both messages landed on the Models field
  // and the second overwrote the first: one message, one fix per round-trip,
  // and no indication of which row was wrong.
  it("shows every rejected row its own message, against the field that failed", async () => {
    vi.stubGlobal(
      "fetch",
      mockRejectedSave([
        { path: ["modelIds", 1, "alias"], message: "Alias 'dup' duplicates" },
        { path: ["modelIds", 2, "alias"], message: "Alias 'DUP' duplicates" },
      ]),
    );

    renderEditForm(threeModels());
    save();

    await waitFor(() =>
      expect(screen.getByText("Alias 'dup' duplicates")).toBeInTheDocument(),
    );
    expect(screen.getByText("Alias 'DUP' duplicates")).toBeInTheDocument();

    // The message lands on the row that failed, not on its neighbours.
    const aliases = screen.getAllByLabelText("Alias");
    expect(aliases[0]).not.toHaveAttribute("aria-invalid", "true");
    expect(aliases[1]).toHaveAttribute("aria-invalid", "true");
    expect(aliases[2]).toHaveAttribute("aria-invalid", "true");
  });

  it("does not repeat a row's message against the Models field", async () => {
    vi.stubGlobal(
      "fetch",
      mockRejectedSave([
        { path: ["modelIds", 1, "alias"], message: "Alias 'dup' duplicates" },
      ]),
    );

    renderEditForm(threeModels());
    save();

    await waitFor(() =>
      expect(screen.getAllByText("Alias 'dup' duplicates")).toHaveLength(1),
    );
  });

  it("still shows an error reported against the list itself", async () => {
    vi.stubGlobal(
      "fetch",
      mockRejectedSave([
        { path: ["modelIds"], message: "At least one model is required" },
      ]),
    );

    renderEditForm([]);
    save();

    await waitFor(() =>
      expect(
        screen.getByText("At least one model is required"),
      ).toBeInTheDocument(),
    );
  });

  // The button used to be disabled while any error was outstanding, and errors
  // were only retracted by field-specific handlers. An error key with no
  // matching handler disabled Save with no way back but a reload.
  it("leaves Save usable after a rejection, so the retry is one click", async () => {
    vi.stubGlobal(
      "fetch",
      mockRejectedSave([
        { path: ["modelIds", 1, "alias"], message: "Alias 'dup' duplicates" },
      ]),
    );

    renderEditForm(threeModels());
    save();

    await waitFor(() =>
      expect(screen.getByText("Alias 'dup' duplicates")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Update" })).toBeEnabled();
  });

  it("retracts the row errors once the list is edited", async () => {
    vi.stubGlobal(
      "fetch",
      mockRejectedSave([
        { path: ["modelIds", 1, "alias"], message: "Alias 'dup' duplicates" },
        { path: ["modelIds", 2, "alias"], message: "Alias 'DUP' duplicates" },
      ]),
    );

    renderEditForm(threeModels());
    save();

    await waitFor(() =>
      expect(screen.getByText("Alias 'dup' duplicates")).toBeInTheDocument(),
    );

    fireEvent.change(screen.getAllByLabelText("Alias")[1], {
      target: { value: "unique" },
    });

    expect(screen.queryByText("Alias 'dup' duplicates")).toBeNull();
    expect(screen.queryByText("Alias 'DUP' duplicates")).toBeNull();
  });

  it("opens a collapsed row when the server rejects a field inside it", async () => {
    vi.stubGlobal(
      "fetch",
      mockRejectedSave([
        {
          path: ["modelIds", 0, "maxExtractedTextChars"],
          message: "Too small",
        },
      ]),
    );

    renderEditForm([{ id: "a", passthroughFileTypes: [] }]);
    expect(screen.queryByLabelText("Max extracted text characters")).toBeNull();

    save();

    await waitFor(() =>
      expect(
        screen.getByLabelText("Max extracted text characters"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Too small")).toBeInTheDocument();
  });
});
