import type { FileUIPart } from "ai";

/**
 * Whether a file part should render as an image rather than a generic file
 * attachment. An image media type with no URL (a Provider-reference-only
 * file, or a still-uploading part) has nothing a client can put in an `<img
 * src>` — falling back to the file card there is strictly better than a
 * broken image, so the URL is required alongside the media type (issue #579).
 */
export const isImageAttachment = (
  part: Pick<FileUIPart, "mediaType" | "url">,
): boolean => Boolean(part.mediaType?.startsWith("image/") && part.url);
