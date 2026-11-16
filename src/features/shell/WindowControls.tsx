import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PLATFORM } from "../../lib/platform";
import styles from "./WindowControls.module.css";

/**
 * Caption buttons for the frameless Windows window, drawn in the Index style:
 * hairline glyphs, square hit targets in the corner (where Fitts's law wants
 * them), and the close button turns signal red. Renders nothing elsewhere.
 */
export function WindowControls({ className }: { className?: string }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (PLATFORM !== "windows") return;
    const win = getCurrentWindow();
    const sync = () => void win.isMaximized().then(setMaximized).catch(() => {});
    sync();
    const off = win.onResized(sync);
    return () => void off.then((f) => f());
  }, []);

  if (PLATFORM !== "windows") return null;
  const win = getCurrentWindow();
  return (
    <div className={`${styles.controls} ${className ?? ""}`}>
      <button aria-label="Minimize" onClick={() => void win.minimize()}>
        <svg viewBox="0 0 10 10">
          <path d="M0 5.5h10" />
        </svg>
      </button>
      <button aria-label={maximized ? "Restore" : "Maximize"} onClick={() => void win.toggleMaximize()}>
        <svg viewBox="0 0 10 10">
          {maximized ? <path d="M2.5 0.5h7v7M0.5 2.5h7v7h-7z" /> : <path d="M0.5 0.5h9v9h-9z" />}
        </svg>
      </button>
      <button aria-label="Close" className={styles.close} onClick={() => void win.close()}>
        <svg viewBox="0 0 10 10">
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
        </svg>
      </button>
    </div>
  );
}
