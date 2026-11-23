import { useEffect, useRef, useState } from "react";
import { CaretDown, Plus, Warning } from "@phosphor-icons/react";
import type { ActiveConnection, SessionState } from "../types";
import { commands, formatKeys } from "../keymap";
import "./ConnectionBar.css";

interface Props {
  connections: ActiveConnection[];
  activeId: string | null;
  states: Record<string, SessionState>;
  onSelect: (id: string) => void;
  onDisconnect: (id: string) => void;
  onReconnect: (id: string) => void;
  onNew?: () => void;
}

export function ConnectionBar({ connections, activeId, states, onSelect, onDisconnect, onReconnect, onNew }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = connections.find((c) => c.sessionId === activeId) ?? null;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!active) return null;
  const disconnected = states[active.sessionId] === "Disconnected";
  const warn = active.compat.kind === "Warn" ? active.compat.reason : null;

  return (
    <div className="connbar" ref={ref}>
      <button
        className={`connbar-active ${active.environment ? `env-${active.environment}` : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="stripe" />
        <span className="connbar-label">{active.label}</span>
        <span className="connbar-ver">{active.serverVersion}</span>
        <CaretDown size={12} aria-hidden />
      </button>
      {warn && (
        <span className="connbar-warn" title={warn} aria-label={warn}>
          <Warning size={14} />
        </span>
      )}
      {disconnected && (
        <>
          <span className="connbar-off">Desconectado</span>
          <button className="btn" onClick={() => onReconnect(active.sessionId)}>
            Reconectar
          </button>
        </>
      )}
      {open && (
        <div role="menu" className="menu connbar-menu">
          {connections.map((c) => (
            <button
              key={c.sessionId}
              role="menuitem"
              className={`menu-item ${c.environment ? `env-${c.environment}` : ""}`}
              onClick={() => {
                onSelect(c.sessionId);
                setOpen(false);
              }}
            >
              <span className="stripe" style={{ height: 14 }} />
              <span className="menu-label">{c.label}</span>
              <span className="menu-kbd">{c.serverVersion}</span>
            </button>
          ))}
          <div className="menu-sep" role="separator" />
          {onNew && (
            <button
              role="menuitem"
              className="menu-item"
              onClick={() => {
                onNew();
                setOpen(false);
              }}
            >
              <Plus size={14} aria-hidden />
              <span className="menu-label">Nueva conexión</span>
              <span className="menu-kbd">{formatKeys(commands.connect.keys!)}</span>
            </button>
          )}
          <button
            role="menuitem"
            className="menu-item"
            onClick={() => {
              onDisconnect(active.sessionId);
              setOpen(false);
            }}
          >
            <span className="menu-label">Desconectar</span>
          </button>
        </div>
      )}
    </div>
  );
}
