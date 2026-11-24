import { expect, test } from "vitest";
import { createDraft, dropDraft, renameDraft } from "./objectDraft";

test("prepara DDL sin perder las comillas de los identificadores", () => {
  const table = { object_type: "Table", owner: "HR", name: 'A"B' } as const;
  expect(renameDraft(table, "NUEVA")).toBe('ALTER TABLE "HR"."A""B" RENAME TO "NUEVA";');
  expect(dropDraft(table)).toBe('DROP TABLE "HR"."A""B";');
  expect(dropDraft({ ...table, object_type: "RecycleBin" })).toBeUndefined();
  expect(createDraft("Table")).toContain("CREATE TABLE");
});
