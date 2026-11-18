import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import type { HighlightColor } from "../../bindings/HighlightColor";
import { api, errorMessage } from "../../lib/api";
import { authorLine, debounce } from "../../lib/format";
import { EASE } from "../../lib/motion";
import { useLibrary, type Origin, type ReaderTarget } from "../../store/library";
import { useDiscover } from "../../store/discover";
import { ReaderSettingsPanel } from "./ReaderSettingsPanel";
import { ContentsPanel, type TocItem } from "./ContentsPanel";
import { NotesPanel } from "./NotesPanel";
import { AnnotationCard, FootnoteCard, SelectionMenu } from "./Popovers";
import { WindowControls } from "../shell/WindowControls";
import { useAnnotations } from "./annotations";
import { closeDoc, openDoc, ownerRef, saveDocProgress, type ReaderDoc } from "./doc";
import { isThemeId, THEMES, useEffectiveTheme, useReaderSettings } from "./settings";
import type { EngineProps, Footnote, ProgressHandler, ReadingInfo, Rect, SelectionDraft } from "./types";
import styles from "./ReaderView.module.css";

// Each reader pulls in a large rendering engine; load them on demand.
const EpubReader = lazy(() => import("./EpubReader").then((m) => ({ default: m.EpubReader })));
const PdfReader = lazy(() => import("./PdfReader").then((m) => ({ default: m.PdfReader })));

export type { ProgressHandler, ReadingInfo };

const HIDE_AFTER_MS = 2600;

type Panel = "contents" | "notes" | "settings" | null;

/** A clip-path that frames exactly the rectangle the book was opened from. */
function insetFor(o: Origin | null, radius: number): string {
  if (!o) return `inset(18% 26% 18% 26% round ${radius}px)`;
  const right = Math.max(0, window.innerWidth - (o.left + o.width));
  const bottom = Math.max(0, window.innerHeight - (o.top + o.height));
  return `inset(${o.top}px ${right}px ${bottom}px ${o.left}px round ${radius}px)`;
}

type Props = { target: ReaderTarget; origin: Origin | null; readerTheme?: string };

/**
 * Distraction-free reading. Controls fade out while you read and come back
 * when the mouse moves; everything else is the page. Selecting text offers to
 * highlight it, notes open in place, and the Notes panel collects it all.
 */
