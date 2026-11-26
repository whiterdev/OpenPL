import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useLineBuffer } from "./useLineBuffer";

test("publica por lotes y conserva las últimas líneas con el total omitido", () => {
  vi.useFakeTimers();
  try {
    const { result, unmount } = renderHook(() => useLineBuffer<string>(2));
    act(() => {
      for (const line of ["a", "b", "c"]) result.current.append(line);
    });
    expect(result.current.lines).toEqual([]);
    act(() => vi.advanceTimersByTime(100));
    expect(result.current.lines).toEqual(["b", "c"]);
    expect(result.current.omitted).toBe(1);
    act(() => {
      result.current.append("d");
      result.current.clear();
    });
    act(() => vi.advanceTimersByTime(100));
    expect(result.current.lines).toEqual([]);
    expect(result.current.omitted).toBe(0);
    unmount();
  } finally {
    vi.useRealTimers();
  }
});
