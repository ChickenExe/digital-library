import { AnimatePresence, motion } from "motion/react";
import { EASE, SPRING } from "../../lib/motion";
import { useLibrary } from "../../store/library";
import styles from "./Toasts.module.css";

export function Toasts() {
  const toasts = useLibrary((s) => s.toasts);
  const importing = useLibrary((s) => s.importing);
  const dismiss = useLibrary((s) => s.dismissToast);
  return (
    <div className={styles.stack} aria-live="polite">
      <AnimatePresence mode="popLayout">
      {importing && (
        <motion.div key="importing" className={styles.toast} {...toastMotion}>
          <div>
            Importing {Math.min(importing.done + 1, importing.total)} of {importing.total}
            {importing.current && <span className={styles.muted}> · {importing.current}</span>}
          </div>
          <div className={styles.bar}>
            <div
              className={styles.fill}
              style={{ width: `${(importing.done / Math.max(importing.total, 1)) * 100}%` }}
            />
          </div>
        </motion.div>
      )}
      {toasts.map((t) => (
        <motion.button
          key={t.id}
          className={`${styles.toast} ${t.tone === "error" ? styles.error : ""}`}
          onClick={() => dismiss(t.id)}
          {...toastMotion}
        >
          {t.text}
        </motion.button>
      ))}
      </AnimatePresence>
    </div>
  );
}

/** Toasts rise in from the corner and slide out to the right; the stack re-flows smoothly. */
const toastMotion = {
  layout: true,
  initial: { opacity: 0, y: 24, scale: 0.96 },
  animate: { opacity: 1, y: 0, scale: 1, transition: SPRING.panel },
  exit: { opacity: 0, x: 60, transition: { duration: 0.2, ease: EASE.in } },
} as const;
