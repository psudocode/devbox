import { useCallback, useEffect, useRef, useState } from "react";
import { parseHash } from "./router";
import { resolveInitialState, saveToolState } from "./toolState";

function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * State for a tool that survives reloads (localStorage) and can be shared via the URL hash.
 * Initial value: shared URL state > last saved input > `defaultValue`.
 * `defaultValue` should be a stable constant; its shape is used to validate stored/shared data.
 */
export function useToolState<T>(toolId: string, defaultValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const defaults = useRef(defaultValue);
  const [state, setState] = useState<T>(() => {
    const route = parseHash(window.location.hash);
    const shared = route.name === "tool" && route.toolId === toolId ? route.state : undefined;
    return resolveInitialState(toolId, defaults.current, shared, safeLocalStorage());
  });

  // Debounced save so typing in a large textarea doesn't hammer localStorage.
  useEffect(() => {
    const timer = window.setTimeout(() => saveToolState(safeLocalStorage(), toolId, state), 300);
    return () => window.clearTimeout(timer);
  }, [toolId, state]);

  const set = useCallback((value: T | ((prev: T) => T)) => setState(value), []);
  return [state, set];
}
