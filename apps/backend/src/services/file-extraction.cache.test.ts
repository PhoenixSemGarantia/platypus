import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The content-hash cache lives in its own test file because observing it means
 * counting extractor invocations, which means mocking `unpdf` — and the sibling
 * `file-extraction.test.ts` deliberately runs the real extractors against real
 * fixtures.
 */
const extractText = vi.fn(() =>
  Promise.resolve({ totalPages: 1, text: "hello body" }),
);
vi.mock("unpdf", () => ({ extractText }));

const { extractDocumentText, resetExtractedTextCache } =
  await import("./file-extraction.ts");

const pdf = { mediaType: "application/pdf", filename: "a.pdf" };

describe("extracted-text cache", () => {
  beforeEach(() => {
    resetExtractedTextCache();
    extractText.mockClear();
  });

  it("parses identical bytes only once (history is re-sent every turn)", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const first = await extractDocumentText(bytes, pdf);
    const second = await extractDocumentText(new Uint8Array([1, 2, 3]), pdf);

    expect(first).toMatchObject({ status: "ok", text: "hello body" });
    expect(second).toMatchObject({ status: "ok", text: "hello body" });
    expect(extractText).toHaveBeenCalledTimes(1);
  });

  it("parses different bytes separately", async () => {
    await extractDocumentText(new Uint8Array([1, 2, 3]), pdf);
    await extractDocumentText(new Uint8Array([4, 5, 6]), pdf);
    expect(extractText).toHaveBeenCalledTimes(2);
  });

  it("caches a failed extraction so a scanned document isn't re-parsed", async () => {
    extractText.mockRejectedValueOnce(new Error("no text layer"));
    const bytes = new Uint8Array([7, 8, 9]);
    expect((await extractDocumentText(bytes, pdf)).status).toBe(
      "unextractable",
    );
    expect((await extractDocumentText(bytes, pdf)).status).toBe(
      "unextractable",
    );
    expect(extractText).toHaveBeenCalledTimes(1);
  });

  it("re-parses after the cache is reset", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    await extractDocumentText(bytes, pdf);
    resetExtractedTextCache();
    await extractDocumentText(bytes, pdf);
    expect(extractText).toHaveBeenCalledTimes(2);
  });
});
