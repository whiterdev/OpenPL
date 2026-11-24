import type { ContextItem } from "./components/ContextMenu";
import { commands } from "./keymap";
import type { ObjectType } from "./types";

export type MenuEntry = ContextItem | "sep";
export type InspectMode = "describe" | "properties" | "compare";

/** Acciones ya ligadas al objeto del menú. Sin `queryData`/`editData` esas opciones quedan pendientes. */
export interface ObjectMenuHandlers {
  open: () => void;
  view: () => void;
  edit: () => void;
  recompile: () => void;
  copyDdl: () => void;
  copyName: () => void;
  copyFullName: () => void;
  refresh: () => void;
  queryData?: () => void;
  editData?: () => void;
  exportData?: () => void;
  inspect?: (mode: InspectMode) => void;
  test?: () => void;
}

const CODE_TYPES = new Set<ObjectType>(["Package", "Procedure", "Function", "Trigger", "Type", "JavaSource", "JavaClass"]);
const DATA_TYPES = new Set<ObjectType>(["Table", "View", "MaterializedView"]);
const TESTABLE = new Set<ObjectType>(["Package", "Procedure", "Function"]);
const RECOMPILABLE = new Set<ObjectType>([...CODE_TYPES, "View", "MaterializedView"]);
const NO_DDL = new Set<ObjectType>(["JavaClass", "DbmsJob", "RecycleBin"]);
const RENAMEABLE = new Set<ObjectType>(["Table", "View", "Sequence", "Synonym"]);

function dataGroup(t: ObjectType, h: ObjectMenuHandlers): MenuEntry[] {
  const editKeys = commands.editData.keys;
  const query: ContextItem = h.queryData
    ? { label: "Consultar datos", run: h.queryData }
    : { label: "Consultar datos", pending: true };
  if (t !== "Table") {
    // Vistas y vistas materializadas no tienen un ROWID útil para editar filas.
    return ["sep", query, { label: "Editar datos" }, { label: "Exportar datos", run: h.exportData }];
  }
  const edit: ContextItem = h.editData
    ? { label: "Editar datos", keys: editKeys, run: h.editData }
    : { label: "Editar datos", keys: editKeys, pending: true };
  return ["sep", query, edit, { label: "Exportar datos", run: h.exportData }];
}

export function objectMenuItems(t: ObjectType, h: ObjectMenuHandlers): MenuEntry[] {
  const code = CODE_TYPES.has(t);
  const data = DATA_TYPES.has(t);
  const user = t === "User";
  const items: MenuEntry[] = [{ label: "Abrir", keys: "Enter", run: h.open }];
  if (t === "Package" || t === "Type") items.push(
    { label: "Ver Spec y Body", run: h.view },
    { label: "Editar Spec y Body", run: h.edit },
  );
  else if (t === "Procedure" || t === "Function" || t === "Trigger") items.push(
    { label: "Ver", run: h.view },
    { label: "Editar", run: h.edit },
  );
  else if ((code || data) && !NO_DDL.has(t)) items.push({ label: "Ver", run: h.view }, { label: "Editar", run: h.edit });
  if (TESTABLE.has(t)) items.push({ label: commands.test.label, keys: h.test ? undefined : commands.test.keys,
    run: h.test, pending: h.test ? undefined : true });
  if (data) items.push(...dataGroup(t, h));
  if (user) items.push(
    "sep",
    { label: "Editar usuario", pending: true },
    { label: "Privilegios", pending: true },
    { label: "Copiar DDL", run: h.copyDdl },
  );
  const inspect = h.inspect;
  items.push("sep",
    { label: "Describir", run: inspect && (() => inspect("describe")) },
    { label: "Propiedades", run: inspect && (() => inspect("properties")) },
  );
  if (RECOMPILABLE.has(t)) items.push({ label: "Recompilar", run: h.recompile });
  if (!user && !NO_DDL.has(t)) items.push({ label: "Copiar DDL", run: h.copyDdl });
  if ((code || data) && !NO_DDL.has(t)) items.push({ label: "Comparar con…", run: inspect && (() => inspect("compare")) });
  items.push(
    "sep",
    { label: "Copiar nombre", keys: "Ctrl+C", run: h.copyName },
    { label: "Copiar nombre con esquema", run: h.copyFullName },
    "sep",
  );
  if (RENAMEABLE.has(t)) items.push({ label: "Renombrar", pending: true });
  items.push({ label: "Eliminar", pending: true }, "sep", { label: "Refrescar", keys: commands.refreshExplorer.keys, run: h.refresh });
  return items;
}
