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
  const [question, setQuestion] = useState<string | null>(null);
  const answer = useRef<{ resolve: (value: string | null) => void; draft: string } | null>(null);
  useEffect(() => () => {
    answer.current?.resolve(null);
    answer.current = null;
  }, []);
  const io: ConsoleIo = {
    ask: (name) => new Promise((resolve) => {
      answer.current = { resolve, draft: commandInput.current?.value ?? "" };
      setQuestion(name);
      setPrompt("");
      if (active) commandInput.current?.focus({ preventScroll: true });
    }),
  };
  function finishQuestion(value: string | null) {
    if (!answer.current) return;
    const pending = answer.current;
    answer.current = null;
    setQuestion(null);
    setPrompt(pending.draft);
    pending.resolve(value);
  }
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
  const matchesEdit = question || commandLines.length ? null : prompt.trim().match(editTarget);
  const candidates = matchesEdit && suggestions?.prompt === prompt && !dismissed ? suggestions.items : [];
  const exact = candidates.findIndex((object) => object.name === matchesEdit?.[2].toUpperCase());
  const picked = choice ?? Math.max(0, exact);
  useLayoutEffect(() => {
    const area = terminal.current;
    if (area && followOutput.current) area.scrollTop = area.scrollHeight;
  }, [lines, commandLines, running, suggestions, dismissed, prompt]);
  useEffect(() => {
    const target = prompt.trim().match(editTarget);
    if (question || commandLines.length || !target) return;
    let current = true;
    const timer = setTimeout(() => {
      void api.completeObjects(sessionId, target[1]?.toUpperCase() ?? null, target[2].toUpperCase(), null, "edit")
        .then((items) => { if (current) setSuggestions({ prompt, items }); })
        .catch(() => { if (current) setSuggestions(undefined); });
    }, 120);
    return () => { current = false; clearTimeout(timer); };
  }, [commandLines.length, prompt, question, sessionId]);
  const commandHistory = useRef<string[]>([]);
  const historyIndex = useRef(0);
  const draft = useRef("");
  function remember(source: string) {
    const history = commandHistory.current;
    if (history[history.length - 1] !== source) history.push(source);
    historyIndex.current = history.length;
    draft.current = "";
  }

  const [queue, setQueue] = useState<{ entered: string; selected?: CompletionObject }[]>([]);
  const [processing, setProcessing] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  function enqueue(entered: string, selected?: CompletionObject) {
    setQueue((items) => [...items, { entered, selected }]);
  }

  async function processLine({ entered, selected }: (typeof queue)[number]) {
    const trimmed = entered.trim();
    if (!trimmed && !commandLines.length) return;
    if (!commandLines.length && editCommand.test(trimmed)) {
      remember(entered);
      log("info", `SQL> ${entered}`);
      const target = trimmed.match(editTarget);
      if (!target || !onEditObject) {
        log("error", "Usa EDIT [esquema.]objeto.");
        return;
      }
      try {
        const name = target[2].toUpperCase();
        const items = selected ? [selected] : await api.completeObjects(
          sessionId, target[1]?.toUpperCase() ?? null, name, null, "edit",
        );
        const object = selected ?? items.find((item) => item.name === name) ?? items[0];
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
  }

  useEffect(() => {
    const next = queue[0];
    if (!next || processing || running) return;
    setProcessing(true);
    setQueue((items) => items.slice(1));
    void processLine(next).catch((error) => log("error", describeError(error).message))
      .finally(() => setProcessing(false));
  });

  useEffect(() => {
    if (!running) { setElapsed(0); return; }
    const start = Date.now();
    const tick = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => window.clearInterval(tick);
  }, [running]);

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
        {running && <div role="status" className="sql-line">Ejecutando {elapsed} s · {key()} para detener</div>}
        <form className="sql-command-prompt" onSubmit={(event) => {
          event.preventDefault();
          if (answer.current) {
            finishQuestion(prompt);
            return;
          }
          if (!prompt.trim()) return;
          enqueue(prompt, candidates[picked]);
          setPrompt("");
          setChoice(undefined);
          setDismissed(false);
        }}>
          <label htmlFor={`${tabPrefix}-prompt`} className="mono">{question !== null
            ? `Ingrese valor para ${question}:`
            : commandLines.length ? String(commandLines.length + 1).padStart(3) : "SQL>"}</label>
          <textarea ref={commandInput} id={`${tabPrefix}-prompt`} rows={1} className="mono" aria-label="Comando SQL"
            role={matchesEdit ? "combobox" : undefined} aria-autocomplete={matchesEdit ? "list" : undefined}
            aria-expanded={matchesEdit ? !!candidates.length : undefined}
            aria-controls={candidates.length ? `${tabPrefix}-objects` : undefined}
            aria-activedescendant={candidates.length ? `${tabPrefix}-object-${picked}` : undefined}
            value={prompt}
            onChange={(event) => { setPrompt(event.target.value); setChoice(undefined); setDismissed(false); }}
            onPaste={(event) => {
              const text = event.clipboardData.getData("text/plain");
              if (question !== null || !/[\r\n]/.test(text)) return;
              event.preventDefault();
              const input = event.currentTarget;
              const combined = input.value.slice(0, input.selectionStart) + text + input.value.slice(input.selectionEnd);
              const entries = combined.replace(/(?:\r\n|\r|\n)$/, "").split(/\r\n|\r|\n/);
              setQueue((items) => [...items, ...entries.map((entered) => ({ entered }))]);
              setPrompt("");
              setChoice(undefined);
              setDismissed(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
                return;
              }
              if (question !== null) {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  finishQuestion(null);
                }
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
