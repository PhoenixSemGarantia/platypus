import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("@/app/client-context", () => ({
  useBackendUrl: () => "http://test",
}));

const authState: { user: { id: string } | null } = { user: { id: "u1" } };
vi.mock("@/components/auth-provider", () => ({
  useAuth: () => authState,
}));

let capturedKey: unknown;
let capturedFetcher: unknown;
vi.mock("swr", () => ({
  __esModule: true,
  default: (key: unknown, fn: unknown) => {
    capturedKey = key;
    capturedFetcher = fn;
    return { data: undefined, isLoading: false };
  },
}));

import { useScopedSWR } from "./use-scoped-swr";
import { fetcher, optionalFetcher } from "@/lib/utils";

describe("useScopedSWR", () => {
  afterEach(() => {
    authState.user = { id: "u1" };
  });

  it("resolves the workspace-scoped URL as the SWR key", () => {
    renderHook(() =>
      useScopedSWR("providers", { orgId: "org1", workspaceId: "ws1" }),
    );
    expect(capturedKey).toBe(
      "http://test/organizations/org1/workspaces/ws1/providers",
    );
  });

  it("resolves the org-scoped URL when no workspace is given", () => {
    renderHook(() => useScopedSWR("agents", { orgId: "org1" }));
    expect(capturedKey).toBe("http://test/organizations/org1/agents");
  });

  it("withholds the key — rather than passing a falsy string SWR might still treat as a cache key — when scope is null", () => {
    renderHook(() => useScopedSWR("providers", null));
    expect(capturedKey).toBeNull();
  });

  it("withholds the key when there is no signed-in user", () => {
    authState.user = null;
    renderHook(() =>
      useScopedSWR("providers", { orgId: "org1", workspaceId: "ws1" }),
    );
    expect(capturedKey).toBeNull();
  });

  it("reads through the shared fetcher by default", () => {
    renderHook(() => useScopedSWR("providers", { orgId: "org1" }));
    expect(capturedFetcher).toBe(fetcher);
  });

  // Issue #648: the Chat detail read needs 404-as-absence, and only that read.
  it("lets one read swap its reader without changing the default", () => {
    renderHook(() =>
      useScopedSWR("chat/c1", { orgId: "org1" }, { fetcher: optionalFetcher }),
    );
    expect(capturedFetcher).toBe(optionalFetcher);

    renderHook(() => useScopedSWR("agents", { orgId: "org1" }));
    expect(capturedFetcher).toBe(fetcher);
  });
});
