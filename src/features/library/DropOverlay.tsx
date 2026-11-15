import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import styles from "./DropOverlay.module.css";

export function useDragState() {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const off = getCurrentWebview().onDragDropEvent((e) => {
      setDragging(e.payload.type === "enter" || e.payload.type === "over");
    });
    return () => void off.then((f) => f());
  }, []);
  return dragging;
}

export function DropOverlay() {
  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        <div className={styles.icon}>＋</div>
        <div className={styles.title}>Drop to add to your library</div>
        <div className={styles.hint}>EPUB and PDF files, or whole folders</div>
      </div>
    </div>
  );
}
