import { useEffect, useState } from "react";
import { m } from "motion/react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { EASE, SPRING } from "../../lib/motion";
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
    <m.div
      className={styles.overlay}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.18 } }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
    >
      {/* The card is "picked up": it swings in tilted and settles at a slight angle. */}
      <m.div
        className={styles.panel}
        initial={{ rotate: -14, y: 60, scale: 0.92 }}
        animate={{ rotate: -3, y: 0, scale: 1, transition: SPRING.panel }}
        exit={{ rotate: 4, y: 30, opacity: 0, transition: { duration: 0.18, ease: EASE.in } }}
      >
        <div className={styles.icon}>3.0 — Add to collection</div>
        <div className={styles.title}>Drop to number them</div>
        <div className={styles.hint}>EPUB and PDF files, or whole folders</div>
      </m.div>
    </m.div>
  );
}
