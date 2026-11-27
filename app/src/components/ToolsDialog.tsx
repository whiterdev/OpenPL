import { useId, type ReactNode } from "react";
import { useFocusTrap } from "../useFocusTrap";
import "./ToolsDialog.css";

export function ToolsDialog({ title, close, children }: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const focus = useFocusTrap(close);
  return (
    <div className="dialog-backdrop">
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="dialog tools-dialog" {...focus}>
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
