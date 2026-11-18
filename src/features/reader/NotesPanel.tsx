import { useState } from "react";
import { m } from "motion/react";
import { EASE, SPRING } from "../../lib/motion";
import { annotationsMarkdown, useAnnotations } from "./annotations";
import { highlightInk } from "./settings";
import styles from "./NotesPanel.module.css";

type Props = {
  title: string;
  authors: string[];
  dark: boolean;
  onGo: (locator: string) => void;
  onClose: () => void;
};

/** Every highlight and note in the book, in reading order. Slides in from the right. */
export function NotesPanel({ title, authors, dark, onGo, onClose }: Props) {
  const items = useAnnotations((s) => s.items);
  const [onlyNotes, setOnlyNotes] = useState(false);
  const [copied, setCopied] = useState(false);
  const shown = onlyNotes ? items.filter((a) => a.note) : items;
  const notes = items.filter((a) => a.note).length;

  return (
    <>
      <m.div className={styles.scrim} onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <m.aside
        className={styles.panel}
        aria-label="Highlights and notes"
        initial={{ x: "104%" }}
        animate={{ x: 0, transition: SPRING.panel }}
        exit={{ x: "104%", transition: { duration: 0.22, ease: EASE.in } }}
      >
        <div className={styles.head}>
          <span>Highlights &amp; notes</span>
          <span>{items.length}</span>
        </div>
        {items.length > 0 && (
          <div className={styles.tools}>
            <div className={styles.filter}>
              <button className={!onlyNotes ? styles.on : ""} onClick={() => setOnlyNotes(false)}>
                All
              </button>
              <button className={onlyNotes ? styles.on : ""} onClick={() => setOnlyNotes(true)}>
                Notes · {notes}
              </button>
            </div>
            <button
              className={styles.copy}
              onClick={() => {
                void navigator.clipboard?.writeText(annotationsMarkdown(title, authors, shown)).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                });
              }}
            >
              {copied ? "Copied ✓" : "Copy as Markdown"}
            </button>
          </div>
        )}
        {shown.length === 0 ? (
          <p className={styles.empty}>
            {items.length === 0
              ? "Select any passage to highlight it or add a note. Everything you mark collects here."
              : "No notes yet. Click a highlight to write one."}
          </p>
        ) : (
          <ol className={styles.list}>
            {shown.map((a) => (
              <li key={a.id}>
                <button
                  onClick={() => {
                    onGo(a.locator);
                    onClose();
                  }}
                  style={{ "--ink": highlightInk(a.color, dark).color } as React.CSSProperties}
                >
                  <span className={styles.meta}>
                    {a.chapter ?? "—"} · {Math.round(a.position * 100)}%
                  </span>
                  <span className={styles.quote}>{a.quote}</span>
                  {a.note && <span className={styles.note}>{a.note}</span>}
                </button>
              </li>
            ))}
          </ol>
        )}
      </m.aside>
    </>
  );
}
