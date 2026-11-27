import { ArrowCircleUp } from "@phosphor-icons/react";

/** Recordatorio de versión nueva en la barra superior; abre el diálogo de actualización. */
export function UpdateBadge({ version, onOpen }: { version: string; onOpen: () => void }) {
  const name = `Actualización disponible: ${version}`;
  return (
    <button className="ib update-badge" aria-label={name} title={name} onClick={onOpen}>
      <ArrowCircleUp size={16} weight="bold" aria-hidden />
    </button>
  );
}
