import { create } from "zustand";
import { flushSync } from "react-dom";
import type { MouseEvent as ReactMouseEvent } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "az-theme";
const REVEAL_CLASS = "az-theme-reveal";
const DEFAULT_THEME: Theme = "dark";

function readStoredTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_THEME;
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage unavailable */
  }
}

type ToggleEvent = ReactMouseEvent<HTMLElement> | MouseEvent;

/**
 * Theme swap with the Est8Core-style circular reveal: the new theme grows
 * out of the toggle button as an expanding circle (View Transitions API).
 * Falls back to an instant swap for reduced motion or missing API support.
 */
function revealTheme(update: () => void, event?: ToggleEvent) {
  if (typeof document === "undefined") {
    update();
    return;
  }
  const root = document.documentElement;
  const target = event?.currentTarget;
  const rect =
    target instanceof HTMLElement ? target.getBoundingClientRect() : null;
  const nativeEvent =
    event && "nativeEvent" in event ? event.nativeEvent : event;
  const point =
    nativeEvent && nativeEvent.detail > 0
      ? { x: nativeEvent.clientX, y: nativeEvent.clientY }
      : rect
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : null;
  if (
    !point ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    typeof document.startViewTransition !== "function"
  ) {
    update();
    return;
  }
  const { x, y } = point;
  const radius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );
  root.classList.add(REVEAL_CLASS);
  let transition;
  try {
    transition = document.startViewTransition(update);
  } catch {
    root.classList.remove(REVEAL_CLASS);
    update();
    return;
  }
  const cleanup = () => root.classList.remove(REVEAL_CLASS);
  transition.finished.then(cleanup, cleanup);
  transition.ready
    .then(() => {
      root.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${radius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 1000,
          easing: "ease-in-out",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    })
    .catch(() => undefined);
  transition.updateCallbackDone.catch(() => undefined);
}

export const useTheme = create<{
  theme: Theme;
  toggleTheme: (event?: ToggleEvent) => void;
  setTheme: (theme: Theme) => void;
}>((set, get) => ({
  theme: readStoredTheme(),
  toggleTheme: (event) => {
    const next: Theme = get().theme === "light" ? "dark" : "light";
    revealTheme(
      () =>
        flushSync(() => {
          applyTheme(next);
          set({ theme: next });
        }),
      event,
    );
  },
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
}));
