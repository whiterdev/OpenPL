import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  CaretDown,
  CheckCircle,
  WarningCircle,
  MagnifyingGlass,
  Moon,
  Plus,
  SidebarSimple,
  Sun,
  X,
} from "@phosphor-icons/react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "./api";
import { StartupCheck } from "./components/StartupCheck";
import { LoginDialog } from "./components/LoginDialog";
import { ConnectionBar } from "./components/ConnectionBar";
import { MenuBar, type MenuDef } from "./components/MenuBar";
import { ObjectBrowser } from "./components/ObjectBrowser";
import { ObjectInspector, type Inspection } from "./components/ObjectInspector";
import { ObjectDraftDialog } from "./components/ObjectDraftDialog";
import { createDraft, dropDraft, privilegesQuery } from "./objectDraft";
import type { ProgramActions } from "./components/ProgramWindow";
import { Logo } from "./components/Logo";
import { ContextMenu, type ContextItem } from "./components/ContextMenu";
import { CommandPalette } from "./components/CommandPalette";
import { routineDraft, type RoutineOverload } from "./routineTest";
import { parseTestFile, type TestSettings } from "./testFile";
import { newWindowTemplates } from "./newWindows";
import { TransactionDialog } from "./components/TransactionDialog";
import { ThemeDialog, toggleThemeMode } from "./components/ThemeDialog";
import { activeTheme } from "./themes";
import {
  commands,
  formatKeys,
  handleShortcut,
  isWebviewKey,
  matches,
  type CommandId,
} from "./keymap";
import {
  describeError,
  type ActiveConnection,
  type ClientInfo,
  type ObjectInfo,
  type ProgramPart,
  type SessionState,
} from "./types";
import "./App.css";
import "./components/ProgramWindow.css";

const ProgramWindow = lazy(() =>
  import("./components/ProgramWindow").then((module) => ({
    default: module.ProgramWindow,
  })),
);
const SqlWindow = lazy(() =>
  import("./components/SqlWindow").then((module) => ({
    default: module.SqlWindow,
  })),
);

const quoteName = (name: string) => `"${name.replace(/"/g, '""')}"`;
const sqlTabActions = [
  "execute",
  "executeScript",
  "explainPlan",
  "fetchAllRows",
  "exportData",
  "cancel",
  "commit",
  "rollback",
  "editData",
  "applyChanges",
  "save",
  "complete",
  "foldBlock",
  "unfoldBlock",
  "goToLine",
  "find",
  "replace",
  "comment",
  "duplicateLine",
  "deleteLine",
  "undo",
  "redo",
  "indent",
  "outdent",
] as const;

interface ProgramTab {
  id: string;
  label: string;
  connection?: ActiveConnection;
  object?: Pick<ObjectInfo, "owner" | "name" | "object_type">;
  readOnly: boolean;
  dirty: boolean;
  parts?: ProgramPart[];
  error?: string;
  fileName?: string;
  load?: symbol;
  /** Ventana SQL: sesión propia, texto inicial y estado de su transacción. */
  sql?: {
    sessionId: string;
    initial: string;
    run: boolean;
    exportOnOpen?: boolean;
    edit?: boolean;
    test?: TestSettings;
    command?: boolean;
    transaction: boolean;
  };
}

const supportsProgram = new Set([
  "Package",
  "Type",
  "Procedure",
  "Function",
  "Trigger",
]);
const commandObjectTypes = {
  TABLE: "Table", VIEW: "View", "MATERIALIZED VIEW": "MaterializedView",
  PACKAGE: "Package", PROCEDURE: "Procedure", FUNCTION: "Function", TRIGGER: "Trigger",
  TYPE: "Type", SEQUENCE: "Sequence", SYNONYM: "Synonym", INDEX: "Index",
  "JAVA SOURCE": "JavaSource", LIBRARY: "Library", CLUSTER: "Cluster",
} satisfies Record<string, ObjectInfo["object_type"]>;
// En inputs y textareas estas teclas editan o seleccionan el texto del campo, no la ventana activa.
const fieldKeys = [
  "comment",
  "duplicateLine",
  "deleteLine",
  "upperCase",
  "lowerCase",
  "undo",
  "redo",
  "indent",
  "outdent",
  "fetchAllRows",
] as const;
const isFieldKey = (e: KeyboardEvent) =>
  fieldKeys.some((id) =>
    [commands[id].keys, ...(commands[id].alt ?? [])].some((k) => k && matches(e, k)),
  );

