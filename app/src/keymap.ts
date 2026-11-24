// Registro central de comandos y atajos (diseño §7.7). Menús, tooltips y teclado leen de aquí.

export type CommandId =
  | "execute"
  | "executeScript"
  | "cancel"
  | "commit"
  | "rollback"
  | "explainPlan"
  | "palette"
  | "newSql"
  | "test"
  | "newCommand"
  | "newProgram"
  | "openProgram"
  | "undo"
  | "redo"
  | "indent"
  | "outdent"
  | "save"
  | "closeTab"
  | "spec"
  | "body"
  | "sideBySide"
  | "goToDeclaration"
  | "objectActions"
  | "compareProgram"
  | "goToLine"
  | "find"
  | "replace"
  | "comment"
  | "duplicateLine"
  | "deleteLine"
  | "upperCase"
  | "lowerCase"
  | "editData"
  | "applyChanges"
  | "connect"
  | "disconnect"
  | "reconnect"
  | "toggleExplorer"
  | "refreshExplorer";

export interface Command {
  id: CommandId;
  label: string;
  keys?: string;
}

const list: Command[] = [
  { id: "execute", label: "Ejecutar", keys: "F8" },
  { id: "executeScript", label: "Ejecutar script", keys: "Shift+F8" },
  { id: "cancel", label: "Cancelar ejecución", keys: "Shift+Escape" },
  { id: "commit", label: "Commit", keys: "F10" },
  { id: "rollback", label: "Rollback", keys: "Shift+F10" },
  { id: "explainPlan", label: "Plan de ejecución", keys: "F5" },
  { id: "palette", label: "Buscar comando", keys: "Ctrl+K" },
  { id: "newSql", label: "Nueva ventana SQL", keys: "Ctrl+N" },
  { id: "test", label: "Probar", keys: "Ctrl+T" },
  { id: "newCommand", label: "Nueva ventana de comando", keys: "Ctrl+Shift+N" },
  { id: "newProgram", label: "Nuevo programa", keys: "Ctrl+Alt+N" },
  { id: "openProgram", label: "Abrir programa", keys: "Ctrl+O" },
  { id: "undo", label: "Deshacer", keys: "Ctrl+Z" },
  { id: "redo", label: "Rehacer", keys: "Ctrl+Shift+Z" },
  { id: "indent", label: "Aumentar sangría", keys: "Ctrl+]" },
  { id: "outdent", label: "Reducir sangría", keys: "Ctrl+[" },
  { id: "save", label: "Guardar", keys: "Ctrl+S" },
  { id: "closeTab", label: "Cerrar pestaña", keys: "Ctrl+W" },
  { id: "spec", label: "Spec", keys: "Alt+S" },
  { id: "body", label: "Body", keys: "Alt+B" },
  { id: "sideBySide", label: "Spec y Body lado a lado", keys: "Ctrl+\\" },
  { id: "goToDeclaration", label: "Ir a la declaración", keys: "F12" },
  { id: "objectActions", label: "Acciones del objeto", keys: "Alt+Enter" },
  { id: "compareProgram", label: "Comparar con Oracle", keys: "Alt+Shift+D" },
  { id: "goToLine", label: "Ir a línea", keys: "Ctrl+G" },
  { id: "find", label: "Buscar", keys: "Ctrl+F" },
  { id: "replace", label: "Reemplazar", keys: "Ctrl+H" },
  { id: "comment", label: "Comentar líneas", keys: "Ctrl+/" },
  { id: "duplicateLine", label: "Duplicar línea", keys: "Ctrl+D" },
  { id: "deleteLine", label: "Borrar línea", keys: "Ctrl+Shift+K" },
  { id: "upperCase", label: "Mayúsculas", keys: "Ctrl+Shift+U" },
  { id: "lowerCase", label: "Minúsculas", keys: "Ctrl+Alt+U" },
  { id: "editData", label: "Editar datos", keys: "Ctrl+E" },
  { id: "applyChanges", label: "Aplicar cambios", keys: "Ctrl+Shift+Enter" },
  { id: "connect", label: "Conectar", keys: "Ctrl+Shift+L" },
  { id: "disconnect", label: "Desconectar" },
  { id: "reconnect", label: "Reconectar" },
  {
    id: "toggleExplorer",
    label: "Mostrar u ocultar explorador",
    keys: "Ctrl+B",
  },
  { id: "refreshExplorer", label: "Refrescar explorador", keys: "Ctrl+R" },
];

export const commands = Object.fromEntries(
  list.map((c) => [c.id, c]),
) as Record<CommandId, Command>;

/** "Ctrl+Shift+L" → "Ctrl Shift L"; "Shift+Escape" → "Shift Esc". */
export function formatKeys(keys: string): string {
  return keys
    .split("+")
    .map((k) => (k === "Escape" ? "Esc" : k))
    .join(" ");
}

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/** Coincidencia exacta de modificadores y tecla. */
export function matches(e: KeyLike, keys: string): boolean {
  const parts = keys.split("+");
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1));
  if (mods.has("Ctrl") !== (e.ctrlKey || e.metaKey)) return false;
  if (mods.has("Shift") !== e.shiftKey) return false;
  if (mods.has("Alt") !== e.altKey) return false;
  return e.key.toLowerCase() === key.toLowerCase();
}

/**
 * Maneja una tecla contra el registro. Toda combinación registrada se bloquea aunque aún no
 * tenga acción (así F5 o Ctrl R no recargan la ventana); devuelve true si ejecutó una acción.
 */
export function handleShortcut(
  e: KeyLike & { preventDefault: () => void },
  actions: Partial<Record<CommandId, () => void>>,
): boolean {
  for (const c of list) {
    if (!c.keys || !matches(e, c.keys)) continue;
    e.preventDefault();
    const run = actions[c.id];
    if (run) {
      run();
      return true;
    }
    return false;
  }
  return false;
}
