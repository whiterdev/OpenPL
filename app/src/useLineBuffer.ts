import { useCallback, useEffect, useRef, useState } from "react";

export function useLineBuffer<T>(cap: number) {
  const buffer = useRef<T[]>([]);
  const omitted = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<{ lines: T[]; omitted: number }>({ lines: [], omitted: 0 });

  const stopTimer = useCallback(() => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  const flush = useCallback(() => {
    stopTimer();
    const overflow = Math.max(0, buffer.current.length - cap);
    if (overflow) {
      buffer.current.splice(0, overflow);
      omitted.current += overflow;
    }
    setSnapshot({ lines: buffer.current.slice(), omitted: omitted.current });
  }, [cap, stopTimer]);
  const append = useCallback((line: T) => {
    buffer.current.push(line);
    if (buffer.current.length >= cap + 1000) {
      buffer.current.splice(0, 1000);
      omitted.current += 1000;
    }
    timer.current ??= setTimeout(flush, 100);
  }, [cap, flush]);
  const clear = useCallback(() => {
    stopTimer();
    buffer.current = [];
    omitted.current = 0;
    setSnapshot({ lines: [], omitted: 0 });
  }, [stopTimer]);

  useEffect(() => stopTimer, [stopTimer]);
  return { ...snapshot, append, flush, clear };
}
