import { renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./api";
import { useCompletionCatalog } from "./useCompletionCatalog";

afterEach(() => vi.restoreAllMocks());

test("sin sesión no hay catálogo", () => {
  const { result } = renderHook(() => useCompletionCatalog(undefined, null));
  expect(result.current).toBeNull();
});

test("el catálogo es estable mientras no cambien sesión ni esquema", () => {
  const { result, rerender } = renderHook(
    ({ session, owner }) => useCompletionCatalog(session, owner),
    { initialProps: { session: "s1", owner: null as string | null } },
  );
  const first = result.current;
  rerender({ session: "s1", owner: null });
  expect(result.current).toBe(first);
  rerender({ session: "s2", owner: null });
  expect(result.current).not.toBe(first);
  const second = result.current;
  rerender({ session: "s2", owner: "HR" });
  expect(result.current).not.toBe(second);
});

test("consulta con la sesión y el esquema dados y guarda las respuestas", async () => {
  const columns = vi.spyOn(api, "objectColumns").mockResolvedValue([]);
  const objects = vi.spyOn(api, "completeObjects").mockResolvedValue([]);
  const { result } = renderHook(() => useCompletionCatalog("w1", "HR"));
  await result.current!.columns(null, "VENTAS");
  await result.current!.columns(null, "VENTAS");
  await result.current!.objects(null, "VEN", "relations");
  expect(columns).toHaveBeenCalledTimes(1);
  expect(columns).toHaveBeenCalledWith("w1", null, "VENTAS", "HR");
  expect(objects).toHaveBeenCalledWith("w1", null, "VEN", "HR", "relations");
});
