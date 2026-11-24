import { useEffect, useRef, useState } from "react";
import { commands, formatKeys, type CommandId } from "../keymap";
import "./ConnectionBar.css";
import "./MenuBar.css";

export interface MenuItemDef {
  command: CommandId;
  label?: string;
  /** Sin `run`, el comando aparece deshabilitado (aún no disponible). */
  run?: () => void;
}

export interface MenuDef {
  label: string;
  items: (MenuItemDef | "sep")[];
}

export function MenuBar({ menus }: { menus: MenuDef[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(null);
      trigger.current?.focus();
    };
    const menu = ref.current?.querySelector('[role="menu"]');
    menu?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <nav className="menubar" aria-label="Menú principal" ref={ref}>
      {menus.map((m) => (
        <div key={m.label} className="menubar-slot">
          <button
            className={`menubar-btn ${open === m.label ? "open" : ""}`}
            aria-haspopup="menu"
            aria-expanded={open === m.label}
            onClick={(event) => {
              trigger.current = event.currentTarget;
              setOpen(open === m.label ? null : m.label);
            }}
            onMouseEnter={(event) => {
              if (!open || open === m.label) return;
              trigger.current = event.currentTarget;
              setOpen(m.label);
            }}
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown") return;
              event.preventDefault();
              trigger.current = event.currentTarget;
              setOpen(m.label);
            }}
          >
            {m.label}
          </button>
          {open === m.label && (
            <div role="menu" aria-label={m.label} className="menu menubar-menu"
              onKeyDown={(event) => {
                const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
                if (!step) return;
                const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
                if (!buttons.length) return;
                event.preventDefault();
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                buttons[(index + step + buttons.length) % buttons.length].focus();
              }}>
              {m.items.map((it, i) =>
                it === "sep" ? (
                  <div key={`sep${i}`} className="menu-sep" role="separator" />
                ) : (
                  <button
                    key={it.command}
                    role="menuitem"
                    className="menu-item"
                    disabled={!it.run}
                    onClick={() => {
                      setOpen(null);
                      it.run?.();
                    }}
                  >
                    <span className="menu-label">{it.label ?? commands[it.command].label}</span>
                    {!it.run && commands[it.command].pending && <span className="menu-soon">Próximamente</span>}
                    {commands[it.command].keys && <span className="menu-kbd">{formatKeys(commands[it.command].keys!)}</span>}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}
