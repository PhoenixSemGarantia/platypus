import { describe, expect, it } from "vitest";
import {
  type Actor,
  canAccessOrganization,
  canAccessWorkspace,
  canConfigureSandbox,
  canConfigureWorkspaceResource,
  canCreateWorkspace,
  canListOrgMembers,
  canManageOrgSharedResource,
  canManageSharedResource,
  canManageWorkspaceDelegation,
  canSendChatMessages,
  isOperator,
  resolveActor,
} from "./authorization";

const ACTORS: Actor[] = [
  "operator",
  "org-admin",
  "workspace-owner",
  "org-member",
];

describe("resolveActor", () => {
  it("names the Operator regardless of any other signal", () => {
    expect(
      resolveActor({
        isOperator: true,
        orgRole: "member",
        ownsWorkspace: false,
      }),
    ).toBe("operator");
  });

  it("names the Org Admin when not the Operator", () => {
    expect(
      resolveActor({
        isOperator: false,
        orgRole: "admin",
        ownsWorkspace: false,
      }),
    ).toBe("org-admin");
  });

  it("names the Workspace Owner when neither Operator nor Org Admin", () => {
    expect(
      resolveActor({
        isOperator: false,
        orgRole: "member",
        ownsWorkspace: true,
      }),
    ).toBe("workspace-owner");
  });

  it("falls back to a plain Org member", () => {
    expect(
      resolveActor({
        isOperator: false,
        orgRole: "member",
        ownsWorkspace: false,
      }),
    ).toBe("org-member");
  });

  it("falls back to a plain Org member outside any Organization", () => {
    expect(
      resolveActor({
        isOperator: false,
        orgRole: null,
        ownsWorkspace: false,
      }),
    ).toBe("org-member");
  });
});

describe("canManageSharedResource — attach/detach/Promote (ADR-0007)", () => {
  it.each(ACTORS)("%s outside a Workspace is refused", (actor) => {
    expect(canManageSharedResource(actor, undefined)).toEqual({
      allowed: false,
      reason: "no-workspace-context",
    });
  });

  it("Operator inside a Workspace is allowed", () => {
    expect(canManageSharedResource("operator", "ws-1")).toEqual({
      allowed: true,
    });
  });

  it("Org Admin inside a Workspace is allowed", () => {
    expect(canManageSharedResource("org-admin", "ws-1")).toEqual({
      allowed: true,
    });
  });

  it("Workspace Owner inside their own Workspace is refused", () => {
    expect(canManageSharedResource("workspace-owner", "ws-1")).toEqual({
      allowed: false,
      reason: "not-org-admin",
    });
  });

  it("a plain Org member inside a Workspace is refused", () => {
    expect(canManageSharedResource("org-member", "ws-1")).toEqual({
      allowed: false,
      reason: "not-org-admin",
    });
  });
});

describe("canConfigureWorkspaceResource — credential delegation (ADR-0006)", () => {
  for (const type of ["provider", "mcp"] as const) {
    it(`Operator always may configure a ${type}`, () => {
      expect(canConfigureWorkspaceResource("operator", type, false)).toEqual({
        allowed: true,
      });
    });

    it(`Org Admin always may configure a ${type}`, () => {
      expect(canConfigureWorkspaceResource("org-admin", type, false)).toEqual({
        allowed: true,
      });
    });

    it(`Workspace Owner may configure a delegated ${type}`, () => {
      expect(
        canConfigureWorkspaceResource("workspace-owner", type, true),
      ).toEqual({ allowed: true });
    });

    it(`Workspace Owner may not configure a non-delegated ${type}`, () => {
      expect(
        canConfigureWorkspaceResource("workspace-owner", type, false),
      ).toEqual({ allowed: false, reason: "not-delegated" });
    });

    it(`a plain Org member may never configure a ${type}`, () => {
      expect(canConfigureWorkspaceResource("org-member", type, true)).toEqual({
        allowed: false,
        reason: "not-owner",
      });
    });
  }

  it("a Sandbox is never delegatable, even to its Workspace Owner", () => {
    expect(
      canConfigureWorkspaceResource("workspace-owner", "sandbox", true),
    ).toEqual({ allowed: false, reason: "not-delegatable" });
  });

  it("Operator and Org Admin still configure a Sandbox", () => {
    expect(canConfigureWorkspaceResource("operator", "sandbox", false)).toEqual(
      { allowed: true },
    );
    expect(
      canConfigureWorkspaceResource("org-admin", "sandbox", false),
    ).toEqual({ allowed: true });
  });
});

describe.each([
  ["canManageOrgSharedResource", canManageOrgSharedResource],
  ["canConfigureSandbox", canConfigureSandbox],
  ["canListOrgMembers", canListOrgMembers],
  ["canCreateWorkspace", canCreateWorkspace],
  ["canManageWorkspaceDelegation", canManageWorkspaceDelegation],
] as const)("%s — Org-Admin-tier, no Workspace requirement", (_name, fn) => {
  it("the Operator is allowed", () => {
    expect(fn("operator")).toEqual({ allowed: true });
  });

  it("the Org Admin is allowed", () => {
    expect(fn("org-admin")).toEqual({ allowed: true });
  });

  it("the Workspace Owner is refused", () => {
    expect(fn("workspace-owner")).toEqual({
      allowed: false,
      reason: "not-org-admin",
    });
  });

  it("a plain Org member is refused", () => {
    expect(fn("org-member")).toEqual({
      allowed: false,
      reason: "not-org-admin",
    });
  });
});

describe("canSendChatMessages", () => {
  it("the literal Workspace owner is allowed", () => {
    expect(canSendChatMessages(true)).toEqual({ allowed: true });
  });

  it("a non-owner is refused, regardless of admin tier", () => {
    expect(canSendChatMessages(false)).toEqual({
      allowed: false,
      reason: "not-owner",
    });
  });
});

describe("canAccessOrganization", () => {
  it("the Operator reaches an Organization with no membership at all", () => {
    expect(canAccessOrganization("operator", null)).toEqual({
      allowed: true,
    });
    expect(canAccessOrganization("operator", null, "admin")).toEqual({
      allowed: true,
    });
  });

  it("a non-member is refused", () => {
    expect(canAccessOrganization("org-admin", null)).toEqual({
      allowed: false,
      reason: "not-a-member",
    });
  });

  it("a member meets the default 'member' requirement", () => {
    expect(canAccessOrganization("org-member", "member")).toEqual({
      allowed: true,
    });
  });

  it("a member is refused an admin-only Organization surface", () => {
    expect(canAccessOrganization("org-member", "member", "admin")).toEqual({
      allowed: false,
      reason: "insufficient-role",
    });
  });

  it("an admin meets an admin-only requirement", () => {
    expect(canAccessOrganization("org-admin", "admin", "admin")).toEqual({
      allowed: true,
    });
  });
});

describe("canAccessWorkspace", () => {
  it("the Operator reaches every Workspace", () => {
    expect(canAccessWorkspace("operator")).toBe(true);
  });

  it("the Org Admin reaches every Workspace", () => {
    expect(canAccessWorkspace("org-admin")).toBe(true);
  });

  it("the Workspace Owner reaches their own Workspace", () => {
    expect(canAccessWorkspace("workspace-owner")).toBe(true);
  });

  it("a plain Org member reaches no Workspace", () => {
    expect(canAccessWorkspace("org-member")).toBe(false);
  });
});

describe("isOperator", () => {
  it.each(ACTORS)("names the Operator case for %s", (actor) => {
    expect(isOperator(actor)).toBe(actor === "operator");
  });
});
