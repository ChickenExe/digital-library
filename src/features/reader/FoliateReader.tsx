import { useEffect, useMemo, useRef, useState } from "react";
import type { FoliateTocItem, FoliateView, RelocateDetail } from "foliate-js/view.js";
import type { Book } from "../../bindings/Book";
import { fetchBookBytes } from "../../lib/api";
import { prefersReducedMotion } from "../../lib/motion";
import type { ProgressHandler } from "./ReaderView";
import type { TocItem } from "./ContentsPanel";
import { epubCss, useEffectiveTheme, useReaderSettings, WIDTHS } from "./settings";
import styles from "./Reader.module.css";

type Props = {
  book: Book;
  initialLocator?: string;
  onProgress: ProgressHandler;
  onContents?: (items: TocItem[], go: (href: string) => void) => void;
};

/**
 * Kindle (MOBI/AZW3), FictionBook and comic archives, rendered by foliate-js.
 * Same props and behaviour as the EPUB reader: themed, paginated or scrolled,
 * position saved as a CFI.
 */
export function FoliateReader({ book, initialLocator, onProgress, onContents }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [fixed, setFixed] = useState(book.format === "cbz");

  const { font, size, leading, width, flow } = useReaderSettings();
  const theme = useEffectiveTheme();
  const css = useMemo(
    () => epubCss({ theme, font, size, leading, width, flow }),
    [theme, font, size, leading, width, flow],
  );
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const onContentsRef = useRef(onContents);
  onContentsRef.current = onContents;
  const cssRef = useRef(css);
  cssRef.current = css;
  const layoutRef = useRef({ flow, px: WIDTHS[width].px });
  layoutRef.current = { flow, px: WIDTHS[width].px };

  useEffect(() => {
    let cancelled = false;
    let view: FoliateView | null = null;
    const onKey = (e: KeyboardEvent) => {
      const v = viewRef.current;
      if (!v) return;
      if (e.key === "ArrowLeft" || e.key === "PageUp") void v.prev();
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") void v.next();
    };

    (async () => {
      await import("foliate-js/view.js"); // registers <foliate-view>
      const data = await fetchBookBytes(book.id);
      if (cancelled || !host.current) return;
      view = document.createElement("foliate-view") as FoliateView;
      view.style.cssText = "display:block;width:100%;height:100%";
      host.current.replaceChildren(view);
      viewRef.current = view;

      await view.open(new File([data], fileNameFor(book.format, data)));
      if (cancelled) return;
      setFixed(view.isFixedLayout);
      const r = view.renderer;
      if (!view.isFixedLayout) {
        applyLayout(r, layoutRef.current.flow, layoutRef.current.px);
        r.setStyles?.(cssRef.current);
      }

      view.addEventListener("load", (e) => {
        const doc = (e as CustomEvent<{ doc: Document }>).detail.doc;
        doc.addEventListener("keyup", onKey);
      });
      view.addEventListener("relocate", (e) => {
        const d = (e as CustomEvent<RelocateDetail>).detail;
        // Comics: the "chapters" are image file names and reading time is meaningless.
        const prose = !view?.isFixedLayout;
        onProgressRef.current(d.cfi, clamp01(d.fraction ?? 0), {
          chapter: prose ? d.tocItem?.label?.trim() || undefined : undefined,
          minutesLeft: prose ? d.time?.total : undefined,
        });
      });

      // A saved position that doesn't resolve falls back to the start inside init().
      await view.init({ lastLocation: initialLocator || null });
      if (cancelled) return;
      setReady(true);
      const toc = view.isFixedLayout ? [] : (view.book.toc ?? []);
      onContentsRef.current?.(withDepth(toc), (href) => void viewRef.current?.goTo(href));
    })().catch((e) => !cancelled && setError(String(e?.message ?? e)));

    window.addEventListener("keyup", onKey);
    return () => {
      cancelled = true;
      window.removeEventListener("keyup", onKey);
      viewRef.current = null;
      try {
        view?.close();
      } catch {
        /* already torn down */
      }
      view?.remove();
    };
    // initialLocator is only the starting point; later changes come from this reader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, book.format]);

  // Typography, theme, width and flow apply live; the paginator keeps the place.
  useEffect(() => {
    const v = viewRef.current;
    if (!v || !ready || v.isFixedLayout) return;
    applyLayout(v.renderer, flow, WIDTHS[width].px);
    v.renderer.setStyles?.(css);
  }, [css, flow, width, ready]);

  if (error) return <div className={styles.error}>Couldn’t open this book: {error}</div>;

  return (
    <div className={styles.epub}>
      <button className={styles.turn} onClick={() => void viewRef.current?.prev()} aria-label="Previous page">
        <span>←</span>
      </button>
      <div
        ref={host}
        className={`${styles.column} ${flow === "scrolled" && !fixed ? styles.scrolled : ""}`}
        style={{ maxWidth: fixed ? undefined : WIDTHS[width].px + 96, opacity: ready ? 1 : 0 }}
      />
      <button className={styles.turn} onClick={() => void viewRef.current?.next()} aria-label="Next page">
        <span>→</span>
      </button>
    </div>
  );
}

function applyLayout(r: HTMLElement, flow: string, px: number) {
  r.setAttribute("flow", flow === "scrolled" ? "scrolled" : "paginated");
  r.setAttribute("max-inline-size", `${px}px`);
  r.setAttribute("max-column-count", "1");
  r.setAttribute("margin", "0px");
  r.setAttribute("gap", "6%");
  if (!prefersReducedMotion()) r.setAttribute("animated", "");
}

/** foliate-js picks a parser by name (and magic bytes); give it a matching one. */
function fileNameFor(format: Book["format"], data: ArrayBuffer): string {
  const zipped = new Uint8Array(data, 0, Math.min(4, data.byteLength)).join() === "80,75,3,4";
  switch (format) {
    case "fb2":
      return zipped ? "book.fbz" : "book.fb2";
    case "cbz":
      return "book.cbz";
    case "mobi":
      return "book.mobi";
    default:
      return `book.${format}`;
  }
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function withDepth(items: FoliateTocItem[], depth = 0): TocItem[] {
  return items.flatMap((i) => [
    { label: (i.label ?? "").trim(), href: i.href, depth },
    ...withDepth(i.subitems ?? [], depth + 1),
  ]);
}
