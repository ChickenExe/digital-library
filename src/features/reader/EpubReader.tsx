import { useEffect, useRef, useState } from "react";
import ePub, { type Book as EpubBook, type Rendition } from "epubjs";
import type { Book } from "../../bindings/Book";
import { fetchBookBytes } from "../../lib/api";
import type { ProgressHandler } from "./ReaderView";
import styles from "./Reader.module.css";

type Props = { book: Book; initialLocator?: string; onProgress: ProgressHandler };

export function EpubReader({ book, initialLocator, onProgress }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const rendition = useRef<Rendition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // Read through refs so changing callbacks don't re-open the book.
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const initial = useRef(initialLocator);

  useEffect(() => {
    let epub: EpubBook | undefined;
    let cancelled = false;

    (async () => {
      const data = await fetchBookBytes(book.id);
      if (cancelled || !host.current) return;
      epub = ePub(data);
      const r = epub.renderTo(host.current, {
        width: "100%",
        height: "100%",
        flow: "paginated",
        spread: "auto",
        allowScriptedContent: false,
      });
      rendition.current = r;
      r.themes.default({
        body: { "font-family": "Georgia, 'Iowan Old Style', serif", "line-height": "1.6" },
        "p, li": { "font-size": "1.05em" },
      });

      r.on("relocated", (loc: { start: { cfi: string; percentage?: number } }) => {
        const cfi = loc.start.cfi;
        const locs = epub?.locations;
        const percent = locs && locs.length() > 0 ? locs.percentageFromCfi(cfi) : (loc.start.percentage ?? 0);
        onProgressRef.current(cfi, percent);
      });
      // Arrow keys while focus is inside the book's iframe.
      r.on("keyup", (e: KeyboardEvent) => navigateKey(e, r));

      await r.display(initial.current || undefined);
      if (cancelled) return;
      setReady(true);
      // Percentages need a location map; generating it is slow on big books, so do it after first paint.
      await epub.ready;
      await epub.locations.generate(1600);
      if (!cancelled) r.reportLocation();
    })().catch((e) => !cancelled && setError(String(e?.message ?? e)));

    const onKey = (e: KeyboardEvent) => rendition.current && navigateKey(e, rendition.current);
    window.addEventListener("keyup", onKey);
    return () => {
      cancelled = true;
      window.removeEventListener("keyup", onKey);
      rendition.current = null;
      epub?.destroy();
    };
  }, [book.id]);

  if (error) return <div className={styles.error}>Couldn’t open this EPUB: {error}</div>;

  return (
    <div className={styles.epub}>
      <button className={styles.turnLeft} onClick={() => void rendition.current?.prev()} aria-label="Previous page">
        ‹
      </button>
      <div ref={host} className={styles.page} style={{ opacity: ready ? 1 : 0 }} />
      <button className={styles.turnRight} onClick={() => void rendition.current?.next()} aria-label="Next page">
        ›
      </button>
    </div>
  );
}

function navigateKey(e: KeyboardEvent, r: Rendition) {
  if (e.key === "ArrowLeft" || e.key === "PageUp") void r.prev();
  if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") void r.next();
}
