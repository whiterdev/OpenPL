export interface ScriptShortcut {
  abbreviation: string;
  script: string;
}

const STORAGE_KEY = "openpl.autoReplace";
export const abbreviationPattern = /^[a-z][a-z0-9_]*$/i;

export function loadScriptShortcuts(): ScriptShortcut[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      const entries: unknown = JSON.parse(stored);
      if (Array.isArray(entries)) return entries.filter((entry): entry is ScriptShortcut =>
        typeof entry?.abbreviation === "string" && abbreviationPattern.test(entry.abbreviation) &&
        typeof entry?.script === "string" && !!entry.script.trim());
    }
  } catch {
    // La configuración predeterminada sigue disponible si el almacenamiento falla.
  }
  return [{ abbreviation: "SEL", script: "select * from tabla" }];
}

export function saveScriptShortcuts(entries: ScriptShortcut[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function scriptReplacement(before: string, after: string) {
  const word = /[\p{L}\p{N}_$#]+$/u.exec(before)?.[0];
  if (!word || /^[\p{L}\p{N}_$#]/u.test(after)) return null;
  const entry = loadScriptShortcuts().find(({ abbreviation }) => abbreviation.toUpperCase() === word.toUpperCase());
  return entry ? { length: word.length, script: entry.script.replace(/\r\n?/g, "\n") } : null;
}
