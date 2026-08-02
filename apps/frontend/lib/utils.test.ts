import { describe, it, expect } from "vitest";
import { clearFieldError, joinUrl, parseValidationErrors } from "./utils";

describe("joinUrl", () => {
  it("should join base URL and path", () => {
    expect(joinUrl("http://localhost:4000", "/api/test")).toBe(
      "http://localhost:4000/api/test",
    );
  });

  it("should handle base URL with trailing slash", () => {
    expect(joinUrl("http://localhost:4000/", "/api/test")).toBe(
      "http://localhost:4000/api/test",
    );
  });

  it("should handle path without leading slash", () => {
    expect(joinUrl("http://localhost:4000", "api/test")).toBe(
      "http://localhost:4000/api/test",
    );
  });

  it("should return path when base is empty", () => {
    expect(joinUrl("", "/api/test")).toBe("/api/test");
  });
});

describe("parseValidationErrors", () => {
  it("should parse validation errors correctly", () => {
    const errorData = {
      error: [
        { path: ["name"], message: "Name is required" },
        { path: ["email"], message: "Invalid email" },
      ],
    };
    const result = parseValidationErrors(errorData);
    expect(result).toEqual({
      name: "Name is required",
      email: "Invalid email",
    });
  });

  it("should return empty object for invalid input", () => {
    expect(parseValidationErrors(null)).toEqual({});
    expect(parseValidationErrors({})).toEqual({});
    expect(parseValidationErrors({ error: "string" })).toEqual({});
  });

  // A rule over a list reports the row it failed on. Keyed on the first path
  // segment alone, every row's message landed on the same key and all but one
  // was lost — two bad rows meant one message and one fix per round-trip.
  it("keys an error inside a list on its full path", () => {
    const result = parseValidationErrors({
      error: [
        { path: ["modelIds", 1, "alias"], message: "Alias 'dup' duplicates" },
        { path: ["modelIds", 2, "alias"], message: "Alias 'DUP' duplicates" },
      ],
    });

    expect(result["modelIds.1.alias"]).toBe("Alias 'dup' duplicates");
    expect(result["modelIds.2.alias"]).toBe("Alias 'DUP' duplicates");
  });

  // Not every form knows about paths. Each issue also reports under its
  // top-level field so a form that only reads flat names still shows something
  // rather than failing silently.
  it("also reports a nested error under its top-level field", () => {
    const result = parseValidationErrors({
      error: [{ path: ["modelIds", 1, "alias"], message: "Alias duplicates" }],
    });

    expect(result.modelIds).toBe("Alias duplicates");
  });

  // An error against the list itself is the better message for the list's own
  // slot, whichever order the two arrive in.
  it("prefers an error on the field itself over one derived from a row", () => {
    const rowFirst = parseValidationErrors({
      error: [
        { path: ["modelIds", 0, "alias"], message: "Row message" },
        { path: ["modelIds"], message: "Field message" },
      ],
    });

    expect(rowFirst.modelIds).toBe("Field message");
    expect(rowFirst["modelIds.0.alias"]).toBe("Row message");
  });

  it("keeps the first message when one field has several", () => {
    const result = parseValidationErrors({
      error: [
        { path: ["name"], message: "Too short" },
        { path: ["name"], message: "Also invalid" },
      ],
    });

    expect(result.name).toBe("Too short");
  });
});

describe("clearFieldError", () => {
  it("drops the field's own error", () => {
    expect(
      clearFieldError({ name: "Required", apiKey: "Bad" }, "name"),
    ).toEqual({ apiKey: "Bad" });
  });

  // The edit that fixes a row is an edit to the field the row lives in, so the
  // rows' errors have to go with it. A form gating Submit on the error map
  // stays stuck forever otherwise.
  it("drops errors nested under the field", () => {
    const errors = {
      "modelIds.1.alias": "Duplicate",
      "modelIds.2.alias": "Duplicate",
      modelIds: "Duplicate",
      name: "Required",
    };

    expect(clearFieldError(errors, "modelIds")).toEqual({ name: "Required" });
  });

  it("leaves a field whose name merely prefixes the edited one", () => {
    const errors = { modelIdsExtra: "Bad" };

    expect(clearFieldError(errors, "modelIds")).toEqual(errors);
  });

  it("returns the same object when nothing matches, so state does not churn", () => {
    const errors = { name: "Required" };

    expect(clearFieldError(errors, "apiKey")).toBe(errors);
  });
});
