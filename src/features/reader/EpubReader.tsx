import { useEffect, useMemo, useRef, useState } from "react";
import { animate } from "motion/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import ePub, { EpubCFI, type Book as EpubBook, type Contents, type NavItem, type Rendition } from "epubjs";
import { api, fetchBookBytes, streamBaseUrl } from "../../lib/api";
import { EASE, prefersReducedMotion } from "../../lib/motion";
import type { EngineProps } from "./types";
import { fromFrame, unionRect } from "./types";
import { copyNote, findTarget, noteContainer, noteKind, noteLabel, resolveHref } from "./footnotes";
import { epubCss, highlightInk, THEMES, useEffectiveTheme, useReaderSettings, WIDTHS } from "./settings";
import { sourceKey } from "./doc";
import styles from "./Reader.module.css";

/** epub.js splits books into locations of this many characters. */
const CHARS_PER_LOCATION = 1600;
const CHARS_PER_WORD = 5.7;
const WORDS_PER_MINUTE = 240;

type Location = {
  start: { cfi: string; href: string; index: number; percentage?: number; displayed?: { page: number; total: number } };
};

export function EpubReader(props: EngineProps) {
  const { doc, initialLocator, annotations } = props;
  // Callbacks are read through a ref so changing them never re-opens the book.
  const cb = useRef(props);
  cb.current = props;
  const host = useRef<HTMLDivElement>(null);
  const rendition = useRef<Rendition | null>(null);
  const epubRef = useRef<EpubBook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const { font, size, leading, width, flow } = useReaderSettings();
  const theme = useEffectiveTheme();
  const dark = THEMES[theme].dark;
  const css = useMemo(
    () => epubCss({ theme, font, size, leading, width, flow }),
    [theme, font, size, leading, width, flow],
  );
  const cssRef = useRef(css);
  cssRef.current = css;
  const cfiRef = useRef<string | undefined>(initialLocator);
  const source = doc.source;
  const key = sourceKey(source);
  /** Highlights currently drawn: annotation id → what was drawn. */
  const drawn = useRef(new Map<string, { cfi: string; sig: string }>());

  // Open the book. Layout changes epub.js can't apply in place (pages vs scroll,
  // column width) re-open it at the current position, which is quick and exact.
  useEffect(() => {
    let epub: EpubBook | undefined;
    let cancelled = false;
    setReady(false);
    drawn.current.clear();

    (async () => {
      if (source.kind === "library") {
        const data = await fetchBookBytes(source.bookId);
        if (cancelled || !host.current) return;
        epub = ePub(data);
      } else {
        // Streamed: epub.js asks for each file as it needs it; only what you read is downloaded.
        epub = ePub(streamBaseUrl(source.key), { openAs: "directory" });
      }
      if (cancelled || !host.current) return;
      const book = epub;
      epubRef.current = book;
      const r = book.renderTo(host.current, {
        width: "100%",
        height: "100%",
        flow: flow === "paginated" ? "paginated" : "scrolled-doc",
        manager: flow === "paginated" ? "default" : "continuous",
        spread: "none",
        allowScriptedContent: false,
      });
      rendition.current = r;

      let toc: NavItem[] = [];
      const spineLength = () => (book.spine as unknown as { length: number }).length || 0;
      const sectionHref = (contents: Contents) => book.spine.get((contents as unknown as { sectionIndex: number }).sectionIndex)?.href ?? "";
      /** 0..1 through the book: exact with a location map, else by chapter. */
      const positionOf = (cfi: string) => {
        if (book.locations.length() > 0) return book.locations.percentageFromCfi(cfi);
        const n = spineLength();
        return n ? new EpubCFI(cfi).spinePos / n : 0;
      };

      r.hooks.content.register((contents: Contents) => {
        contents.addStylesheetCss(cssRef.current, "folio");
        const d = contents.document;
        // Capture phase: runs before epub.js's own link handler, so a note can open in place.
        d.addEventListener("click", (e) => void onLinkClick(e, contents), true);
        // Focus lands in the book's iframe once you click it; Escape must still reach the shell.
        d.addEventListener("keydown", (e) => {
          if (e.key === "Escape") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        });
        d.addEventListener("selectionchange", () => {
          if (d.getSelection()?.isCollapsed) cb.current.onSelection(null);
        });
      });

      const onLinkClick = async (e: MouseEvent, contents: Contents) => {
        const a = (e.target as Element | null)?.closest?.("a[href]");
        if (!a) return;
        const href = a.getAttribute("href") ?? "";
        if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
          // Web links open in the browser, never inside the reader.
          e.preventDefault();
          e.stopPropagation();
          if (/^(https?:|mailto:)/i.test(href)) void openUrl(href).catch(() => {});
          return;
        }
        const kind = noteKind(a);
        if (!kind) return; // an ordinary internal link: epub.js navigates
        e.preventDefault();
        e.stopPropagation();
        const from = sectionHref(contents);
        const { path, fragment } = resolveHref(href, from);
        const target = fragment ? `${path}#${fragment}` : path;
        const go = () => void r.display(target);
        try {
          let targetDoc: Document = contents.document;
          if (path !== from) {
            // epub.js resolves a section to its root element, or a plain load to a Document.
            const section = book.spine.get(path);
            const loaded = (await (section ? section.load(book.load.bind(book)) : book.load(book.resolve(path)))) as unknown as Node;
            targetDoc = loaded.ownerDocument ?? (loaded as Document);
          }
          const el = findTarget(targetDoc, fragment);
          const nodes = el ? noteContainer(el) : [];
          if (!nodes.length) return go();
          const rect = fromFrame(a.getBoundingClientRect(), contents.window.frameElement);
          const originId = a.id || a.getAttribute("name") || a.parentElement?.id || undefined;
          cb.current.onFootnote({
            kind,
            label: noteLabel(a, kind),
            rect,
            render: (into) => copyNote(nodes, into, originId),
            go,
          });
        } catch (err) {
          console.warn("footnote", err);
          go();
        }
      };

      r.on("relocated", (loc: Location) => {
        cfiRef.current = loc.start.cfi;
        cb.current.onSelection(null);
        const locs = book.locations;
        const total = locs.length();
        let percent: number;
        if (total > 0) percent = locs.percentageFromCfi(loc.start.cfi);
        else {
          // No location map (streamed books, or before it's ready): estimate by chapter.
          const n = spineLength();
          const d = loc.start.displayed;
          percent = n ? (loc.start.index + (d && d.total > 0 ? (d.page - 1) / d.total : 0)) / n : 0;
        }
        const minutesLeft =
          total > 0 ? ((1 - percent) * total * CHARS_PER_LOCATION) / CHARS_PER_WORD / WORDS_PER_MINUTE : undefined;
        cb.current.onProgress(loc.start.cfi, Math.min(1, Math.max(0, percent)), {
          chapter: chapterFor(toc, loc.start.href),
          minutesLeft,
        });
      });

      r.on("selected", (cfiRange: string, contents: Contents) => {
        const range = contents.range(cfiRange);
        const quote = range?.toString().replace(/\s+/g, " ").trim();
        const rect = range && unionRect(Array.from(range.getClientRects()));
        if (!quote || !rect) return;
        cb.current.onSelection({
          locator: cfiRange,
          quote,
          chapter: chapterFor(toc, sectionHref(contents)),
          position: positionOf(cfiRange),
          rect: fromFrame(rect, contents.window.frameElement),
          clear: () => contents.window.getSelection()?.removeAllRanges(),
        });
      });

      r.on("markClicked", (cfiRange: string, data: { id?: string }, contents: Contents) => {
        if (!data?.id) return;
        const range = contents.range(cfiRange);
        const rect = range && unionRect(Array.from(range.getClientRects()));
        if (rect) cb.current.onAnnotationClick(data.id, fromFrame(rect, contents.window.frameElement));
      });

      // Arrow keys while focus is inside the book's iframe.
      r.on("keyup", (e: KeyboardEvent) => navigateKey(e, turnRef.current));

      try {
        await r.display(cfiRef.current || undefined);
      } catch (e) {
        // A saved position that no longer resolves (corrupt, or the file changed)
        // must never make a book unopenable: start from the beginning instead.
        if (!cfiRef.current) throw e;
        console.warn("saved position unusable, opening at the start", e);
        cfiRef.current = undefined;
        await r.display();
      }
      if (cancelled) return;
      setReady(true);
      cb.current.onNavigator((locator) => {
        if (locator.startsWith("epubcfi(")) void r.display(locator);
      });

      // Chapter names + a location map (for percent and time left), computed after first paint.
      await book.ready;
      toc = flatten(book.navigation?.toc ?? []);
      cb.current.onContents?.(withDepth(book.navigation?.toc ?? []), (href) => void r.display(href));
      // A streamed book is never walked end to end: that would download all of it.
      if (source.kind !== "library") return;
      // Generating the map walks the whole book on the UI thread (seconds for long
      // books), so it's computed once and cached in the library database.
      const cached = await api.getLocations(source.bookId, CHARS_PER_LOCATION).catch(() => null);
      if (cancelled) return;
      if (cached) {
        book.locations.load(cached);
      } else {
        await book.locations.generate(CHARS_PER_LOCATION);
        if (cancelled) return;
        void api.saveLocations(source.bookId, CHARS_PER_LOCATION, book.locations.save()).catch(() => {});
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
  }, [key, flow, width]); // eslint-disable-line react-hooks/exhaustive-deps

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
      // Text reflowed under the new style: re-measure the highlight marks.
      (r.views() as unknown as { forEach: (f: (v: { pane?: { render: () => void } }) => void) => void }).forEach((v) =>
        v.pane?.render(),
      );
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [css, ready]);

  // Keep the drawn highlights in step with the notes (and the theme's inks).
  useEffect(() => {
    const r = rendition.current;
    if (!r || !ready) return;
    const sig = (a: (typeof annotations)[number]) => `${a.color}|${dark}|${a.note ? 1 : 0}`;
    const want = new Map(annotations.filter((a) => a.locator.startsWith("epubcfi(")).map((a) => [a.id, a]));
    for (const [id, d] of drawn.current) {
      const a = want.get(id);
      if (!a || sig(a) !== d.sig) {
        r.annotations.remove(d.cfi, "highlight");
        drawn.current.delete(id);
      }
    }
    for (const a of want.values()) {
      if (drawn.current.has(a.id)) continue;
      const ink = highlightInk(a.color, dark);
      try {
        // One class token only: marks-pane applies it with classList.add, which rejects spaces.
        // The blend is applied to the whole marks layer in CSS (see Reader.module.css).
        r.annotations.highlight(a.locator, { id: a.id }, undefined, a.note ? "folio-hl-note" : "folio-hl", {
          fill: ink.color,
          "fill-opacity": String(a.note ? Math.min(1, ink.opacity + 0.1) : ink.opacity),
        });
        drawn.current.set(a.id, { cfi: a.locator, sig: sig(a) });
      } catch (e) {
        console.warn("highlight", a.id, e);
      }
    }
  }, [annotations, ready, dark]);

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
    <div className={styles.epub} data-ink={dark ? "screen" : "multiply"}>
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

/** Typing a note must never turn the page. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

function navigateKey(e: KeyboardEvent, turn: (dir: 1 | -1) => Promise<void>) {
  if (isTyping(e)) return;
  if (e.key === "ArrowLeft" || e.key === "PageUp") void turn(-1);
  if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") void turn(1);
}

function withDepth(items: NavItem[], depth = 0): { label: string; href: string; depth: number }[] {
  return items.flatMap((i) => [
    { label: i.label.trim(), href: i.href, depth },
    ...withDepth(i.subitems ?? [], depth + 1),
  ]);
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

