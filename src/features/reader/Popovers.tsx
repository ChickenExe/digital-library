/**
 * Small cards that float over the page: the selection menu, the highlight
 * editor and footnotes. They sit next to what they're about (above it if
 * there's room, else below) and use the reader's palette.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { m } from "motion/react";
import type { Annotation } from "../../bindings/Annotation";
import type { HighlightColor } from "../../bindings/HighlightColor";
import { EASE } from "../../lib/motion";
import { debounce } from "../../lib/format";
import { useAnnotations } from "./annotations";
import { HIGHLIGHTS, highlightInk } from "./settings";
import type { Footnote, Rect } from "./types";
import styles from "./Popovers.module.css";

const COLORS = Object.keys(HIGHLIGHTS) as HighlightColor[];
const MARGIN = 12;
const TOP_BAR = 56;

/** Positions its child beside `anchor` once it knows the child's size. */
function Floating(props: { anchor: Rect; gap?: number; className?: string; label: string; children: React.ReactNode }) {
  const { anchor, gap = 10 } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const above = anchor.top - gap - height;
    const below = above < TOP_BAR;
    const top = below
      ? Math.min(anchor.top + anchor.height + gap, window.innerHeight - height - MARGIN)
      : above;
    const left = Math.min(Math.max(MARGIN, anchor.left + anchor.width / 2 - width / 2), window.innerWidth - width - MARGIN);
    setPos({ left, top: Math.max(MARGIN, top), below });
  }, [anchor, gap]);
  return (
    <m.div
      ref={ref}
      role="dialog"
      aria-label={props.label}
      className={`${styles.float} ${props.className ?? ""}`}
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
      initial={{ opacity: 0, y: pos?.below ? -4 : 4 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.18, ease: EASE.out } }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
    >
      {props.children}
    </m.div>
  );
}

function Swatches({ value, dark, onPick }: { value?: HighlightColor; dark: boolean; onPick: (c: HighlightColor) => void }) {
  return (
    <div className={styles.swatches}>
      {COLORS.map((c) => (
        <button
          key={c}
          className={`${styles.swatch} ${value === c ? styles.on : ""}`}
          style={{ "--ink": highlightInk(c, dark).color } as React.CSSProperties}
          aria-label={`Highlight ${HIGHLIGHTS[c].label.toLowerCase()}`}
          aria-pressed={value === c}
          // Keep the page's selection alive while clicking.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(c)}
        />
      ))}
    </div>
  );
}

/** Shown over a fresh selection: highlight in a colour, add a note, or copy. */
export function SelectionMenu(props: {
  rect: Rect;
  dark: boolean;
  onHighlight: (color: HighlightColor) => void;
  onNote: () => void;
  onCopy: () => void;
}) {
  return (
    <Floating anchor={props.rect} label="Highlight" className={styles.menu}>
      <Swatches dark={props.dark} onPick={props.onHighlight} />
      <span className={styles.divider} />
      <button className={styles.action} onMouseDown={(e) => e.preventDefault()} onClick={props.onNote}>
        Note
      </button>
      <button className={styles.action} onMouseDown={(e) => e.preventDefault()} onClick={props.onCopy}>
        Copy
      </button>
    </Floating>
  );
}

/** Edit a highlight: change its colour, write a note, copy or delete it. */
export function AnnotationCard(props: { annotation: Annotation; rect: Rect; dark: boolean; focusNote?: boolean; onClose: () => void }) {
  const { annotation: a, onClose } = props;
  const update = useAnnotations((s) => s.update);
  const remove = useAnnotations((s) => s.remove);
  const [note, setNote] = useState(a.note ?? "");
  const saved = useRef(a.note ?? "");
  const save = useRef(
    debounce((id: string, text: string) => {
      if (text.trim() === saved.current.trim()) return;
      saved.current = text;
      void update(id, { note: text });
    }, 500),
  ).current;
  // Never lose a note: flush on close.
  const latest = useRef(note);
  latest.current = note;
  useEffect(() => () => save.flush(a.id, latest.current), [a.id, save]);

  return (
    <>
      <div className={styles.scrim} onClick={onClose} />
      <Floating anchor={props.rect} label="Highlight" className={styles.card}>
        <div className={styles.cardHead}>
          <Swatches value={a.color} dark={props.dark} onPick={(color) => void update(a.id, { color })} />
          <div className={styles.cardTools}>
            <button className={styles.action} onClick={() => void navigator.clipboard?.writeText(a.quote)}>
              Copy
            </button>
            <button
              className={`${styles.action} ${styles.danger}`}
              onClick={() => {
                void remove(a.id);
                onClose();
              }}
            >
              Delete
            </button>
          </div>
        </div>
        <textarea
          className={styles.noteInput}
          value={note}
          placeholder="Add a note…"
          autoFocus={props.focusNote}
          rows={note.length > 120 ? 6 : 3}
          onChange={(e) => {
            setNote(e.target.value);
            save(a.id, e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              onClose();
            }
          }}
        />
      </Floating>
    </>
  );
}

/** A footnote, citation or link target shown in place. */
export function FootnoteCard({ note, onClose }: { note: Footnote; onClose: () => void }) {
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    el.replaceChildren();
    const cleanup = note.render(el);
    if (!el.childNodes.length) el.textContent = "This note is empty.";
    return () => {
      if (typeof cleanup === "function") cleanup();
    };
  }, [note]);
  return (
    <>
      <div className={styles.scrim} onClick={onClose} />
      <Floating anchor={note.rect} label={note.label} className={`${styles.card} ${styles.footnote}`}>
        <div className={styles.label}>{note.label}</div>
        <div ref={body} className={note.kind === "link" ? styles.previewBody : styles.noteBody} />
        <button
          className={styles.go}
          onClick={() => {
            note.go();
            onClose();
          }}
        >
          {note.kind === "link" ? `Go to ${note.label.toLowerCase()} →` : note.kind === "citation" ? "Go to reference →" : "Go to note →"}
        </button>
      </Floating>
    </>
  );
}
