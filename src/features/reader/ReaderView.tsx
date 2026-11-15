import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { Book } from "../../bindings/Book";
import { api, errorMessage } from "../../lib/api";
import { authorLine, debounce, percentLabel } from "../../lib/format";
import { useLibrary } from "../../store/library";

// Each reader pulls in a large rendering engine; load them on demand.
const EpubReader = lazy(() => import("./EpubReader").then((m) => ({ default: m.EpubReader })));
const PdfReader = lazy(() => import("./PdfReader").then((m) => ({ default: m.PdfReader })));
import styles from "./ReaderView.module.css";

/** Readers report position through this; we persist it (debounced) to SQLite. */
export type ProgressHandler = (locator: string, percent: number) => void;

export function ReaderView({ bookId }: { bookId: string }) {
  const closeReader = useLibrary((s) => s.closeReader);
  const toast = useLibrary((s) => s.toast);
  const [book, setBook] = useState<Book | null>(null);
  const [percent, setPercent] = useState(0);

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
    (locator, p) => {
      setPercent(p);
      persist(locator, p);
    },
    [persist],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeReader();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeReader]);

  return (
    <div className={styles.reader}>
      <header className={styles.bar}>
        <button className="btn" onClick={closeReader}>
          ← Library
        </button>
        <div className={styles.heading}>
          <div className={styles.title}>{book?.title ?? ""}</div>
          {book && <div className={styles.author}>{authorLine(book)}</div>}
        </div>
        <div className={styles.percent}>{percentLabel(percent)}</div>
      </header>
      <div className={styles.progress}>
        <div className={styles.progressFill} style={{ width: percentLabel(percent) }} />
      </div>
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
    </div>
  );
}
