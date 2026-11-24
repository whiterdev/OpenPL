import { useEffect, useRef } from "react";

interface Props {
  label: string;
  onCommit: () => void;
  onRollback: () => void;
  onCancel: () => void;
}

/** Cierre de una Ventana SQL con transacción abierta. Escape equivale a Cancelar. */
export function TransactionDialog({ label, onCommit, onRollback, onCancel }: Props) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    cancel.current?.focus();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  return (
    <div className="dialog-backdrop">
      <div role="dialog" aria-modal="true" aria-labelledby="tx-dialog-title" className="dialog"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          } else if (event.key === "Tab") {
            // El foco queda dentro del diálogo mientras está abierto.
            const buttons = Array.from(event.currentTarget.querySelectorAll("button"));
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next = (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
            event.preventDefault();
            buttons[next].focus();
          }
        }}>
        <h2 id="tx-dialog-title">Transacción abierta</h2>
        <p>{label} tiene cambios sin confirmar.</p>
        <div className="dialog-actions">
          <button className="btn primary" onClick={onCommit}>Commit</button>
          <button className="btn" onClick={onRollback}>Rollback</button>
          <button className="btn ghost" ref={cancel} onClick={onCancel}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
