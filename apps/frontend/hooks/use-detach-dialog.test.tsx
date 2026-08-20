import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDetachDialog } from "./use-detach-dialog";

describe("useDetachDialog", () => {
  it("starts with nothing selected and no error", () => {
    const { result } = renderHook(() => useDetachDialog<{ id: string }>());
    expect(result.current.selected).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("selects an item and clears any stale error on open", () => {
    const { result } = renderHook(() => useDetachDialog<{ id: string }>());

    act(() => result.current.setError("stale error"));
    act(() => result.current.open({ id: "a1" }));

    expect(result.current.selected).toEqual({ id: "a1" });
    expect(result.current.error).toBeNull();
  });

  it("clears both selection and error on close", () => {
    const { result } = renderHook(() => useDetachDialog<{ id: string }>());

    act(() => result.current.open({ id: "a1" }));
    act(() => result.current.setError("detach failed"));
    act(() => result.current.close());

    expect(result.current.selected).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
