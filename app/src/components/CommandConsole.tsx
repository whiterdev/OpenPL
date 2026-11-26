import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../api";
import { commands, formatKeys } from "../keymap";
import { splitScript } from "../sqlScript";
import { describeError, type CompletionObject } from "../types";
import "./CommandConsole.css";

export interface ConsoleIo {
  ask(name: string): Promise<string | null>;
}

interface Props {
  sessionId: string;
  tabPrefix: string;
  active: boolean;
  lines: OutputLine[];
  running: boolean;
  alert: string | null;
  notice: string | null;
  log(kind: OutputLine["kind"], text: string): void;
  onEditObject?: (object: CompletionObject) => void;
  onRun(source: string, io: ConsoleIo): Promise<void>;
}

const io: ConsoleIo = { ask: async () => null };

export interface OutputLine {
  id: number;
  kind: "info" | "output" | "error" | "skip";
  text: string;
}

const editCommand = /^edit(?:\s|$)/i;
const editTarget = /^edit\s+(?:([\w$#]+)\.)?([\w$#]+);?$/i;

export function CommandConsole({ sessionId, tabPrefix, active, lines, running, alert, notice, log, onEditObject, onRun }: Props) {
  const key = () => formatKeys(commands.cancel.keys!);
  const terminal = useRef<HTMLDivElement>(null);
  const commandInput = useRef<HTMLTextAreaElement>(null);
  const followOutput = useRef(true);
  useLayoutEffect(() => {
    if (active && !running) commandInput.current?.focus({ preventScroll: true });
  }, [active, running]);
  useEffect(() => {
    if (!active) return;
    const focus = () => commandInput.current?.focus({ preventScroll: true });
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [active]);
  const [prompt, setPrompt] = useState("");
  useLayoutEffect(() => {
    const input = commandInput.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  }, [prompt]);
  const [commandLines, setCommandLines] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<{ prompt: string; items: CompletionObject[] }>();
  const [choice, setChoice] = useState<number>();
  const [dismissed, setDismissed] = useState(false);
  const matchesEdit = commandLines.length ? null : prompt.trim().match(editTarget);
  const candidates = suggestions?.prompt === prompt && !dismissed ? suggestions.items : [];
  const exact = candidates.findIndex((object) => object.name === matchesEdit?.[2].toUpperCase());
  const picked = choice ?? Math.max(0, exact);
  useLayoutEffect(() => {
    const area = terminal.current;
    if (area && followOutput.current) area.scrollTop = area.scrollHeight;
  }, [lines, commandLines, running, suggestions, dismissed, prompt]);
  useEffect(() => {
    const target = prompt.trim().match(editTarget);
    if (commandLines.length || !target) return;
    let current = true;
    const timer = setTimeout(() => {
      void api.completeObjects(sessionId, target[1]?.toUpperCase() ?? null, target[2].toUpperCase(), null, "edit")
        .then((items) => { if (current) setSuggestions({ prompt, items }); })
        .catch(() => { if (current) setSuggestions(undefined); });
    }, 120);
    return () => { current = false; clearTimeout(timer); };
  }, [commandLines.length, prompt, sessionId]);
  const commandHistory = useRef<string[]>([]);
  const historyIndex = useRef(0);
  const draft = useRef("");
  function remember(source: string) {
    const history = commandHistory.current;
    if (history[history.length - 1] !== source) history.push(source);
    historyIndex.current = history.length;
    draft.current = "";
  }

  return (
    <section className="sql-window" aria-label="Ventana de comando">
      <div className="sql-terminal" ref={terminal} role="log" aria-label="Transcripción"
        onScroll={({ currentTarget: area }) => {
          followOutput.current = area.scrollHeight - area.clientHeight - area.scrollTop <= 8;
        }}
        onClick={(event) => {
          const selection = window.getSelection();
          if (selection && !selection.isCollapsed && event.currentTarget.contains(selection.anchorNode)) return;
          commandInput.current?.focus({ preventScroll: true });
        }}>
        {lines.map((line) => <div key={line.id} className={`sql-line sql-line-${line.kind}`}>{line.text}</div>)}
        {commandLines.map((line, index) => <div key={index} className="sql-line sql-line-info">
          {index === 0 ? "SQL>" : String(index + 1).padStart(3)} {line}
        </div>)}
        {alert && <div role="alert" className="sql-line sql-line-error">{alert}</div>}
        {notice && <div role="status" className="sql-line">{notice}</div>}
        {running && <div role="status" className="sql-line">Ejecutando… {key()} para detener</div>}
        <form className="sql-command-prompt" onSubmit={async (event) => {
          event.preventDefault();
          const entered = prompt;
          const trimmed = entered.trim();
          if (running || !trimmed) return;
          setPrompt("");
          setChoice(undefined);
          setDismissed(false);
          if (!commandLines.length && editCommand.test(trimmed)) {
            remember(entered);
            log("info", `SQL> ${entered}`);
            if (!matchesEdit || !onEditObject) {
              log("error", "Usa EDIT [esquema.]objeto.");
              return;
            }
            try {
              const name = matchesEdit[2].toUpperCase();
              const items = candidates.length ? candidates : await api.completeObjects(
                sessionId, matchesEdit[1]?.toUpperCase() ?? null, name, null, "edit",
              );
              const object = candidates.length ? items[picked] : items.find((item) => item.name === name) ?? items[0];
              if (object) onEditObject(object);
              else log("error", "Objeto no encontrado.");
            } catch (error) {
              log("error", describeError(error).message);
            }
            return;
          }
          const source = [...commandLines, entered].join("\n");
          const statements = splitScript(source);
          const complete = /(?:^|\n)\s*\/$/.test(trimmed) || statements[0]?.kind === "sqlplus" ||
            (statements[0]?.kind === "sql" && trimmed.endsWith(";"));
          if (!complete) {
            setCommandLines((lines) => [...lines, entered]);
            return;
          }
          if (statements.length) remember(source);
          setCommandLines([]);
          await onRun(source, io);
        }}>
          <label htmlFor={`${tabPrefix}-prompt`} className="mono">{commandLines.length ? String(commandLines.length + 1).padStart(3) : "SQL>"}</label>
          <textarea ref={commandInput} id={`${tabPrefix}-prompt`} rows={1} className="mono" aria-label="Comando SQL"
            role={matchesEdit ? "combobox" : undefined} aria-autocomplete={matchesEdit ? "list" : undefined}
            aria-expanded={matchesEdit ? !!candidates.length : undefined}
            aria-controls={candidates.length ? `${tabPrefix}-objects` : undefined}
            aria-activedescendant={candidates.length ? `${tabPrefix}-object-${picked}` : undefined}
            value={prompt} readOnly={running}
            onChange={(event) => { setPrompt(event.target.value); setChoice(undefined); setDismissed(false); }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
                return;
              }
              if (commandLines.length && event.key === "Escape") {
                event.preventDefault();
                setCommandLines([]);
                setPrompt("");
                return;
              }
              if (candidates.length && event.key === "Escape") {
                event.preventDefault();
                setDismissed(true);
                return;
              }
              const delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
              if (!delta || running || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
              const input = event.currentTarget;
              if (delta < 0 ? input.value.slice(0, input.selectionStart).includes("\n")
                : input.value.slice(input.selectionEnd).includes("\n")) return;
              event.preventDefault();
              if (candidates.length) {
                const next = (picked + delta + candidates.length) % candidates.length;
                setChoice(next);
                document.getElementById(`${tabPrefix}-object-${next}`)?.scrollIntoView?.({ block: "nearest" });
                return;
              }
              const history = commandHistory.current;
              if (historyIndex.current === history.length) draft.current = input.value;
              historyIndex.current = Math.max(0, Math.min(history.length, historyIndex.current + delta));
              setPrompt(history[historyIndex.current] ?? draft.current);
            }} />
          {!!candidates.length && <div className="sql-command-objects" role="listbox" id={`${tabPrefix}-objects`} aria-label="Objetos Oracle">
            {candidates.map((object, index) => <div key={JSON.stringify(object)} role="option"
              id={`${tabPrefix}-object-${index}`} aria-selected={picked === index}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { onEditObject?.(object); setPrompt(""); setChoice(undefined); }}>
              <span>{matchesEdit?.[1] ? `${object.owner}.${object.name}` : object.name}</span><span>{object.object_type}</span>
            </div>)}
          </div>}
        </form>

      </div>
    </section>
  );

}
