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
  Plus,
  SidebarSimple,
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
import type { ProgramActions } from "./components/ProgramWindow";
import { Logo } from "./components/Logo";
import { ContextMenu, type ContextItem } from "./components/ContextMenu";
import { newWindowTemplates } from "./newWindows";
import { TransactionDialog } from "./components/TransactionDialog";
import {
  commands,
  formatKeys,
  handleShortcut,
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
  "fetchAllRows",
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
    edit?: boolean;
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
const editorEdits = [
  "comment",
  "duplicateLine",
  "deleteLine",
  "upperCase",
  "lowerCase",
  "undo",
  "redo",
  "indent",
  "outdent",
] as const;

export default function App() {
  const [client, setClient] = useState<ClientInfo | null>(null);
  const [connections, setConnections] = useState<ActiveConnection[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, SessionState>>({});
  const [showLogin, setShowLogin] = useState(false);
  const [newMenu, setNewMenu] = useState<{ x: number; y: number } | null>(null);
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
        "execute",
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
        if (id === "compareProgram")
          return !!program.object && !!editorConnection;
        if (id === "execute")
          return !program.readOnly && !!program.object && !!editorConnection;
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

  const actions: Partial<Record<CommandId, () => void>> = {
    ...currentProgramActions,
    ...sqlActions,
    newSql: active ? () => void openSql(active) : undefined,
    newProgram: () => newProgram(),
    openProgram: () => void openProgram(),
    closeTab: program ? () => closeProgram(program) : undefined,
    connect: () => setShowLogin(true),
    toggleExplorer: active ? () => setExplorerVisible((v) => !v) : undefined,
    refreshExplorer: active ? () => setRefreshTick((t) => t + 1) : undefined,
    disconnect: active ? () => void disconnect(active.sessionId) : undefined,
    reconnect: active ? () => void reconnect(active.sessionId) : undefined,
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (showLogin) {
        if (
          matches(e, commands.explainPlan.keys!) ||
          matches(e, commands.refreshExplorer.keys!)
        ) {
          e.preventDefault();
        }
        return;
      }
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable=true]") &&
        !target.closest(".cm-content") &&
        editorEdits.some((id) => matches(e, commands[id].keys!))
      )
        return;
      handleShortcut(e, actions);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    // Sin menú del navegador: solo los campos de texto conservan copiar y pegar.
    const onContext = (e: MouseEvent) => {
      if (
        e.target instanceof HTMLElement &&
        e.target.closest("input, textarea")
      )
        return;
      e.preventDefault();
    };
    document.addEventListener("contextmenu", onContext);
    return () => document.removeEventListener("contextmenu", onContext);
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
    run = false,
    edit = false,
  ) {
    try {
      const sessionId = await api.sqlOpen(connection.sessionId);
      sqlCount.current += 1;
      addProgram({
        id: crypto.randomUUID(),
        label: `SQL ${sqlCount.current}`,
        connection,
        readOnly: false,
        dirty: false,
        sql: { sessionId, initial, run, edit, transaction: false },
      });
    } catch (error) {
      const detail = describeError(error);
      showNotice(
        detail.code ? `${detail.code} ${detail.message}` : detail.message,
      );
    }
  }

  function queryData(object: ObjectInfo, edit = false) {
    if (!active) return;
    void openSql(
      active,
      `SELECT * FROM ${quoteName(object.owner)}.${quoteName(object.name)}`,
      true,
      edit,
    );
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
    if (!connection || !supportsProgram.has(object.object_type)) {
      showNotice("Edición disponible en una versión posterior");
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
      ],
    },
    {
      label: "Sesión",
      items: [
        run("connect"),
        run("disconnect"),
        run("reconnect"),
        "sep",
        program?.object
          ? { ...run("execute"), label: "Preparar compilación" }
          : run("execute"),
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
                  ["test", "Ventana de prueba"],
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
            disabled
            title="Buscar comando · Próximamente"
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
      </header>

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
                        runOnOpen={tab.sql.run}
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
    </div>
  );
}
