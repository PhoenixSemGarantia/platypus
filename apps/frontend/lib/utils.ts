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

export const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
  const res = await fetch(input, { ...init, credentials: "include" });
  if (!res.ok) {
    const error: Error & { info?: unknown; status?: number } = new Error(
      "An error occurred while fetching the data.",
    );
    // Attach extra info to the error object.
    const info = await res.json().catch(() => ({}));
    error.info = info;
    error.status = res.status;
    throw error;
  }
  return res.json();
};

/**
 * Parses standardschema.dev validation errors from an error response
 * @param errorData - The error response data from the API
 * @returns An object mapping field names to error messages
 */
export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Map a validation failure onto the fields that can show it.
 *
 * Each issue is keyed on its **full path**, dot-joined: a rule over a list
 * reports the row it failed on (`modelIds.2.alias`), so two bad rows produce
 * two messages the form can render in two places. Keyed on the first segment
 * alone, they overwrote each other — one message, one fix per round-trip.
 *
 * Every issue is *also* reported under its top-level field, because most forms
 * only know flat names. An error on the field itself wins that slot over one
 * derived from a row.
 */
export function parseValidationErrors(
  errorData: unknown,
): Record<string, string> {
  const errors: Record<string, string> = {};

  if (
    !errorData ||
    typeof errorData !== "object" ||
    !("error" in errorData) ||
    !Array.isArray(errorData.error)
  ) {
    return errors;
  }

  const issues: Array<{ path: string[]; message: string }> = [];
  for (const issue of errorData.error) {
    if (
      issue &&
      typeof issue === "object" &&
      "path" in issue &&
      Array.isArray(issue.path) &&
      issue.path.length > 0 &&
      "message" in issue &&
      typeof issue.message === "string"
    ) {
      issues.push({ path: issue.path.map(String), message: issue.message });
    }
  }

  // Exact paths first, so the top-level pass below can't take a slot an issue
  // on the field itself is entitled to.
  for (const { path, message } of issues) {
    const key = path.join(".");
    if (!(key in errors)) errors[key] = message;
  }
  for (const { path, message } of issues) {
    if (!(path[0] in errors)) errors[path[0]] = message;
  }

  return errors;
}

/**
 * Retract the error shown against a field, including any keyed at a path
 * *under* it — the edit that fixes a row is an edit to the field the row lives
 * in. Returns the original object when nothing matched, so a no-op leaves
 * state untouched.
 */
export function clearFieldError(
  errors: Record<string, string>,
  fieldName: string,
): Record<string, string> {
  const prefix = `${fieldName}.`;
  const remaining = Object.entries(errors).filter(
    ([key]) => key !== fieldName && !key.startsWith(prefix),
  );

  if (remaining.length === Object.keys(errors).length) return errors;
  return Object.fromEntries(remaining);
}
