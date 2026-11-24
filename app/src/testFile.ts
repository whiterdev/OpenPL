import type { BindKind } from "./types";
import type { TestOutputBind, TestRoutine } from "./routineTest";

export interface TestSettings {
  bindKinds: Record<string, BindKind>;
  outputs: TestOutputBind[];
  routine?: TestRoutine;
  fileName?: string;
}

interface TestFile extends Pick<TestSettings, "bindKinds" | "outputs"> {
  source: string;
}

const HEADER = "-- openpl-test v1";
const BIND_NAME = /^[A-Z][A-Z0-9_$#]{0,127}$/;

export function serializeTestFile({ source, bindKinds, outputs }: TestFile) {
  return `${HEADER}\n-- ${JSON.stringify({ bindKinds, outputs })}\n${source}`;
}

export function parseTestFile(text: string): TestFile {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.shift() !== HEADER) throw new Error("Versión de prueba no reconocida.");
  const settings = lines.shift();
  const invalid = () => new Error("Metadatos de prueba inválidos.");
  if (!settings?.startsWith("-- ")) throw invalid();
  let decoded: unknown;
  try { decoded = JSON.parse(settings.slice(3)); } catch { throw invalid(); }
  if (!decoded || typeof decoded !== "object") throw invalid();
  const { bindKinds, outputs } = decoded as Record<string, unknown>;
  if (!bindKinds || typeof bindKinds !== "object" || Array.isArray(bindKinds) || !Array.isArray(outputs)) throw invalid();
  const entries = Object.entries(bindKinds);
  if (entries.some(([name, kind]) => !BIND_NAME.test(name) || !["Text", "Number", "Date"].includes(kind))) throw invalid();
  const names = new Set<string>();
  const safeOutputs = outputs.map((output) => {
    if (!output || typeof output !== "object") throw invalid();
    const { name, kind, label } = output;
    if (typeof name !== "string" || !BIND_NAME.test(name) || names.has(name) ||
      Object.prototype.hasOwnProperty.call(bindKinds, name) || typeof label !== "string" ||
      !["Text", "Clob", "Cursor"].includes(kind)) throw invalid();
    names.add(name);
    return { name, label, kind } as TestOutputBind;
  });
  return { source: lines.join("\n"), bindKinds: Object.fromEntries(entries), outputs: safeOutputs };
}
