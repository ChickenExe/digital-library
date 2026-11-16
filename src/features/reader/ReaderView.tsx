import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Book } from "../../bindings/Book";
import { api, errorMessage } from "../../lib/api";
import { authorLine, debounce } from "../../lib/format";
import { useLibrary } from "../../store/library";
import { ReaderSettingsPanel } from "./ReaderSettingsPanel";
import { THEMES, useReaderSettings } from "./settings";
import styles from "./ReaderView.module.css";

// Each reader pulls in a large rendering engine; load them on demand.
const EpubReader = lazy(() => import("./EpubReader").then((m) => ({ default: m.EpubReader })));
const PdfReader = lazy(() => import("./PdfReader").then((m) => ({ default: m.PdfReader })));

export type ReadingInfo = { chapter?: string; minutesLeft?: number };
/** Readers report position through this; we persist it (debounced) to SQLite. */
export type ProgressHandler = (locator: string, percent: number, info?: ReadingInfo) => void;

const HIDE_AFTER_MS = 2600;

/**
 * Distraction-free reading. Controls fade out while you read and come back
 * when the mouse moves; everything else is the page.
 */
export function ReaderView({ bookId }: { bookId: string }) {
  const closeReader = useLibrary((s) => s.closeReader);
  const toast = useLibrary((s) => s.toast);
  const themeId = useReaderSettings((s) => s.theme);
  const theme = THEMES[themeId];
  const [book, setBook] = useState<Book | null>(null);
  const [percent, setPercent] = useState(0);
  const [info, setInfo] = useState<ReadingInfo>({});
  const [chrome, setChrome] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
      if (settingsOpen) setSettingsOpen(false);
      else closeReader();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeReader, settingsOpen]);

  const visible = chrome || settingsOpen;
  const timeLeft = info.minutesLeft !== undefined ? formatMinutes(info.minutesLeft) : null;

  return (
    <div
      className={styles.reader}
      style={
        {
          "--r-bg": theme.bg,
          "--r-text": theme.text,
          "--r-muted": theme.muted,
          "--r-accent": theme.accent,
        } as React.CSSProperties
      }
      onMouseMove={poke}
    >
      <header className={`${styles.bar} ${visible ? "" : styles.hidden}`}>
        <button className={styles.barButton} onClick={closeReader}>
          ← Back
        </button>
        <div className={styles.heading}>
          <span className={styles.title}>{book?.title ?? ""}</span>
          {book && <span className={styles.author}> · {authorLine(book)}</span>}
        </div>
        <button
          className={`${styles.barButton} ${settingsOpen ? styles.active : ""}`}
          onClick={() => setSettingsOpen((o) => !o)}
          aria-label="Reading settings"
        >
          Aa
        </button>
      </header>

      {settingsOpen && <ReaderSettingsPanel format={book?.format ?? "epub"} onClose={() => setSettingsOpen(false)} />}

      <div className={styles.stage}>
        <Suspense fallback={null}>
          {book?.format === "epub" && (
            <EpubReader book={book} initialLocator={book.progress?.locator} onProgress={onProgress} />
          )}
          {book?.format === "pdf" && (
            <PdfReader book={book} initialLocator={book.progress?.locator} onProgress={onProgress} />
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
    </div>
  );
}

function formatMinutes(m: number): string {
  if (m < 1) return "under a minute";
  if (m < 60) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60);
  const rest = Math.round(m % 60);
  return rest ? `${h} h ${rest} min` : `${h} h`;
}
