/**
 * App colour theme: System / Light / Dark. Applied as `data-theme` on <html>
 * (tokens.css swaps the palette) and mirrored to the native window, so the
 * title bar and Windows' Mica material follow it.
 */
import { create } from "zustand";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type ThemePref = "system" | "light" | "dark";
const KEY = "folio.theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");

const readPref = (): ThemePref => {
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" ? v : "system";
};
const resolve = (pref: ThemePref): "light" | "dark" => (pref === "system" ? (media.matches ? "dark" : "light") : pref);

function apply(pref: ThemePref, animate: boolean) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add("theme-switching");
    window.setTimeout(() => root.classList.remove("theme-switching"), 380);
  }
  root.dataset.theme = resolve(pref);
  // Native chrome follows (null = follow the OS). Best effort: not every platform supports it.
  void getCurrentWindow()
    .setTheme(pref === "system" ? null : pref)
    .catch(() => {});
}

type ThemeStore = { pref: ThemePref; resolved: "light" | "dark"; cycle: () => void };

const ORDER: ThemePref[] = ["system", "light", "dark"];

export const useTheme = create<ThemeStore>((set, get) => ({
  pref: readPref(),
  resolved: resolve(readPref()),
  cycle: () => {
    const pref = ORDER[(ORDER.indexOf(get().pref) + 1) % ORDER.length];
    localStorage.setItem(KEY, pref);
    apply(pref, true);
    set({ pref, resolved: resolve(pref) });
  },
}));

/** Call once before the first render, so there's no flash of the wrong theme. */
export function initTheme() {
  apply(readPref(), false);
  media.addEventListener("change", () => {
    const { pref } = useTheme.getState();
    if (pref !== "system") return;
    apply(pref, true);
    useTheme.setState({ resolved: resolve(pref) });
  });
}
