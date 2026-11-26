import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true" && el.tabIndex >= 0,
  );
}

/** Mantiene Tab/Shift+Tab dentro del diálogo, cierra con Escape y devuelve el foco al desmontar. */
export function useFocusTrap(
  onClose?: () => void,
  initialFocus?: RefObject<HTMLElement | null>,
) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Capturar antes del commit para no quedar atrapado detrás de `autoFocus`.
  const previousRef = useRef<Element | null | undefined>(undefined);
  if (previousRef.current === undefined) {
    previousRef.current = typeof document !== "undefined" ? document.activeElement : null;
  }

  useEffect(() => {
    const root = ref.current;
    if (initialFocus?.current) {
      initialFocus.current.focus();
    } else if (root && !root.contains(document.activeElement)) {
      focusableElements(root)[0]?.focus();
    }
    return () => {
      const previous = previousRef.current;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [initialFocus]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      if (!closeRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
      return;
    }
    if (event.key !== "Tab" || !ref.current) return;
    const items = focusableElements(ref.current);
    if (!items.length) {
      event.preventDefault();
      return;
    }
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey
      ? index <= 0
        ? items.length - 1
        : index - 1
      : index < 0 || index >= items.length - 1
        ? 0
        : index + 1;
    event.preventDefault();
    items[next].focus();
  };

  return { ref, onKeyDown };
}
