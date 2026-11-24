import { expect, test } from "vitest";
import { parseTestFile, serializeTestFile } from "./testFile";

test("una prueba .tst guarda el bloque y metadatos sin credenciales ni valores", () => {
  const draft = {
    source: "-- ejemplo\nBEGIN NULL; END;\n/",
    bindKinds: { ID: "Number" as const },
    outputs: [{ name: "SALIDA", label: "Retorno", kind: "Text" as const }],
  };
  const text = serializeTestFile(draft);
  expect(parseTestFile(text.replace(/\n/g, "\r\n"))).toEqual(draft);
  expect(text).not.toContain("connection");
});

test("rechaza archivos sin version y salidas invalidas", () => {
  expect(() => parseTestFile("-- openpl-test v2\n{}\n")).toThrow();
  expect(() => parseTestFile('-- openpl-test v1\n-- {"outputs":[{"name":";","label":"X","kind":"Text"}],"bindKinds":{}}\n')).toThrow();
});

test.each(["Number", "Date", "Timestamp"] as const)("conserva la salida %s en .tst", (kind) => {
  const draft = { source: "BEGIN NULL; END;", bindKinds: {}, outputs: [{ name: "RESULTADO", label: "Retorno", kind }] };
  expect(parseTestFile(serializeTestFile(draft))).toEqual(draft);
});
