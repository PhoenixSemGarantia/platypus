import { describe, it, expect } from "vitest";
import { isImageAttachment } from "./message-parts";

describe("isImageAttachment", () => {
  it("is true for an image media type with a URL", () => {
    expect(
      isImageAttachment({ mediaType: "image/png", url: "https://x/a.png" }),
    ).toBe(true);
  });

  it("is false for an image media type with no URL", () => {
    expect(isImageAttachment({ mediaType: "image/png", url: "" })).toBe(false);
  });

  it("is false for a non-image media type with a URL", () => {
    expect(
      isImageAttachment({
        mediaType: "application/pdf",
        url: "https://x/a.pdf",
      }),
    ).toBe(false);
  });
});
