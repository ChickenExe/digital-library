import { useEffect, useMemo, useRef, useState } from "react";
import { animate } from "motion/react";
import ePub, { type Book as EpubBook, type Contents, type NavItem, type Rendition } from "epubjs";
import type { Book } from "../../bindings/Book";
import { api, fetchBookBytes } from "../../lib/api";
import { EASE, prefersReducedMotion } from "../../lib/motion";
import type { ProgressHandler } from "./ReaderView";
import { epubCss, useReaderSettings, WIDTHS } from "./settings";
import styles from "./Reader.module.css";

type Props = { book: Book; initialLocator?: string; onProgress: ProgressHandler };

/** epub.js splits books into locations of this many characters. */
const CHARS_PER_LOCATION = 1600;
const CHARS_PER_WORD = 5.7;
const WORDS_PER_MINUTE = 240;

export function EpubReader({ book, initialLocator, onProgress }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const rendition = useRef<Rendition | null>(null);
  const epubRef = useRef<EpubBook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const { theme, font, size, leading, width, flow } = useReaderSettings();
  const css = useMemo(
    () => epubCss({ theme, font, size, leading, width, flow }),
    [theme, font, size, leading, width, flow],
  );

  // Read through refs so changing callbacks/styles don't re-open the book.
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const cssRef = useRef(css);
  cssRef.current = css;
  const cfiRef = useRef<string | undefined>(initialLocator);

  // Open the book. Layout changes epub.js can't apply in place (pages vs scroll,
  // column width) re-open it at the current position, which is quick and exact.
  useEffect(() => {
    let epub: EpubBook | undefined;
    let cancelled = false;
    setReady(false);

    (async () => {
      const data = await fetchBookBytes(book.id);
      if (cancelled || !host.current) return;
      epub = ePub(data);
      epubRef.current = epub;
      const r = epub.renderTo(host.current, {
        width: "100%",
        height: "100%",
        flow: flow === "paginated" ? "paginated" : "scrolled-doc",
        manager: flow === "paginated" ? "default" : "continuous",
        spread: "none",
        allowScriptedContent: false,
      });
      rendition.current = r;
      r.hooks.content.register((contents: Contents) => {
        contents.addStylesheetCss(cssRef.current, "folio");
      });

      let toc: NavItem[] = [];
      r.on("relocated", (loc: { start: { cfi: string; href: string; percentage?: number } }) => {
        cfiRef.current = loc.start.cfi;
        const locs = epub?.locations;
        const total = locs?.length() ?? 0;
        const percent = total > 0 ? locs!.percentageFromCfi(loc.start.cfi) : (loc.start.percentage ?? 0);
        const minutesLeft =
          total > 0 ? ((1 - percent) * total * CHARS_PER_LOCATION) / CHARS_PER_WORD / WORDS_PER_MINUTE : undefined;
        onProgressRef.current(loc.start.cfi, percent, { chapter: chapterFor(toc, loc.start.href), minutesLeft });
      });
      // Arrow keys while focus is inside the book's iframe.
      r.on("keyup", (e: KeyboardEvent) => navigateKey(e, turnRef.current));

      await r.display(cfiRef.current || undefined);
      if (cancelled) return;
      setReady(true);

      // Chapter names + a location map (for percent and time left), computed after first paint.
      await epub.ready;
      toc = flatten(epub.navigation?.toc ?? []);
      // Generating the map walks the whole book on the UI thread (seconds for long
      // books), so it's computed once and cached in the library database.
      const cached = await api.getLocations(book.id, CHARS_PER_LOCATION).catch(() => null);
      if (cancelled) return;
      if (cached) {
        epub.locations.load(cached);
      } else {
        await epub.locations.generate(CHARS_PER_LOCATION);
        if (cancelled) return;
        void api.saveLocations(book.id, CHARS_PER_LOCATION, epub.locations.save()).catch(() => {});
      }
      if (!cancelled) r.reportLocation();
    })().catch((e) => !cancelled && setError(String(e?.message ?? e)));

    const onKey = (e: KeyboardEvent) => navigateKey(e, turnRef.current);
    window.addEventListener("keyup", onKey);
    return () => {
      cancelled = true;
      window.removeEventListener("keyup", onKey);
      rendition.current = null;
      epubRef.current = null;
      epub?.destroy();
    };
  }, [book.id, flow, width]);

  // Apply typography/theme changes live, keeping the reader's place. The relayout
  // itself fires "relocated" events, so pin the position from *before* the change.
  const anchorRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const r = rendition.current;
    if (!r || !ready) return;
    anchorRef.current ??= cfiRef.current;
    const anchor = anchorRef.current;
    const contents = r.getContents() as unknown as Contents[];
    for (const c of contents) c.addStylesheetCss(css, "folio");
    let cancelled = false;
    const t = setTimeout(async () => {
      if (cancelled) return;
      if (anchor) await r.display(anchor);
      anchorRef.current = undefined;
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [css, ready]);

  /**
   * Page turns glide: the old page slips out along the reading direction and the
   * new one settles in from the other side. Rapid presses skip the animation.
   */
  const turning = useRef(false);
  const turn = async (dir: 1 | -1) => {
    const r = rendition.current;
    const el = host.current;
    if (!r) return;
    const go = () => (dir > 0 ? r.next() : r.prev());
    if (turning.current || !el || flow === "scrolled" || prefersReducedMotion()) {
      await go();
      return;
    }
    turning.current = true;
    try {
      await animate(el, { x: -dir * 18, opacity: 0 }, { duration: 0.11, ease: EASE.in });
      await go();
      await animate(el, { x: [dir * 18, 0], opacity: [0, 1] }, { duration: 0.3, ease: EASE.out });
    } finally {
      turning.current = false;
    }
  };
  const turnRef = useRef(turn);
  turnRef.current = turn;

  if (error) return <div className={styles.error}>Couldn’t open this EPUB: {error}</div>;

  return (
    <div className={styles.epub}>
      <button className={styles.turn} onClick={() => void turn(-1)} aria-label="Previous page">
        <span>←</span>
      </button>
      <div
        ref={host}
        className={`${styles.column} ${flow === "scrolled" ? styles.scrolled : ""}`}
        style={{ maxWidth: WIDTHS[width].px, opacity: ready ? 1 : 0 }}
      />
      <button className={styles.turn} onClick={() => void turn(1)} aria-label="Next page">
        <span>→</span>
      </button>
    </div>
  );
}

function navigateKey(e: KeyboardEvent, turn: (dir: 1 | -1) => Promise<void>) {
  if (e.key === "ArrowLeft" || e.key === "PageUp") void turn(-1);
  if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") void turn(1);
}

function flatten(items: NavItem[]): NavItem[] {
  return items.flatMap((i) => [i, ...flatten(i.subitems ?? [])]);
}

/** The table-of-contents label for the section currently on screen. */
function chapterFor(toc: NavItem[], href: string): string | undefined {
  const target = href.split("#")[0];
  const match = toc.find((t) => {
    const h = t.href.split("#")[0];
    return h === target || target.endsWith(`/${h}`) || h.endsWith(`/${target}`);
  });
  return match?.label.trim();
}
