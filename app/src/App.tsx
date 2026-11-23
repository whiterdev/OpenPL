import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle,
  MagnifyingGlass,
  Plus,
  SidebarSimple,
} from "@phosphor-icons/react";
import { api } from "./api";
import { StartupCheck } from "./components/StartupCheck";
import { LoginDialog } from "./components/LoginDialog";
import { ConnectionBar } from "./components/ConnectionBar";
import { MenuBar, type MenuDef } from "./components/MenuBar";
import { ObjectBrowser } from "./components/ObjectBrowser";
import { Logo } from "./components/Logo";
import { commands, formatKeys, handleShortcut, type CommandId } from "./keymap";
import {
  describeError,
  type ActiveConnection,
  type ClientInfo,
  type ObjectInfo,
  type SessionState,
} from "./types";
import "./App.css";

export default function App() {
  const [client, setClient] = useState<ClientInfo | null>(null);
  const [connections, setConnections] = useState<ActiveConnection[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, SessionState>>({});
  const [showLogin, setShowLogin] = useState(false);
  const [explorerVisible, setExplorerVisible] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [reconnectErrors, setReconnectErrors] = useState<Record<string, string>>({});

  const active = connections.find((c) => c.sessionId === activeId) ?? null;

  const actions: Partial<Record<CommandId, () => void>> = {
    connect: () => setShowLogin(true),
    toggleExplorer: active ? () => setExplorerVisible((v) => !v) : undefined,
    refreshExplorer: active ? () => setRefreshTick((t) => t + 1) : undefined,
    disconnect: active ? () => void disconnect(active.sessionId) : undefined,
    reconnect: active ? () => void reconnect(active.sessionId) : undefined,
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      handleShortcut(e, actions);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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
      setReconnectErrors((r) => ({ ...r, [id]: d.code ? `${d.code} ${d.message}` : d.message }));
    }
  }

  const onConnectionLost = useCallback(() => {
    if (activeId) setStates((s) => ({ ...s, [activeId]: "Disconnected" }));
  }, [activeId]);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2500);
  }, []);

  const onOpenObject = useCallback(
    (_o: ObjectInfo) => showNotice("Edición disponible en una versión posterior"),
    [showNotice],
  );

  const run = (id: CommandId) =>
    actions[id] ? { command: id, run: actions[id] } : { command: id };
  const menus: MenuDef[] = [
    { label: "Archivo", items: [run("save"), run("closeTab")] },
    {
      label: "Editar",
      items: [
        run("comment"),
        run("duplicateLine"),
        run("deleteLine"),
        "sep",
        run("upperCase"),
        run("lowerCase"),
        "sep",
        run("goToLine"),
        run("goToDeclaration"),
      ],
    },
    {
      label: "Buscar",
      items: [run("find"), run("replace"), "sep", run("palette")],
    },
    { label: "Ver", items: [run("toggleExplorer"), run("refreshExplorer")] },
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
    { label: "Ayuda", items: [] },
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
        <button className="btn" disabled title="Nuevo">
          <Plus size={13} aria-hidden />
          Nuevo
        </button>
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
          <button className="search" disabled>
            <MagnifyingGlass size={14} aria-hidden />
            <span>Buscar</span>
            <span className="kbd">{formatKeys(commands.palette.keys!)}</span>
          </button>
        </div>
        <span className="tx">
          <CheckCircle size={14} color="var(--env-dev)" aria-hidden />
          Sin transacción
        </span>
        <button className="btn" disabled>
          Commit{" "}
          <span className="kbd">{formatKeys(commands.commit.keys!)}</span>
        </button>
        <button className="btn" disabled>
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
            onOpenObject={onOpenObject}
            onConnectionLost={onConnectionLost}
            onNotice={showNotice}
          />
        )}
        <main className="workspace">
          {!active && <p className="empty">Sin conexión</p>}
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
          onCancel={connections.length ? () => setShowLogin(false) : undefined}
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
