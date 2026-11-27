import { useEffect, useRef, useState } from "react";
import { commands, formatKeys, type CommandId } from "../keymap";
import "./ConnectionBar.css";
import "./MenuBar.css";

export interface MenuItemDef {
  command: CommandId;
  label?: string;
  /** Sin `run`, el comando aparece deshabilitado (aún no disponible). */
  run?: () => void;
  /** Motivo mostrado en `title` cuando el ítem está deshabilitado. */
  reason?: string;
}

export interface MenuDef {
  label: string;
  items: (MenuItemDef | "sep")[];
}

function disabledReason(item: MenuItemDef): string {
  if (item.reason) return item.reason;
  if (commands[item.command].pending) return "Próximamente";
  return "No disponible en el contexto actual";
}

/** `onOpen` avisa al abrir un menú, para cerrar los menús desplegables de afuera. */
export function MenuBar({ menus, onOpen }: { menus: MenuDef[]; onOpen?: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const menusRef = useRef(menus);
  menusRef.current = menus;
  const openRef = useRef(open);
  openRef.current = open;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    let altPending = false;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        const modal = document.querySelector('[role="dialog"][aria-modal="true"]');
        altPending =
          !modal &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.shiftKey &&
          !e.repeat &&
          !e.getModifierState?.("AltGraph");
        return;
      }
      altPending = false;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== "Alt" || !altPending) return;
      altPending = false;
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.getModifierState?.("AltGraph")) return;
      e.preventDefault();
      if (openRef.current !== null) {
        setOpen(null);
        trigger.current?.focus();
        return;
      }
      const first = menusRef.current[0];
      if (!first) return;
      trigger.current = ref.current?.querySelector<HTMLButtonElement>(".menubar-btn") ?? null;
      setOpen(first.label);
    };
    const cancelAlt = () => { altPending = false; };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousedown", cancelAlt);
    window.addEventListener("blur", cancelAlt);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousedown", cancelAlt);
      window.removeEventListener("blur", cancelAlt);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    onOpenRef.current?.();
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(null);
      trigger.current?.focus();
    };
    const menu = ref.current?.querySelector('[role="menu"]');
    const firstItem = menu?.querySelector<HTMLButtonElement>("button:not(:disabled)");
    (firstItem ?? trigger.current)?.focus();
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  function switchMenu(index: number, keepOpen: boolean) {
    const target = menus[index];
    if (!target) return;
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>(".menubar-btn") ?? []);
    const btn = buttons[index] ?? null;
    trigger.current = btn;
    if (keepOpen) {
      setOpen(target.label);
    } else {
      btn?.focus();
    }
  }

  return (
    <nav className="menubar" aria-label="Menú principal" ref={ref}>
      {menus.map((m, menuIndex) => (
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
              if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                event.preventDefault();
                const delta = event.key === "ArrowRight" ? 1 : -1;
                switchMenu((menuIndex + delta + menus.length) % menus.length, open !== null);
                return;
              }
              if (event.key !== "ArrowDown") return;
              event.preventDefault();
              trigger.current = event.currentTarget;
              if (open === m.label) {
                ref.current?.querySelector('[role="menu"]')?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
              } else {
                setOpen(m.label);
              }
            }}
          >
            {m.label}
          </button>
          {open === m.label && (
            <div role="menu" aria-label={m.label} className="menu menubar-menu"
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                  event.preventDefault();
                  const delta = event.key === "ArrowRight" ? 1 : -1;
                  switchMenu((menuIndex + delta + menus.length) % menus.length, true);
                  return;
                }
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
                    title={!it.run ? disabledReason(it) : undefined}
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
