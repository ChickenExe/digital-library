/**
 * Which desktop chrome we're drawing:
 * - windows: frameless window; we draw the caption buttons (and Mica on Windows 11)
 * - macos:   native traffic lights overlaid on our header
 * - linux:   native window frame
 * `VITE_FORCE_PLATFORM` lets you preview another platform's chrome in development.
 */
import { invoke } from "@tauri-apps/api/core";

export type Platform = "windows" | "macos" | "linux";

const ua = navigator.userAgent;
export const PLATFORM: Platform =
  (import.meta.env.VITE_FORCE_PLATFORM as Platform | undefined) ??
  (ua.includes("Windows") ? "windows" : ua.includes("Mac") ? "macos" : "linux");

/** Tag <html> with the platform and window material so CSS can adapt. */
export function initPlatform() {
  const root = document.documentElement;
  root.dataset.platform = PLATFORM;
  invoke<string>("window_material")
    .then((material) => (root.dataset.material = material))
    .catch(() => {});
}
