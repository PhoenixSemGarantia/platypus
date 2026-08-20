import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDb, mockSession, resetMockDb } from "../test-utils.ts";
import app from "../server.ts";

describe("Organization Provider Routes", () => {
  beforeEach(() => {
    resetMockDb();
    vi.clearAllMocks();
    mockDb.where.mockReturnValue(mockDb);
  });

  const orgId = "org-1";
  const baseUrl = `/organizations/${orgId}/providers`;

  describe("POST /", () => {
    it("should create org provider if org admin", async () => {
      mockSession();
      mockDb.limit.mockResolvedValueOnce([{ role: "admin" }]); // requireOrgAccess

      const mockProvider = {
        id: "p1",
        name: "Org OpenAI",
        providerType: "OpenAI",
        organizationId: orgId,
      };
      mockDb.returning.mockResolvedValueOnce([mockProvider]);

      const res = await app.request(baseUrl, {
        method: "POST",
        body: JSON.stringify({
          name: "Org OpenAI",
          providerType: "OpenAI",
          apiKey: "sk-123",
          modelIds: ["gpt-4"],
          taskModelId: "gpt-4",
          memoryExtractionModelId: "gpt-4",
          organizationId: orgId,
        }),
        headers: { "Content-Type": "application/json" },
      });

      expect(res.status).toBe(201);
      expect(await res.json()).toEqual(mockProvider);
    });

    it("should fail if not org admin", async () => {
      mockSession();
      mockDb.limit.mockResolvedValueOnce([{ role: "member" }]); // requireOrgAccess

      const res = await app.request(baseUrl, {
        method: "POST",
        body: JSON.stringify({
          name: "Org OpenAI",
          providerType: "OpenAI",
          apiKey: "sk-123",
          modelIds: ["gpt-4"],
          taskModelId: "gpt-4",
          memoryExtractionModelId: "gpt-4",
          organizationId: orgId,
        }),
        headers: { "Content-Type": "application/json" },
      });

      expect(res.status).toBe(403);
    });

    it("should return 409 if provider name already exists in org", async () => {
      mockSession();
      mockDb.limit.mockResolvedValueOnce([{ role: "admin" }]); // requireOrgAccess

      const drizzleError = Object.assign(
        new Error("DrizzleQueryError: Failed query"),
        {
          cause: {
            code: "23505",
            message:
              'duplicate key value violates unique constraint "unique_provider_name_org"',
          },
        },
      );

      mockDb.returning.mockRejectedValueOnce(drizzleError);

      const res = await app.request(baseUrl, {
        method: "POST",
        body: JSON.stringify({
          name: "Org OpenAI",
          providerType: "OpenAI",
          apiKey: "sk-123",
          modelIds: ["gpt-4"],
          taskModelId: "gpt-4",
          memoryExtractionModelId: "gpt-4",
          organizationId: orgId,
        }),
        headers: { "Content-Type": "application/json" },
      });

      // The unique violation flows through the central onError (ADR-0010).
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: "A resource with that name already exists",
      });
    });
  });

  describe("GET /", () => {
    it("should list org providers", async () => {
      mockSession();
      mockDb.limit.mockResolvedValueOnce([{ role: "member" }]); // requireOrgAccess

      const mockProviders = [{ id: "p1", name: "Org OpenAI" }];
      mockDb.where
        .mockReturnValueOnce(mockDb) // requireOrgAccess
        .mockResolvedValueOnce(mockProviders);

      const res = await app.request(baseUrl);
      expect(res.status).toBe(200);
      // A plain member may list Shared Providers — it is how one is selected —
      // but credentials are Org-Admin-only (ADR-0006), so the row comes back
      // with the secret fields replaced by presence flags.
      expect(await res.json()).toEqual({
        results: [
          {
            id: "p1",
            name: "Org OpenAI",
            apiKeySet: { configured: false },
            headersSet: { configured: false },
          },
        ],
      });
    });

    it("redacts apiKey for a non-admin member", async () => {
      mockSession();
      mockDb.limit.mockResolvedValueOnce([{ role: "member" }]); // requireOrgAccess

      mockDb.where
        .mockReturnValueOnce(mockDb)
        .mockResolvedValueOnce([
          { id: "p1", name: "Org OpenAI", apiKey: "sk-secret" },
        ]);

      const res = await app.request(baseUrl);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).not.toContain("sk-secret");
    });

    it("reveals apiKey to an org admin", async () => {
      mockSession();
      mockDb.limit.mockResolvedValueOnce([{ role: "admin" }]); // requireOrgAccess

      mockDb.where
        .mockReturnValueOnce(mockDb)
        .mockResolvedValueOnce([
          { id: "p1", name: "Org OpenAI", apiKey: "sk-secret" },
        ]);

      const res = await app.request(baseUrl);
      expect(res.status).toBe(200);
      const data = (await res.json()) as { results: Record<string, unknown>[] };
      expect(data.results[0].apiKey).toBe("sk-secret");
    });
  });

  describe("GET /:providerId", () => {
    it("should return org provider", async () => {
      mockSession();
      mockDb.limit.mockResolvedValueOnce([{ role: "member" }]); // requireOrgAccess

      const mockProvider = { id: "p1", name: "Org OpenAI" };
      mockDb.where
        .mockReturnValueOnce(mockDb) // requireOrgAccess
        .mockReturnValueOnce(mockDb); // route
      mockDb.limit.mockResolvedValueOnce([mockProvider]); // route

      const res = await app.request(`${baseUrl}/p1`);
      expect(res.status).toBe(200);
      // Credentials are Org-Admin-only (ADR-0006); see the list route.
      expect(await res.json()).toEqual({
        ...mockProvider,
        apiKeySet: { configured: false },
        headersSet: { configured: false },
      });
    });
  });

  describe("PUT /:providerId", () => {
    const updateBody = {
      name: "Renamed",
      providerType: "OpenAI",
      apiKey: "sk-123",
      modelIds: ["gpt-4"],
      taskModelId: "gpt-4",
      memoryExtractionModelId: "gpt-4",
    };

    it("updates an org provider and returns the row", async () => {
      mockSession();
      mockDb.limit.mockResolvedValueOnce([{ role: "admin" }]); // requireOrgAccess
      // requireOrgScoped: the Provider is a Shared resource of this org
      mockDb.limit.mockResolvedValueOnce([{ id: "p1", organizationId: orgId }]);
      // currentProviderModels → the pre-save models, for the alias diff
      mockDb.limit.mockResolvedValueOnce([{ modelIds: [{ id: "gpt-4" }] }]);

      const updated = { id: "p1", name: "Renamed", organizationId: orgId };
      mockDb.returning.mockResolvedValueOnce([updated]);

      const res = await app.request(`${baseUrl}/p1`, {
        method: "PUT",
        body: JSON.stringify(updateBody),
        headers: { "Content-Type": "application/json" },
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ...updated, aliasRepoints: [] });
    });

    // #605: the org surface used to skip this check entirely, discovering a
    // missing Provider only when the UPDATE matched no row.
    it("returns 404 for a provider that is not a Shared resource of this org, without touching the write", async () => {
      mockSession();
      mockDb.limit.mockResolvedValueOnce([{ role: "admin" }]); // requireOrgAccess
      mockDb.limit.mockResolvedValueOnce([]); // requireOrgScoped: not found

      const res = await app.request(`${baseUrl}/missing`, {
        method: "PUT",
        body: JSON.stringify(updateBody),
        headers: { "Content-Type": "application/json" },
      });

      expect(res.status).toBe(404);
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it("returns 403 for a non-admin", async () => {
      mockSession();
      mockDb.limit.mockResolvedValueOnce([{ role: "member" }]); // requireOrgAccess

      const res = await app.request(`${baseUrl}/p1`, {
        method: "PUT",
        body: JSON.stringify(updateBody),
        headers: { "Content-Type": "application/json" },
      });

      expect(res.status).toBe(403);
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /:providerId", () => {
    it("deletes an org provider if admin and not attached", async () => {
      mockSession();
      mockDb.limit
        .mockResolvedValueOnce([{ role: "admin" }]) // requireOrgAccess
        .mockResolvedValueOnce([]) // attachment guard: none
        .mockResolvedValueOnce([]); // blueprint guard: none
      mockDb.returning.mockResolvedValueOnce([{ id: "p1" }]);

      const res = await app.request(`${baseUrl}/p1`, { method: "DELETE" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ message: "Provider deleted" });
    });

    it("invalidates memory embeddings before deleting, without de-migrating aliases", async () => {
      // The delete path used to run neither helper (#605): a Provider's
      // models — and any alias among them — vanish along with the row, so
      // there is no surviving concrete id for de-migration to rewrite to, but
      // stale embedding vectors computed against it must still be cleared.
      mockSession();
      mockDb.limit
        .mockResolvedValueOnce([{ role: "admin" }]) // requireOrgAccess
        .mockResolvedValueOnce([]) // attachment guard: none
        .mockResolvedValueOnce([]); // blueprint guard: none
      mockDb.execute.mockResolvedValueOnce({ rowCount: 0 }); // nullifyEmbeddingsForProvider
      mockDb.returning.mockResolvedValueOnce([{ id: "p1" }]);

      const res = await app.request(`${baseUrl}/p1`, { method: "DELETE" });

      expect(res.status).toBe(200);
      expect(mockDb.execute).toHaveBeenCalledTimes(1);
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it("returns 409 when the provider is attached to a workspace", async () => {
      mockSession();
      mockDb.limit
        .mockResolvedValueOnce([{ role: "admin" }]) // requireOrgAccess
        .mockResolvedValueOnce([{ id: "att-1" }]); // attachment guard: attached

      const res = await app.request(`${baseUrl}/p1`, { method: "DELETE" });
      expect(res.status).toBe(409);
    });

    it("returns 409 when the provider is listed in a blueprint", async () => {
      mockSession();
      mockDb.limit
        .mockResolvedValueOnce([{ role: "admin" }]) // requireOrgAccess
        .mockResolvedValueOnce([]) // attachment guard: none
        .mockResolvedValueOnce([{ id: "bpi-1" }]); // blueprint guard: listed

      const res = await app.request(`${baseUrl}/p1`, { method: "DELETE" });
      expect(res.status).toBe(409);
    });

    it("returns 403 for a non-admin", async () => {
      mockSession();
      mockDb.limit.mockResolvedValueOnce([{ role: "member" }]); // requireOrgAccess

      const res = await app.request(`${baseUrl}/p1`, { method: "DELETE" });
      expect(res.status).toBe(403);
    });
  });
});
