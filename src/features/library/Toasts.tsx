import { useLibrary } from "../../store/library";
import styles from "./Toasts.module.css";

export function Toasts() {
  const toasts = useLibrary((s) => s.toasts);
  const importing = useLibrary((s) => s.importing);
  const dismiss = useLibrary((s) => s.dismissToast);
  return (
    <div className={styles.stack} aria-live="polite">
      {importing && (
        <div className={styles.toast}>
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
        </div>
      )}
      {toasts.map((t) => (
        <button
          key={t.id}
          className={`${styles.toast} ${t.tone === "error" ? styles.error : ""}`}
          onClick={() => dismiss(t.id)}
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}
