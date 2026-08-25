import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Joins a base URL and a path, ensuring no double slashes or missing slashes.
 * @param base - The base URL
 * @param path - The path to append
 * @returns The joined URL string
 */
export function joinUrl(base: string, path: string): string {
  if (!base) return path;
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

/** The error a failed read throws, carrying the status and the response body. */
const fetchError = async (res: Response) => {
  const error: Error & { info?: unknown; status?: number } = new Error(
    "An error occurred while fetching the data.",
  );
  // Attach extra info to the error object.
  error.info = await res.json().catch(() => ({}));
  error.status = res.status;
  return error;
};

export const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
  const res = await fetch(input, { ...init, credentials: "include" });
  if (!res.ok) throw await fetchError(res);
  return res.json();
};

/**
 * A read whose subject may legitimately not exist yet: 404 resolves to `null`
 * rather than throwing.
 *
 * SWR gates interval revalidation on the cached entry being error-free, so a
 * read that throws on a missing row poisons its own polling — the only thing
 * that would clear the error is a fetch the interval will no longer perform. A
 * brand-new Chat is read before its row exists, since the run creates it, which
 * is exactly that case (issue #648).
 *
 * A per-read concession, not a change to `fetcher`'s contract: everywhere else
 * a 404 is a failure and still surfaces as one.
 */
export const optionalFetcher = async (
  input: RequestInfo | URL,
  init?: RequestInit,
) => {
  const res = await fetch(input, { ...init, credentials: "include" });
  if (res.status === 404) return null;
  if (!res.ok) throw await fetchError(res);
  return res.json();
};

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}
