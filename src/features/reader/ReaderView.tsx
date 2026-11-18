import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import type { Book } from "../../bindings/Book";
import { api, errorMessage } from "../../lib/api";
import { authorLine, debounce } from "../../lib/format";
import { EASE } from "../../lib/motion";
import { useLibrary, type Origin } from "../../store/library";
import { ReaderSettingsPanel } from "./ReaderSettingsPanel";
import { ContentsPanel, type TocItem } from "./ContentsPanel";
import { WindowControls } from "../shell/WindowControls";
import { isThemeId, THEMES, useEffectiveTheme, useReaderSettings } from "./settings";
import styles from "./ReaderView.module.css";

// Each reader pulls in a large rendering engine; load them on demand.
const EpubReader = lazy(() => import("./EpubReader").then((m) => ({ default: m.EpubReader })));
const PdfReader = lazy(() => import("./PdfReader").then((m) => ({ default: m.PdfReader })));
const FoliateReader = lazy(() => import("./FoliateReader").then((m) => ({ default: m.FoliateReader })));

export type ReadingInfo = { chapter?: string; minutesLeft?: number };
/** Readers report position through this; we persist it (debounced) to SQLite. */
export type ProgressHandler = (locator: string, percent: number, info?: ReadingInfo) => void;

const HIDE_AFTER_MS = 2600;

/**
 * Distraction-free reading. Controls fade out while you read and come back
 * when the mouse moves; everything else is the page.
 */
/** A clip-path that frames exactly the rectangle the book was opened from. */
function insetFor(o: Origin | null, radius: number): string {
  if (!o) return `inset(18% 26% 18% 26% round ${radius}px)`;
  const right = Math.max(0, window.innerWidth - (o.left + o.width));
  const bottom = Math.max(0, window.innerHeight - (o.top + o.height));
  return `inset(${o.top}px ${right}px ${bottom}px ${o.left}px round ${radius}px)`;
}

type Props = { bookId: string; origin: Origin | null; readerTheme?: string };

export function ReaderView({ bookId, origin, readerTheme }: Props) {
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
  const [book, setBook] = useState<Book | null>(null);
  const [percent, setPercent] = useState(0);
  const [info, setInfo] = useState<ReadingInfo>({});
  const [chrome, setChrome] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [contents, setContents] = useState<{ items: TocItem[]; go: (href: string) => void } | null>(null);
  const [contentsOpen, setContentsOpen] = useState(false);
  const onContents = useCallback((items: TocItem[], go: (href: string) => void) => setContents({ items, go }), []);
  // Load the (heavy) book engine only once the window has finished opening,
  // so parsing never steals frames from the expand animation.
  const [opened, setOpened] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    api.getBook(bookId).then(
      (b) => {
        setBook(b);
        setPercent(b.progress?.percent ?? 0);
      },
      (e) => {
        toast(errorMessage(e), "error");
        closeReader();
      },
    );
  }, [bookId, closeReader, toast]);

  const persist = useMemo(
    () =>
      debounce((locator: string, p: number) => {
        api.saveProgress(bookId, locator, p).catch((e) => console.warn("save progress", e));
      }, 600),
    [bookId],
  );

  const onProgress = useCallback<ProgressHandler>(
    (locator, p, i) => {
      setPercent(p);
      if (i) setInfo(i);
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (contentsOpen) setContentsOpen(false);
      else if (settingsOpen) setSettingsOpen(false);
      else closeReader();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeReader, settingsOpen, contentsOpen]);

  const visible = chrome || settingsOpen || contentsOpen;
  const timeLeft = info.minutesLeft !== undefined ? formatMinutes(info.minutesLeft) : null;

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
          <span className={styles.title}>{book?.title ?? ""}</span>
          {book && <span className={styles.author}> · {authorLine(book)}</span>}
        </div>
        <div className={styles.barTools}>
          {contents && contents.items.length > 1 && (
            <button
              className={`${styles.barButton} ${contentsOpen ? styles.active : ""}`}
              onClick={() => {
                setSettingsOpen(false);
                setContentsOpen((o) => !o);
              }}
              aria-label="Contents"
            >
              Contents
            </button>
          )}
          <button
            className={`${styles.barButton} ${settingsOpen ? styles.active : ""}`}
            onClick={() => {
              setContentsOpen(false);
              setSettingsOpen((o) => !o);
            }}
            aria-label="Reading settings"
          >
            Aa
          </button>
        </div>
        <WindowControls className={styles.caption} />
      </header>

      <AnimatePresence>
        {contentsOpen && contents && (
          <ContentsPanel
            key="contents"
            items={contents.items}
            current={info.chapter}
            onGo={(href) => {
              contents.go(href);
              setContentsOpen(false);
            }}
            onClose={() => setContentsOpen(false)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {settingsOpen && (
          <ReaderSettingsPanel
            key="settings"
            format={book?.format ?? "epub"}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </AnimatePresence>

      <div className={styles.stage}>
        <Suspense fallback={null}>
          {opened && book?.format === "epub" && (
            <EpubReader book={book} initialLocator={book.progress?.locator} onProgress={onProgress} onContents={onContents} />
          )}
          {opened && book?.format === "pdf" && (
            <PdfReader book={book} initialLocator={book.progress?.locator} onProgress={onProgress} />
          )}
          {opened && book && book.format !== "epub" && book.format !== "pdf" && (
            <FoliateReader book={book} initialLocator={book.progress?.locator} onProgress={onProgress} onContents={onContents} />
          )}
        </Suspense>
      </div>

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
