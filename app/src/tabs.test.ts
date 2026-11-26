import { expect, test } from "vitest";
import { neighbor, reorder } from "./tabs";

test("reordena sin modificar el orden de origen", () => {
  const tabs = ["A", "B", "C", "D"];
  expect(reorder(tabs, 0, 2)).toEqual(["B", "C", "A", "D"]);
  expect(reorder(tabs, 3, 0)).toEqual(["D", "A", "B", "C"]);
  expect(reorder(tabs, 0, 5)).toBe(tabs);
  expect(tabs).toEqual(["A", "B", "C", "D"]);
});

test("siguiente y anterior dan la vuelta", () => {
  expect(neighbor(["A", "B", "C"], 2, 1)).toBe("A");
  expect(neighbor(["A", "B", "C"], 0, -1)).toBe("C");
  expect(neighbor([], 0, 1)).toBeUndefined();
});