export function ReaderView({ target, origin, readerTheme }: Props) {
  const closeReader = useLibrary((s) => s.closeReader);
  const toast = useLibrary((s) => s.toast);
  // A collection may open its books in its own palette (e.g. Holy Scripture → Vigil).
  const setSessionTheme = useReaderSettings((s) => s.setSessionTheme);
  useEffect(() => {
    setSessionTheme(isThemeId(readerTheme) ? readerTheme : null);
    return () => setSessionTheme(null);
  }, [readerTheme, setSessionTheme]);
  const themeId = useEffectiveTheme();
  const theme = THEMES[themeId];
  const [doc, setDoc] = useState<ReaderDoc | null>(null);
  const [percent, setPercent] = useState(0);
  const [info, setInfo] = useState<ReadingInfo>({});
  const [chrome, setChrome] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [contents, setContents] = useState<{ items: TocItem[]; go: (href: string) => void } | null>(null);
  const [selection, setSelection] = useState<SelectionDraft | null>(null);
  const [editing, setEditing] = useState<{ id: string; rect: Rect; focusNote?: boolean } | null>(null);
  const [footnote, setFootnote] = useState<Footnote | null>(null);
  const [keeping, setKeeping] = useState(false);
  const annotations = useAnnotations((s) => s.items);
  const addAnnotation = useAnnotations((s) => s.add);
  const goTo = useRef<((locator: string) => void) | null>(null);
  const onContents = useCallback((items: TocItem[], go: (href: string) => void) => setContents({ items, go }), []);
  // Load the (heavy) book engine only once the window has finished opening,
  // so parsing never steals frames from the expand animation.
  const [opened, setOpened] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const targetKind = target.kind;
  const targetId = target.id;
  const targetProvider = target.kind === "stream" ? target.provider : undefined;
  useEffect(() => {
    let cancelled = false;
    let loaded: ReaderDoc | null = null;
    const t: ReaderTarget = targetKind === "book" ? { kind: "book", id: targetId } : { kind: "stream", provider: targetProvider!, id: targetId };
    openDoc(t).then(
      (d) => {
        loaded = d;
        // Opened after we'd already left (StrictMode, or a fast close): let it go again.
        if (cancelled) return closeDoc(d.source);
        setDoc(d);
        setPercent(d.progress?.percent ?? 0);
        void useAnnotations.getState().load(ownerRef(d.owner)).catch((e) => console.warn("annotations", e));
      },
      (e) => {
        if (cancelled) return;
        toast(t.kind === "stream" ? `Couldn’t open this book: ${errorMessage(e)}` : errorMessage(e), "error");
        closeReader();
      },
    );
    return () => {
      cancelled = true;
      if (loaded) closeDoc(loaded.source);
      useAnnotations.getState().reset();
    };
  }, [targetKind, targetId, targetProvider, closeReader, toast]);

  // Progress is saved to whoever owns the book now (a streamed book can become a library book mid-read).
  const ownerRefCurrent = useRef(doc?.owner);
  ownerRefCurrent.current = doc?.owner;
  const lastProgress = useRef<{ locator: string; percent: number } | null>(null);
  const persist = useMemo(
    () =>
      debounce((locator: string, p: number) => {
        const owner = ownerRefCurrent.current;
        if (owner) saveDocProgress(owner, locator, p).catch((e) => console.warn("save progress", e));
      }, 600),
    [],
  );
  const onProgress = useCallback<ProgressHandler>(
    (locator, p, i) => {
      setPercent(p);
      if (i) setInfo(i);
      lastProgress.current = { locator, percent: p };
      persist(locator, p);
    },
    [persist],
  );

  // Auto-hiding chrome.
  const poke = useCallback(() => {
    setChrome(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setChrome(false), HIDE_AFTER_MS);
  }, []);
  useEffect(() => {
    poke();
    return () => clearTimeout(hideTimer.current);
  }, [poke]);

  // Escape peels back one layer at a time.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (footnote) setFootnote(null);
      else if (editing) setEditing(null);
      else if (selection) {
        selection.clear();
        setSelection(null);
      } else if (panel) setPanel(null);
      else closeReader();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeReader, panel, footnote, editing, selection]);

  const engine: EngineProps | null = doc && {
    doc,
    initialLocator: doc.progress?.locator,
    onProgress,
    onContents,
    annotations,
    onSelection: setSelection,
    onAnnotationClick: (id, rect) => {
      setSelection(null);
      setEditing({ id, rect });
    },
    onFootnote: setFootnote,
    onNavigator: (go) => (goTo.current = go),
  };

  const highlight = async (color: HighlightColor, withNote = false) => {
    const sel = selection;
    if (!sel) return;
    setSelection(null);
    sel.clear();
    try {
      const created = await addAnnotation({
        locator: sel.locator,
        quote: sel.quote,
        color,
        chapter: sel.chapter ?? info.chapter,
        position: sel.position,
      });
      if (created && withNote) setEditing({ id: created.id, rect: sel.rect, focusNote: true });
    } catch (e) {
      toast(`Couldn’t save highlight: ${errorMessage(e)}`, "error");
    }
  };

  /** Adds a streamed book to the library; its notes and place come along. */
  const keep = async () => {
    if (!doc || doc.owner.kind !== "stream" || keeping) return;
    const { provider, id } = doc.owner;
    setKeeping(true);
    try {
      const book = await api.catalogAcquire(provider, id);
      const owner = { kind: "library", bookId: book.id } as const;
      setDoc((d) => (d ? { ...d, owner } : d));
      ownerRefCurrent.current = owner;
      if (lastProgress.current) await saveDocProgress(owner, lastProgress.current.locator, lastProgress.current.percent).catch(() => {});
      await useAnnotations.getState().load(book.id);
      useDiscover.getState().noteOwned(provider, id, book.id);
      toast(`“${book.title}” is in your library`);
    } catch (e) {
      toast(`Couldn’t keep this book: ${errorMessage(e)}`, "error");
    } finally {
      setKeeping(false);
    }
  };

  const toggle = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p));
  const visible = chrome || !!panel;
  const timeLeft = info.minutesLeft !== undefined ? formatMinutes(info.minutesLeft) : null;
  const streaming = doc?.owner.kind === "stream";
  const editingAnnotation = editing && annotations.find((a) => a.id === editing.id);

  return (
    <m.div
      // The reader opens like a window out of the cover you clicked, and closes back into it.
      initial={{ clipPath: insetFor(origin, 4), opacity: origin ? 1 : 0 }}
      animate={{
        clipPath: "inset(0px 0px 0px 0px round 0px)",
        opacity: 1,
        // A window "lifting" off the shelf reads better with a symmetric ease than the house expo-out.
        transition: { duration: 0.6, ease: [0.7, 0, 0.2, 1] },
      }}
      exit={{
        clipPath: insetFor(origin, 4),
        opacity: origin ? [1, 1, 0] : 0,
        transition: { duration: 0.46, ease: EASE.inOut },
      }}
      onAnimationComplete={() => setOpened(true)}
      className={styles.reader}
      style={
        {
          "--r-bg": theme.bg,
          "--r-text": theme.text,
          "--r-muted": theme.muted,
          "--r-accent": theme.accent,
          // The reader's own palette decides light/dark, independent of the app theme
          // (and it must match the book iframe's, see settings.ts).
          colorScheme: theme.dark ? "dark" : "light",
        } as React.CSSProperties
      }
      onMouseMove={poke}
    >
      <header className={`${styles.bar} ${visible ? "" : styles.hidden}`} data-tauri-drag-region>
        <button className={styles.barButton} onClick={closeReader}>
          ← Back
        </button>
        <div className={styles.heading}>
          {streaming && <span className={styles.streamTag}>Reading on demand</span>}
          <span className={styles.title}>{doc?.title ?? ""}</span>
          {doc && <span className={styles.author}> · {authorLine(doc)}</span>}
        </div>
        <div className={styles.barTools}>
          {streaming && (
            <button className={`${styles.barButton} ${styles.keep}`} onClick={() => void keep()} disabled={keeping}>
              {keeping ? "Adding…" : "Keep · Free"}
            </button>
          )}
          {contents && contents.items.length > 1 && (
            <button
              className={`${styles.barButton} ${panel === "contents" ? styles.active : ""}`}
              onClick={() => toggle("contents")}
              aria-label="Contents"
            >
              Contents
            </button>
          )}
          {doc && (
            <button
              className={`${styles.barButton} ${panel === "notes" ? styles.active : ""}`}
              onClick={() => toggle("notes")}
              aria-label="Highlights and notes"
            >
              Notes{annotations.length > 0 && <span className={styles.count}>{annotations.length}</span>}
            </button>
          )}
          <button
            className={`${styles.barButton} ${panel === "settings" ? styles.active : ""}`}
            onClick={() => toggle("settings")}
            aria-label="Reading settings"
          >
            Aa
          </button>
        </div>
        <WindowControls className={styles.caption} />
      </header>

      <AnimatePresence>
        {panel === "contents" && contents && (
          <ContentsPanel
            key="contents"
            items={contents.items}
            current={info.chapter}
            onGo={(href) => {
              contents.go(href);
              setPanel(null);
            }}
            onClose={() => setPanel(null)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {panel === "notes" && doc && (
          <NotesPanel
            key="notes"
            title={doc.title}
            authors={doc.authors}
            dark={theme.dark}
            onGo={(locator) => goTo.current?.(locator)}
            onClose={() => setPanel(null)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {panel === "settings" && (
          <ReaderSettingsPanel
            key="settings"
            format={doc?.format ?? "epub"}
            stream={doc?.source.kind === "stream" ? doc.source.key : undefined}
            onClose={() => setPanel(null)}
          />
        )}
      </AnimatePresence>

      <div className={styles.stage}>
        <Suspense fallback={null}>
          {opened && engine && doc?.format === "epub" && <EpubReader {...engine} />}
          {opened && engine && doc?.format === "pdf" && <PdfReader {...engine} />}
        </Suspense>
      </div>

      <AnimatePresence>
        {selection && !editing && !footnote && (
          <SelectionMenu
            key="selection"
            rect={selection.rect}
            dark={theme.dark}
            onHighlight={(c) => void highlight(c)}
            onNote={() => void highlight("yellow", true)}
            onCopy={() => {
              void window.navigator.clipboard?.writeText(selection.quote);
              selection.clear();
              setSelection(null);
            }}
          />
        )}
        {editing && editingAnnotation && (
          <AnnotationCard
            key={`edit-${editing.id}`}
            annotation={editingAnnotation}
            rect={editing.rect}
            dark={theme.dark}
            focusNote={editing.focusNote}
            onClose={() => setEditing(null)}
          />
        )}
        {footnote && <FootnoteCard key="footnote" note={footnote} onClose={() => setFootnote(null)} />}
      </AnimatePresence>

      <footer className={`${styles.status} ${visible ? "" : styles.dim}`}>
        <span>{info.chapter ?? ""}</span>
        <span>
          {Math.round(percent * 100)}%{timeLeft && ` · ${timeLeft} left`}
        </span>
      </footer>
      <div className={styles.progress}>
        <i style={{ width: `${percent * 100}%` }} />
      </div>
    </m.div>
  );
}

function formatMinutes(m: number): string {
  if (m < 1) return "under a minute";
  if (m < 60) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60);
  const rest = Math.round(m % 60);
  return rest ? `${h} h ${rest} min` : `${h} h`;
}