export default function App() {
  const [client, setClient] = useState<ClientInfo | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [draft, setDraft] = useState<{ object: ObjectInfo; connection: ActiveConnection; action: "rename" | "account" } | null>(null);
  const [connections, setConnections] = useState<ActiveConnection[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, SessionState>>({});
  const [showLogin, setShowLogin] = useState(false);
  const [showTheme, setShowTheme] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [themeMode, setThemeMode] = useState(() => activeTheme().mode);
  const [newMenu, setNewMenu] = useState<{ x: number; y: number } | null>(null);
  const [routineOptions, setRoutineOptions] = useState<{
    x: number; y: number; name: string; items: ContextItem[];
  } | null>(null);
  const closeRoutineOptions = useCallback(() => setRoutineOptions(null), []);
  const closeNewMenu = useCallback(() => setNewMenu(null), []);
  const pick = (run: () => void) => () => {
    setNewMenu(null);
    run();
  };
  const [explorerVisible, setExplorerVisible] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [reconnectErrors, setReconnectErrors] = useState<
    Record<string, string>
  >({});
  const [programs, setPrograms] = useState<ProgramTab[]>([]);
  const [programId, setProgramId] = useState<string | null>(null);
  const programActions = useRef<ProgramActions>(null);
  const compileSession = useRef<string | null>(null);
  const [closing, setClosing] = useState<ProgramTab | null>(null);
  const sqlCount = useRef(0);
  const dirtyPrograms = useRef(false);
  dirtyPrograms.current = programs.some((tab) => tab.dirty);
  const openTransactions = useRef(false);
  openTransactions.current = programs.some((tab) => tab.sql?.transaction);

  const active = connections.find((c) => c.sessionId === activeId) ?? null;
  const program = programs.find((tab) => tab.id === programId);
  const programObject = program?.object;
  const editorConnection = program?.connection
    ? connections.find(
        (connection) => connection.sessionId === program.connection?.sessionId,
      )
    : active;
  const sqlActions = program?.sql
    ? Object.fromEntries(
        sqlTabActions
          .filter((id) => !program.sql!.command || ["exportData", "cancel", "commit", "rollback"].includes(id))
          .filter(
            (id) =>
              (id !== "commit" && id !== "rollback") ||
              program.sql!.transaction,
          )
          .map((id) => [id, () => programActions.current?.[id]?.()]),
      )
    : {};
  const currentProgramActions = Object.fromEntries(
    (
      [
        "save",
        "spec",
        "body",
        "sideBySide",
        "goToDeclaration",
        "foldBlock",
        "unfoldBlock",
        "objectActions",
        "complete",
        "compareProgram",
        "test",
        "execute",
        "cancel",
        "goToLine",
        "find",
        "replace",
        "comment",
        "duplicateLine",
        "deleteLine",
        "upperCase",
        "lowerCase",
        "undo",
        "redo",
        "indent",
        "outdent",
      ] as const
    )
      .filter((id) => {
        if (!program?.parts) return false;
        if (id === "objectActions") return !!editorConnection;
        if (id === "test") return !!program.object && !!editorConnection;
        if (id === "compareProgram")
          return !!program.object && !!editorConnection;
        if (id === "execute" || id === "cancel")
          return !!program.object && !!editorConnection && !program.readOnly;
        if (id === "spec" || id === "body" || id === "sideBySide")
          return program.parts.length === 2;
        return (
          !program.readOnly ||
          [
            "save",
            "goToDeclaration",
            "foldBlock",
            "unfoldBlock",
            "goToLine",
            "find",
          ].includes(id)
        );
      })
      .map((id) => [id, () => programActions.current?.[id]?.()]),
  );

  const actions: Partial<Record<CommandId, () => void | boolean>> = {
    ...currentProgramActions,
    ...sqlActions,
    newSql: active ? () => void openSql(active) : undefined,
    newTest: active ? () => void openSql(active, "", false, false, { bindKinds: {}, outputs: [] }) : undefined,
    newCommand: active ? () => void openSql(active, "", false, false, undefined, true) : undefined,
    newProgram: () => newProgram(),
    openProgram: () => void openProgram(),
    closeTab: program ? () => closeProgram(program) : undefined,
    connect: () => setShowLogin(true),
    toggleExplorer: active ? () => setExplorerVisible((v) => !v) : undefined,
    refreshExplorer: active ? () => setRefreshTick((t) => t + 1) : undefined,
    disconnect: active ? () => void disconnect(active.sessionId) : undefined,
    reconnect: active ? () => void reconnect(active.sessionId) : undefined,
    customizeUi: () => setShowTheme(true),
    palette: () => setShowPalette(true),
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      // La grilla maneja su copia localmente. El editor y los campos usan la copia nativa.
      if (matches(e, commands.copyGrid.keys!)) return;
      if (showLogin || showTheme || showPalette || inspection || draft) {
        if (isWebviewKey(e)) e.preventDefault();
        return;
      }
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea") &&
        isFieldKey(e)
      )
        return;
      handleShortcut(e, actions);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    // Sin menú del navegador: los campos de texto conservan el nativo y el editor muestra el suyo.
    const onContext = (e: MouseEvent) => {
      if (
        e.target instanceof Element &&
        e.target.closest("input, textarea, .cm-editor")
      )
        return;
      e.preventDefault();
    };
    // Ctrl + rueda haría zoom del webview.
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };
    // Los botones laterales del mouse (3 y 4) navegan atrás y adelante.
    const onSideButton = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) e.preventDefault();
    };
    document.addEventListener("contextmenu", onContext);
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("mouseup", onSideButton);
    window.addEventListener("auxclick", onSideButton);
    return () => {
      document.removeEventListener("contextmenu", onContext);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("mouseup", onSideButton);
      window.removeEventListener("auxclick", onSideButton);
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const listener = getCurrentWindow().onCloseRequested((event) => {
      if (
        dirtyPrograms.current &&
        !window.confirm("¿Descartar los cambios sin guardar?")
      ) {
        event.preventDefault();
        return;
      }
      // Al cerrar la conexión, Oracle descarta la transacción pendiente.
      if (
        openTransactions.current &&
        !window.confirm(
          "Hay transacciones abiertas en ventanas SQL. ¿Salir con rollback?",
        )
      ) {
        event.preventDefault();
      }
    });
    return () => {
      void listener.then((unlisten) => unlisten());
    };
  }, []);

  async function disconnect(id: string) {
    await api.disconnect(id);
    const rest = connections.filter((c) => c.sessionId !== id);
    setConnections(rest);
    setActiveId(rest[0]?.sessionId ?? null);
    if (rest.length === 0) setShowLogin(true);
  }

  async function reconnect(id: string) {
    try {
      await api.reconnect(id);
      setStates((s) => ({ ...s, [id]: "Connected" }));
      setReconnectErrors(({ [id]: _old, ...rest }) => rest);
      setRefreshTick((t) => t + 1);
    } catch (e) {
      const d = describeError(e);
      setStates((s) => ({ ...s, [id]: "Disconnected" }));
      setReconnectErrors((r) => ({
        ...r,
        [id]: d.code ? `${d.code} ${d.message}` : d.message,
      }));
    }
  }

  const onConnectionLost = useCallback(() => {
    if (activeId) setStates((s) => ({ ...s, [activeId]: "Disconnected" }));
  }, [activeId]);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2500);
  }, []);

  function updateProgram(
    id: string,
    change: Partial<ProgramTab>,
    load?: symbol,
  ) {
    setPrograms((tabs) =>
      tabs.map((tab) =>
        tab.id === id && (!load || tab.load === load)
          ? { ...tab, ...change }
          : tab,
      ),
    );
  }

  function addProgram(tab: ProgramTab) {
    setPrograms((tabs) =>
      tabs.some((item) => item.id === tab.id) ? tabs : [...tabs, tab],
    );
    setProgramId(tab.id);
  }

  function newProgram(template = newWindowTemplates[0]) {
    addProgram({
      id: crypto.randomUUID(),
      label: template.label,
      readOnly: false,
      dirty: false,
      parts: template.parts.map(({ kind, source }) => ({
        kind,
        source,
        last_ddl_time: null,
        diagnostics: [],
      })),
    });
  }

  async function openProgram() {
    try {
      const file = await api.openProgramFile();
      if (!file) return;
      const name = file.name.toLowerCase();
      if (name.endsWith(".tst")) {
        if (!active) throw new Error("Conéctate para abrir la prueba.");
        const { source, bindKinds, outputs } = parseTestFile(file.source);
        await openSql(active, source, false, false, { bindKinds, outputs, fileName: file.name });
        return;
      }
      const kind = name.endsWith(".pks")
        ? "PACKAGE"
        : name.endsWith(".pkb")
          ? "PACKAGE BODY"
          : "SQL";
      addProgram({
        id: crypto.randomUUID(),
        label: file.name,
        fileName: file.name,
        readOnly: false,
        dirty: false,
        parts: [
          {
            kind,
            source: file.source.replace(/\r\n?/g, "\n"),
            last_ddl_time: null,
            diagnostics: [],
          },
        ],
      });
    } catch (error) {
      showNotice(describeError(error).message);
    }
  }

  async function openSql(
    connection: ActiveConnection,
    initial = "",
    run: boolean | "export" = false,
    edit = false,
    test?: TestSettings,
    command = false,
    label?: string,
  ) {
    try {
      const sessionId = await api.sqlOpen(connection.sessionId);
      sqlCount.current += 1;
      addProgram({
        id: crypto.randomUUID(),
        label: label ?? test?.fileName ?? `${command ? "Comando" : test ? "Prueba" : "SQL"} ${sqlCount.current}`,
        connection,
        readOnly: false,
        dirty: false,
        sql: { sessionId, initial, run: !!run, exportOnOpen: run === "export", edit, test, command, transaction: false },
      });
    } catch (error) {
      const detail = describeError(error);
      showNotice(
        detail.code ? `${detail.code} ${detail.message}` : detail.message,
      );
    }
  }

  function queryData(object: Pick<ObjectInfo, "owner" | "name">, edit = false, exportCsv = false, connection = active) {
    if (!connection) return;
    void openSql(
      connection,
      `SELECT t.* FROM ${quoteName(object.owner)}.${quoteName(object.name)} t`,
      exportCsv ? "export" : true,
      edit,
      undefined,
      false,
      edit ? `${object.owner}.${object.name}` : undefined,
    );
  }

  async function testRoutine(connection: ActiveConnection, object: Pick<ObjectInfo, "owner" | "name" | "object_type">, name: string, x: number, y: number) {
    const packageName = object.object_type === "Package" ? object.name : null;
    const path = packageName ? [object.owner, packageName, name] : [object.owner, object.name];
    function prepare(signature: RoutineOverload, overloaded = false) {
      try {
        const draft = routineDraft(path, signature, overloaded);
        void openSql(connection, draft.source, false, false, {
          bindKinds: draft.bindKinds, outputs: draft.outputs, routine: { path, signature, overloaded },
        });
      } catch (error) {
        showNotice(describeError(error).message);
      }
    }
    try {
      const signatures = await api.routineOverloads(connection.sessionId, object.owner, packageName, name);
      if (signatures.length === 1) {
        prepare(signatures[0]);
      } else {
        setRoutineOptions({ x, y, name, items: signatures.map((signature) => ({
          label: `${signature.subprogram_id} · (${signature.parameters.map(({ declaration }) =>
            [declaration.name, declaration.direction, declaration.data_type].filter(Boolean).join(" ")).join(", ")})`,
          run: () => prepare(signature, true),
        })) });
      }
    } catch (error) {
      showNotice(describeError(error).message);
    }
  }

  async function testObject(connection: ActiveConnection, object: ObjectInfo, x: number, y: number) {
    if (object.object_type !== "Package") {
      await testRoutine(connection, object, object.name, x, y);
      return;
    }
    try {
      const [parts, { programStructure }] = await Promise.all([
        fetchProgram(connection.sessionId, object),
        import("./programStructure"),
      ]);
      const spec = parts.find((part) => part.kind === "PACKAGE");
      const names = new Set(programStructure(spec?.source ?? "")
        .filter((entry) => entry.kind === "procedure" || entry.kind === "function").map((entry) => entry.name));
      if (!names.size) {
        showNotice("Paquete sin rutinas públicas");
        return;
      }
      setRoutineOptions({ x, y, name: object.name, items: [...names].map((name) => ({
        label: name, run: () => void testRoutine(connection, object, name, x, y),
      })) });
    } catch (error) {
      showNotice(describeError(error).message);
    }
  }

  function removeTab(tab: ProgramTab) {
    if (tab.sql) void api.sqlClose(tab.sql.sessionId);
    setPrograms((all) => {
      const index = all.findIndex((item) => item.id === tab.id);
      const remaining = all.filter((item) => item.id !== tab.id);
      setProgramId((current) =>
        current === tab.id
          ? (remaining[Math.min(index, remaining.length - 1)]?.id ?? null)
          : current,
      );
      return remaining;
    });
  }

  async function finishTransaction(
    tab: ProgramTab,
    action: "commit" | "rollback",
  ) {
    try {
      if (action === "commit") await api.sqlCommit(tab.sql!.sessionId);
      else await api.sqlRollback(tab.sql!.sessionId);
      setClosing(null);
      removeTab(tab);
    } catch (error) {
      const detail = describeError(error);
      setClosing(null);
      showNotice(
        detail.code ? `${detail.code} ${detail.message}` : detail.message,
      );
    }
  }

  function closeProgram(tab: ProgramTab) {
    if (tab.sql?.transaction) {
      setClosing(tab);
      return;
    }
    if (
      tab.dirty &&
      !window.confirm(
        tab.sql
          ? "¿Descartar el texto sin guardar?"
          : "¿Descartar cambios del programa?",
      )
    )
      return;
    if (tab.sql) {
      removeTab(tab);
      return;
    }
    const index = programs.findIndex((item) => item.id === tab.id);
    const remaining = programs.filter((item) => item.id !== tab.id);
    setPrograms(remaining);
    if (programId === tab.id)
      setProgramId(
        remaining[Math.min(index, remaining.length - 1)]?.id ?? null,
      );
  }

  async function onOpenObject(
    object: ObjectInfo,
    mode: "view" | "edit" = "view",
    connection = active,
  ) {
    if (!connection) return;
    if (!supportsProgram.has(object.object_type)) {
      if (mode === "edit") {
        try {
          const ddl = await api.objectDdl(connection.sessionId, object.object_type, object.owner, object.name);
          await openSql(connection, ddl);
        } catch (error) {
          showNotice(describeError(error).message);
        }
      } else {
        setInspection({ object, sessionId: connection.sessionId, mode: "describe" });
      }
      return;
    }
    const id = JSON.stringify([
      connection.sessionId,
      object.object_type,
      object.owner,
      object.name,
    ]);
    const existing = programs.find((tab) => tab.id === id);
    const load = Symbol();
    if (existing) {
      setProgramId(id);
      if (mode === "edit") updateProgram(id, { readOnly: false });
      if (!existing.error) return;
      updateProgram(id, { error: undefined, load });
    } else {
      addProgram({
        id,
        connection,
        object,
        label: `${object.owner}.${object.name} @ ${connection.label}`,
        readOnly: mode === "view",
        dirty: false,
        load,
      });
    }
    try {
      const parts = [...(await fetchProgram(connection.sessionId, object))];
      if (parts.length === 0) throw new Error("Fuente no disponible.");
      const first = parts[0]?.kind;
      if (parts.length === 1 && (first === "PACKAGE" || first === "TYPE")) {
        parts.push({
          kind: `${first} BODY`,
          source: "",
          last_ddl_time: null,
          diagnostics: [],
        });
      }
      updateProgram(id, { parts, load: undefined }, load);
    } catch (error) {
      const detail = describeError(error);
      updateProgram(
        id,
        {
          error: detail.code
            ? `${detail.code} ${detail.message}`
            : detail.message,
          load: undefined,
        },
        load,
      );
    }
  }

  async function fetchProgram(
    sessionId: string,
    object: NonNullable<ProgramTab["object"]>,
  ) {
    try {
      return await api.programSource(
        sessionId,
        object.object_type,
        object.owner,
        object.name,
      );
    } catch (error) {
      if (describeError(error).kind === "ConnectionLost") {
        setStates((all) => ({ ...all, [sessionId]: "Disconnected" }));
      }
      throw error;
    }
  }

  /** Sesión hermana: el DDL confirma implícitamente y no debe cerrar la transacción del usuario. */
  async function compileProgram(sessionId: string, sql: string) {
    const id = await api.sqlOpen(sessionId);
    compileSession.current = id;
    try {
      return await api.sqlExecute(id, sql, []);
    } finally {
      compileSession.current = null;
      try {
        await api.sqlClose(id);
      } catch {
        // La sesión hermana ya pudo cerrarse; el resultado de la compilación es lo que importa.
      }
    }
  }

  function cancelCompile() {
    if (compileSession.current) void api.sqlCancel(compileSession.current);
  }

  const run = (id: CommandId) =>
    actions[id] ? { command: id, run: actions[id] } : { command: id };
  const menus: MenuDef[] = [
    {
      label: "Archivo",
      items: [
        run("newProgram"),
        run("openProgram"),
        run("save"),
        run("closeTab"),
      ],
    },
    {
      label: "Editar",
      items: [
        run("undo"),
        run("redo"),
        "sep",
        run("indent"),
        run("outdent"),
        run("comment"),
        run("duplicateLine"),
        run("deleteLine"),
        "sep",
        run("upperCase"),
        run("lowerCase"),
        "sep",
        run("goToLine"),
        run("goToDeclaration"),
        run("objectActions"),
        run("complete"),
      ],
    },
    {
      label: "Buscar",
      items: [run("find"), run("replace"), "sep", run("palette")],
    },
    {
      label: "Ver",
      items: [
        run("toggleExplorer"),
        run("refreshExplorer"),
        "sep",
        run("foldBlock"),
        run("unfoldBlock"),
        run("compareProgram"),
        "sep",
        run("customizeUi"),
      ],
    },
    {
      label: "Sesión",
      items: [
        run("connect"),
        run("disconnect"),
        run("reconnect"),
        "sep",
        run("execute"),
        run("executeScript"),
        run("cancel"),
        "sep",
        run("commit"),
        run("rollback"),
        "sep",
        run("explainPlan"),
      ],
    },
    { label: "Herramientas", items: [run("test"), run("editData")] },
  ];

  if (!client)
    return (
      <StartupCheck
        onReady={(i) => {
          setClient(i);
          setShowLogin(true);
        }}
      />
    );

  return (
    <div className="shell">
      <header className="titlebar">
        <Logo size={18} />
        <MenuBar menus={menus} />
        <button
          className="btn"
          aria-haspopup="menu"
          aria-expanded={!!newMenu}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            setNewMenu((open) =>
              open ? null : { x: box.left, y: box.bottom + 2 },
            );
          }}
        >
          <Plus size={13} aria-hidden />
          Nuevo
          <CaretDown size={11} aria-hidden />
        </button>
        {newMenu && (
          <ContextMenu
            x={newMenu.x}
            y={newMenu.y}
            label="Nuevo"
            width={240}
            onClose={closeNewMenu}
            items={[
              ...(
                [
                  ["newSql", "Ventana SQL"],
                  ["newTest", "Ventana de prueba"],
                  ["newCommand", "Ventana de comando"],
                ] as const
              ).map(([id, label]): ContextItem => ({
                label,
                keys: commands[id].keys,
                run: actions[id] && pick(actions[id]),
                pending: commands[id].pending,
              })),
              "sep",
              ...newWindowTemplates.map((template, index): ContextItem => ({
                label: template.menu,
                keys: index === 0 ? commands.newProgram.keys : undefined,
                run: pick(() => newProgram(template)),
              })),
            ]}
          />
        )}
        {routineOptions && <ContextMenu x={routineOptions.x} y={routineOptions.y} label={routineOptions.name}
          items={routineOptions.items} onClose={closeRoutineOptions} width={360} className="program-declaration-menu" />}
        <ConnectionBar
          connections={connections}
          activeId={activeId}
          states={states}
          onSelect={setActiveId}
          onDisconnect={(id) => void disconnect(id)}
          onReconnect={(id) => void reconnect(id)}
          reconnectError={activeId ? reconnectErrors[activeId] : undefined}
          onNew={() => setShowLogin(true)}
        />
        <div className="titlebar-center">
          <button
            className="search"
            title="Buscar comando"
            onClick={actions.palette}
          >
            <MagnifyingGlass size={14} aria-hidden />
            <span>Buscar</span>
            <span className="kbd">{formatKeys(commands.palette.keys!)}</span>
          </button>
        </div>
        {program?.sql?.transaction ? (
          <span className="tx tx-open">
            <WarningCircle size={14} aria-hidden />
            Transacción abierta
          </span>
        ) : (
          <span className="tx">
            <CheckCircle size={14} aria-hidden />
            Sin transacción
          </span>
        )}
        <button
          className="btn"
          disabled={!actions.commit}
          onClick={actions.commit}
          title={program?.sql ? undefined : "Commit de la ventana SQL activa"}
        >
          Commit{" "}
          <span className="kbd">{formatKeys(commands.commit.keys!)}</span>
        </button>
        <button
          className="btn"
          disabled={!actions.rollback}
          onClick={actions.rollback}
          title={program?.sql ? undefined : "Rollback de la ventana SQL activa"}
        >
          Rollback{" "}
          <span className="kbd">{formatKeys(commands.rollback.keys!)}</span>
        </button>
        <button
          className="ib"
          aria-label={themeMode === "dark" ? "Tema claro" : "Tema oscuro"}
          title={themeMode === "dark" ? "Tema claro" : "Tema oscuro"}
          onClick={() => setThemeMode(toggleThemeMode().mode)}
        >
          {themeMode === "dark" ? (
            <Sun size={16} aria-hidden />
          ) : (
            <Moon size={16} aria-hidden />
          )}
        </button>
      </header>

      {showPalette && <CommandPalette actions={actions} onClose={() => setShowPalette(false)} />}
      <div className="body">
        {active && explorerVisible && (
          <ObjectBrowser
            key={active.sessionId}
            connection={active}
            refreshKey={refreshTick}
            onOpenObject={(object, mode) => void onOpenObject(object, mode)}
            onConnectionLost={onConnectionLost}
            onNotice={showNotice}
            onQueryData={(object) => queryData(object)}
            onEditData={(object) => queryData(object, true)}
            onExportData={(object) => queryData(object, false, true)}
            onInspect={(object, mode) => setInspection({ object, mode, sessionId: active.sessionId })}
            onDraft={(action, type, object) => {
              if (action === "create") {
                const sql = createDraft(type);
                if (sql) void openSql(active, sql);
              } else if (object) {
                if (action === "drop") {
                  const sql = dropDraft(object);
                  if (sql) void openSql(active, sql);
                } else if (action === "privileges") {
                  void openSql(active, privilegesQuery(object.name), true);
                } else {
                  setDraft({ object, connection: active, action });
                }
              }
            }}
            onTest={(object, x, y) => void testObject(active, object, x, y)}
          />
        )}
        <main className="workspace">
          {!active && !program && (
            <div className="empty">
              <p>Sin conexión</p>
              <div className="empty-actions">
                <button
                  className="btn primary"
                  onClick={() => setShowLogin(true)}
                >
                  Conectar{" "}
                  <span className="kbd">
                    {formatKeys(commands.connect.keys!)}
                  </span>
                </button>
                <button className="btn" onClick={() => newProgram()}>
                  Nuevo programa{" "}
                  <span className="kbd">
                    {formatKeys(commands.newProgram.keys!)}
                  </span>
                </button>
              </div>
            </div>
          )}
          {!!programs.length && (
            <div className="program-workspace">
              <div className="program-tabs" aria-label="Programas abiertos">
                {programs.map((tab) => (
                  <div
                    key={tab.id}
                    className={`program-tab ${tab.connection?.environment ? `env-${tab.connection.environment}` : ""}`}
                  >
                    <button
                      aria-pressed={tab.id === programId}
                      onClick={() => setProgramId(tab.id)}
                    >
                      {tab.label}
                      {tab.dirty ? " *" : ""}
                    </button>
                    <button
                      className="ib"
                      onClick={() => closeProgram(tab)}
                      aria-label={`Cerrar ${tab.label}`}
                      title={formatKeys(commands.closeTab.keys!)}
                    >
                      <X size={13} aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
              {programs.map((tab) => (
                <div
                  key={tab.id}
                  className="program-document"
                  hidden={tab.id !== programId}
                >
                  {tab.sql ? (
                    <Suspense fallback={<p role="status">Cargando editor…</p>}>
                      <SqlWindow
                        sessionId={tab.sql.sessionId}
                        initialSql={tab.sql.initial}
                        command={tab.sql.command}
                        active={tab.id === programId}
                        onEditObject={(object) => {
                          if (object.object_type === "TABLE") {
                            queryData(object, true, false, tab.connection);
                            return;
                          }
                          const type = commandObjectTypes[object.object_type as keyof typeof commandObjectTypes];
                          if (type) void onOpenObject({ ...object, object_type: type, status: "Valid", last_ddl_time: "" }, "edit", tab.connection);
                        }}
                        testSettings={tab.sql.test}
                        runOnOpen={tab.sql.run}
                        exportOnOpen={tab.sql.exportOnOpen}
                        editOnOpen={tab.sql.edit}
                        environment={tab.connection?.environment ?? undefined}
                        ref={tab.id === programId ? programActions : undefined}
                        onDirty={(dirty) => updateProgram(tab.id, { dirty })}
                        onTransaction={(open) =>
                          setPrograms((all) =>
                            all.map((item) =>
                              item.id === tab.id && item.sql
                                ? {
                                    ...item,
                                    sql: { ...item.sql, transaction: open },
                                  }
                                : item,
                            ),
                          )
                        }
                      />
                    </Suspense>
                  ) : tab.parts ? (
                    <Suspense fallback={<p role="status">Cargando editor…</p>}>
                      <ProgramWindow
                        parts={tab.parts}
                        readOnly={tab.readOnly}
                        onReadOnlyChange={(readOnly) => updateProgram(tab.id, { readOnly })}
                        fileName={tab.fileName}
                        active={tab.id === programId}
                        catalog={
                          tab.id === programId && editorConnection
                            ? {
                                sessionId: editorConnection.sessionId,
                                owner: tab.object?.owner ?? null,
                                openProgram: (object) =>
                                  void onOpenObject(
                                    object,
                                    "view",
                                    editorConnection,
                                  ),
                              }
                            : undefined
                        }
                        readCurrentProgram={
                          tab.id === programId &&
                          editorConnection &&
                          programObject
                            ? () =>
                                fetchProgram(
                                  editorConnection.sessionId,
                                  programObject,
                                )
                            : undefined
                        }
                        compilationTarget={tab.object}
                        onTestRoutine={tab.id === programId && editorConnection && programObject
                          ? (name, x, y) => void testRoutine(editorConnection, programObject, name, x, y)
                          : undefined}
                        compile={
                          tab.id === programId &&
                          editorConnection &&
                          programObject &&
                          !tab.readOnly
                            ? {
                                production:
                                  editorConnection.environment === "prod",
                                run: (sql) =>
                                  compileProgram(
                                    editorConnection.sessionId,
                                    sql,
                                  ),
                                cancel: cancelCompile,
                              }
                            : undefined
                        }
                        ref={tab.id === programId ? programActions : undefined}
                        onDirty={(dirty) => updateProgram(tab.id, { dirty })}
                      />
                    </Suspense>
                  ) : tab.error ? (
                    <p role="alert">{tab.error}</p>
                  ) : (
                    <p role="status">Cargando fuente…</p>
                  )}
                </div>
              ))}
            </div>
          )}
          {closing && (
            <TransactionDialog
              label={closing.label}
              onCommit={() => void finishTransaction(closing, "commit")}
              onRollback={() => void finishTransaction(closing, "rollback")}
              onCancel={() => setClosing(null)}
            />
          )}
          {notice && (
            <div className="toast" role="status">
              {notice}
            </div>
          )}
        </main>
      </div>

      <footer className="statusbar">
        <button
          className="ib"
          aria-label={`${commands.toggleExplorer.label} (${formatKeys(commands.toggleExplorer.keys!)})`}
          title={`${commands.toggleExplorer.label}  ${formatKeys(commands.toggleExplorer.keys!)}`}
          style={{ width: 22, height: 22 }}
          disabled={!active}
          onClick={() => setExplorerVisible((v) => !v)}
        >
          <SidebarSimple size={14} />
        </button>
        {active && (
          <span
            className={`status-conn ${active.environment ? `env-${active.environment}` : ""}`}
          >
            <span className="dot" />
            {states[active.sessionId] === "Disconnected"
              ? "Desconectado"
              : "Conectado"}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {active && <span>Oracle {active.serverVersion}</span>}
        {client.version && <span>Instant Client {client.version}</span>}
      </footer>

      {showLogin && (
        <LoginDialog
          clientVersion={client.version}
          onCancel={() => setShowLogin(false)}
          onConnected={(c) => {
            setConnections((cs) => [...cs, c]);
            setActiveId(c.sessionId);
            setStates((s) => ({ ...s, [c.sessionId]: "Connected" }));
            setShowLogin(false);
          }}
        />
      )}
      {showTheme && (
        <ThemeDialog
          onClose={() => {
            setShowTheme(false);
            setThemeMode(activeTheme().mode);
          }}
        />
      )}
      {inspection && <ObjectInspector {...inspection} onClose={() => setInspection(null)} />}
      {draft && <ObjectDraftDialog object={draft.object} action={draft.action} onClose={() => setDraft(null)}
        onPrepare={(sql) => { void openSql(draft.connection, sql); setDraft(null); }} />}
    </div>
  );
}
