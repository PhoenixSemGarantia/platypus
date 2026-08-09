import { describe, it, expect } from "vitest";
import { formatToolDuration, toolDurationMs } from "./tool-duration";

describe("formatToolDuration", () => {
  it("renders sub-second durations in milliseconds", () => {
    expect(formatToolDuration(842)).toBe("842ms");
  });

  // A third of the calls on a real chat round to zero milliseconds; a bare
  // `0ms` reads as a field that failed to populate.
  it("renders a sub-millisecond duration as less than a millisecond", () => {
    expect(formatToolDuration(0)).toBe("<1ms");
    expect(formatToolDuration(1)).toBe("1ms");
  });

  it("switches from milliseconds to seconds at 1000ms", () => {
    expect(formatToolDuration(999)).toBe("999ms");
    expect(formatToolDuration(1000)).toBe("1.0s");
  });

  it("renders seconds to one decimal place", () => {
    expect(formatToolDuration(1234)).toBe("1.2s");
  });

  it("switches from seconds to minutes at 60s", () => {
    expect(formatToolDuration(59_900)).toBe("59.9s");
    expect(formatToolDuration(60_000)).toBe("1m 00s");
  });

  it("zero-pads the seconds component of a minutes-and-seconds duration", () => {
    expect(formatToolDuration(63_000)).toBe("1m 03s");
    expect(formatToolDuration(754_000)).toBe("12m 34s");
  });
});

describe("toolDurationMs", () => {
  it("reads a numeric durationMs out of tool metadata", () => {
    expect(toolDurationMs({ durationMs: 1234 })).toBe(1234);
  });

  it("ignores metadata that carries no usable duration", () => {
    expect(toolDurationMs(undefined)).toBeUndefined();
    expect(toolDurationMs({})).toBeUndefined();
    expect(toolDurationMs({ durationMs: "1234" })).toBeUndefined();
    expect(toolDurationMs({ durationMs: null })).toBeUndefined();
  });
});
