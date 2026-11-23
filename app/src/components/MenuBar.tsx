import { useEffect, useRef, useState } from "react";
import { commands, formatKeys, type CommandId } from "../keymap";
import "./ConnectionBar.css";
import "./MenuBar.css";

export interface MenuItemDef {
  command: CommandId;
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

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
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
            onClick={() => setOpen(open === m.label ? null : m.label)}
            onMouseEnter={() => open && open !== m.label && setOpen(m.label)}
          >
            {m.label}
          </button>
          {open === m.label && (
            <div role="menu" aria-label={m.label} className="menu menubar-menu">
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
                    <span className="menu-label">{commands[it.command].label}</span>
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
