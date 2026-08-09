/**
 * Formats how long a tool call took, adapting the unit to the magnitude so the
 * number stays readable at a glance: `<1ms`, `842ms`, `1.2s`, `1m 03s`.
 *
 * The stored figure is whole milliseconds, and plenty of local tools finish
 * inside one — a third of the calls on a real chat round to zero. Those read as
 * `<1ms`, because a bare `0ms` looks like a field that failed to populate.
 */
export function formatToolDuration(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  return `${Math.floor(totalSeconds / 60)}m ${String(seconds).padStart(2, "0")}s`;
}

/**
 * Pulls the run pipeline's recorded duration out of a tool invocation's
 * `toolMetadata`. The field is a free-form JSON object a provider may also
 * write to, so the value is checked rather than cast: anything that isn't a
 * number reads as "no duration", which renders as nothing at all.
 */
export function toolDurationMs(metadata: unknown): number | undefined {
  if (typeof metadata !== "object" || metadata === null) return undefined;
  const value = (metadata as Record<string, unknown>).durationMs;
  return typeof value === "number" ? value : undefined;
}
