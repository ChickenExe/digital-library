import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  openPdf,
  pageLinks,
  renderPage,
  renderTextLayer,
  resolveDestination,
  type OpenPdf,
  type PdfDocument,
  type PdfLink,
} from "../../lib/pdf";
import type { HighlightColor } from "../../bindings/HighlightColor";
import type { EngineProps, Rect } from "./types";
import { unionRect } from "./types";
import { highlightInk, THEMES, useEffectiveTheme, useReaderSettings, WIDTHS } from "./settings";
import styles from "./Reader.module.css";

/** PDFs are fixed-layout, so "width" maps to a page size rather than a text measure. */
const PAGE_SCALE = 1.25;
const PREVIEW_WIDTH = 380;
const PREVIEW_HEIGHT = 210;
/** Previews show the page larger than fits, skipping this share of it on the left (the margin). */
const PREVIEW_ZOOM = 1.6;
const PREVIEW_MARGIN = 0.09;

/** A highlight's box on one page, normalised to the page: [page, x, y, w, h]. */
type PageRect = [number, number, number, number, number];
type PdfLocator = { page: number; rects: PageRect[] };
type PageMark = { id: string; color: HighlightColor; note: boolean; rects: PageRect[] };

export function parsePdfLocator(locator: string): PdfLocator | null {
  if (!locator.startsWith("{")) return null;
  try {
    const v = JSON.parse(locator) as PdfLocator;
    return Number.isInteger(v.page) && Array.isArray(v.rects) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Continuous-scroll PDF reader. Every page gets a correctly-sized placeholder
 * up front (so the scrollbar is honest), and pages are only rasterised when
 * they come near the viewport. Each rendered page carries pdf.js's invisible
 * text layer (for selecting and highlighting) and its links.
 */
export function PdfReader(props: EngineProps) {
  const { doc: readerDoc, initialLocator, annotations } = props;
  const cb = useRef(props);
  cb.current = props;
  const scroller = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [aspect, setAspect] = useState(1.414);
  const widthSetting = useReaderSettings((s) => s.width);
  const theme = THEMES[useEffectiveTheme()];
  const maxWidth = WIDTHS[widthSetting].px * PAGE_SCALE;
  const [width, setWidth] = useState(maxWidth);
  const [error, setError] = useState<string | null>(null);
  const bookId = readerDoc.source.kind === "library" ? readerDoc.source.bookId : null;

  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    let loaded: OpenPdf | undefined;
    openPdf(bookId)
      .then(async (pdf) => {
        loaded = pdf;
        const d = pdf.doc;
        const first = await d.getPage(1);
        const vp = first.getViewport({ scale: 1 });
        if (cancelled) return;
        setAspect(vp.height / vp.width);
        setDoc(d);
      })
      .catch((e) => !cancelled && setError(String(e?.message ?? e)));
    return () => {
      cancelled = true;
      void loaded?.close();
    };
  }, [bookId]);

  // Fit pages to the available width.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.min(maxWidth, el.clientWidth - 64)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxWidth]);

  /** Scrolls so that `y` (0..1 down the page) sits near the top of the view. */
  const scrollToPage = useCallback((page: number, y = 0, smooth = false) => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-page="${page}"]`);
    if (!el || !scroller.current) return;
    scroller.current.scrollTo({ top: el.offsetTop + y * el.offsetHeight - 72, behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Restore position once placeholders exist, and let the shell navigate.
  useEffect(() => {
    if (!doc) return;
    if (initialLocator) scrollToPage(Number(initialLocator) || 1);
    cb.current.onNavigator((locator) => {
      const hl = parsePdfLocator(locator);
      if (hl) scrollToPage(hl.page, hl.rects[0]?.[2] ?? 0, true);
      else if (Number(locator)) scrollToPage(Number(locator), 0, true);
    });
  }, [doc, initialLocator, scrollToPage]);

  // Track the page nearest the top of the viewport.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !doc) return;
    const onScroll = () => {
      const pages = el.querySelectorAll<HTMLElement>("[data-page]");
      const mid = el.scrollTop + el.clientHeight / 3;
      let current = 1;
      for (const p of pages) {
        if (p.offsetTop <= mid) current = Number(p.dataset.page);
        else break;
      }
      const percent = doc.numPages <= 1 ? 1 : (current - 1) / (doc.numPages - 1);
      cb.current.onProgress(String(current), percent, { chapter: `Page ${current} of ${doc.numPages}` });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [doc]);

  // Selecting text in the text layer → a draft highlight.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !doc) return;
    const onUp = () => {
      // Let the browser settle the selection first.
      requestAnimationFrame(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        if (!el.contains(range.commonAncestorContainer)) return;
        const quote = sel.toString().replace(/\s+/g, " ").trim();
        const rects = selectionRects(el, range);
        const box = unionRect(Array.from(range.getClientRects()));
        if (!quote || !rects.length || !box) return;
        const page = rects[0][0];
        cb.current.onSelection({
          locator: JSON.stringify({ page, rects } satisfies PdfLocator),
          quote,
          chapter: `Page ${page}`,
          position: (page - 1 + rects[0][2]) / doc.numPages,
          rect: box,
          clear: () => window.getSelection()?.removeAllRanges(),
        });
      });
    };
    const onChange = () => {
      if (window.getSelection()?.isCollapsed) cb.current.onSelection(null);
    };
    el.addEventListener("mouseup", onUp);
    document.addEventListener("selectionchange", onChange);
    return () => {
      el.removeEventListener("mouseup", onUp);
      document.removeEventListener("selectionchange", onChange);
    };
  }, [doc]);

  // Highlights grouped by page.
  const marks = useMemo(() => {
    const byPage = new Map<number, PageMark[]>();
    for (const a of annotations) {
      const loc = parsePdfLocator(a.locator);
      if (!loc) continue;
      for (const page of new Set(loc.rects.map((r) => r[0]))) {
        const list = byPage.get(page) ?? [];
        list.push({ id: a.id, color: a.color, note: !!a.note, rects: loc.rects.filter((r) => r[0] === page) });
        byPage.set(page, list);
      }
    }
    return byPage;
  }, [annotations]);

  const onLink = useCallback(
    async (link: PdfLink, rect: Rect) => {
      if (link.url) {
        if (/^(https?:|mailto:)/i.test(link.url)) void openUrl(link.url).catch(() => {});
        return;
      }
      if (!doc) return;
      const target = await resolveDestination(doc, link.dest).catch(() => null);
      if (!target) return;
      cb.current.onFootnote({
        kind: "link",
        label: `Page ${target.page}`,
        rect,
        go: () => scrollToPage(target.page, target.y, true),
        render: (el) => renderPreview(el, doc, target.page, target.y, theme.pdfFilter),
      });
    },
    [doc, scrollToPage, theme.pdfFilter],
  );

  const onMarkClick = useCallback((id: string, rect: Rect) => cb.current.onAnnotationClick(id, rect), []);

  if (error) return <div className={styles.error}>Couldn’t open this PDF: {error}</div>;

  return (
    <div ref={scroller} className={styles.pdf}>
      {doc &&
        Array.from({ length: doc.numPages }, (_, i) => (
          <PdfPage
            key={i}
            doc={doc}
            pageNumber={i + 1}
            width={width}
            height={width * aspect}
            root={scroller}
            filter={theme.pdfFilter}
            dark={theme.dark}
            marks={marks.get(i + 1)}
            onLink={onLink}
            onMarkClick={onMarkClick}
          />
        ))}
    </div>
  );
}

const PdfPage = memo(function PdfPage(props: {
  doc: PdfDocument;
  pageNumber: number;
  width: number;
  height: number;
  root: React.RefObject<HTMLDivElement | null>;
  filter: string;
  dark: boolean;
  marks?: PageMark[];
  onLink: (link: PdfLink, rect: Rect) => void;
  onMarkClick: (id: string, rect: Rect) => void;
}) {
  const { doc, pageNumber, width, height, root, filter, dark, marks, onLink, onMarkClick } = props;
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [links, setLinks] = useState<PdfLink[]>([]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      root: root.current,
      rootMargin: "150% 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  useEffect(() => {
    if (!visible || !canvas.current) return;
    let cancelled = false;
    let cancelText: (() => void) | undefined;
    doc
      .getPage(pageNumber)
      .then(async (page) => {
        if (cancelled || !canvas.current) return;
        await renderPage(page, canvas.current, width);
        if (cancelled || !text.current) return;
        cancelText = renderTextLayer(page, text.current, width);
        const found = await pageLinks(page).catch(() => []);
        if (!cancelled) setLinks(found);
      })
      .catch((e) => console.warn("render page", pageNumber, e));
    return () => {
      cancelled = true;
      cancelText?.();
    };
  }, [visible, doc, pageNumber, width]);

  /** Clicking a highlight (but not finishing a selection) opens it. */
  const onClick = (e: React.MouseEvent) => {
    if (!marks?.length || !window.getSelection()?.isCollapsed) return;
    const b = box.current!.getBoundingClientRect();
    const x = (e.clientX - b.left) / b.width;
    const y = (e.clientY - b.top) / b.height;
    const hit = [...marks].reverse().find((m) => m.rects.some(([, rx, ry, rw, rh]) => x >= rx && x <= rx + rw && y >= ry && y <= ry + rh));
    if (!hit) return;
    const rects = hit.rects.map(([, rx, ry, rw, rh]) => ({ left: b.left + rx * b.width, top: b.top + ry * b.height, width: rw * b.width, height: rh * b.height }));
    const rect = unionRect(rects);
    if (rect) onMarkClick(hit.id, rect);
  };

  return (
    <div ref={box} data-page={pageNumber} className={styles.pdfPage} style={{ width, height }} onClick={onClick}>
      <div className={styles.pdfSheet} style={{ filter }}>
        {visible && <canvas ref={canvas} />}
      </div>
      {marks && (
        <div className={styles.pdfMarks} aria-hidden>
          {marks.flatMap((m) => {
            const ink = highlightInk(m.color, dark);
            return m.rects.map(([, x, y, w, h], i) => (
              <i
                key={`${m.id}-${i}`}
                style={{
                  left: `${x * 100}%`,
                  top: `${y * 100}%`,
                  width: `${w * 100}%`,
                  height: `${h * 100}%`,
                  background: ink.color,
                  mixBlendMode: ink.blend,
                  opacity: ink.opacity,
                  boxShadow: m.note && i === 0 ? `inset 2px 0 0 ${ink.color}` : undefined,
                }}
              />
            ));
          })}
        </div>
      )}
      {visible && <div ref={text} className={styles.textLayer} />}
      {visible &&
        links.map((l, i) => (
          <button
            key={i}
            className={styles.pdfLink}
            style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%`, width: `${l.w * 100}%`, height: `${l.h * 100}%` }}
            aria-label={l.url ? `Open ${l.url}` : "Show link target"}
            onClick={(e) => {
              e.stopPropagation();
              onLink(l, e.currentTarget.getBoundingClientRect());
            }}
          />
        ))}
    </div>
  );
});

/**
 * The selection's boxes, page by page, normalised to each page and merged into
 * one box per line (the text layer yields one rect per text run).
 */
function selectionRects(scroller: HTMLElement, range: Range): PageRect[] {
  const out: PageRect[] = [];
  const pages = Array.from(scroller.querySelectorAll<HTMLElement>("[data-page]")).filter((p) => range.intersectsNode(p));
  const client = Array.from(range.getClientRects()).filter((r) => r.width > 0.5 && r.height > 0.5);
  for (const p of pages) {
    const b = p.getBoundingClientRect();
    const n = Number(p.dataset.page);
    const inPage = client
      .filter((r) => r.top + r.height / 2 >= b.top && r.top + r.height / 2 <= b.bottom)
      .map((r) => ({ x: (r.left - b.left) / b.width, y: (r.top - b.top) / b.height, w: r.width / b.width, h: r.height / b.height }))
      .sort((a, c) => a.y - c.y || a.x - c.x);
    const lines: typeof inPage = [];
    for (const r of inPage) {
      const last = lines[lines.length - 1];
      const sameLine = last && Math.abs(last.y + last.h / 2 - (r.y + r.h / 2)) < Math.min(last.h, r.h) * 0.5;
      if (sameLine && r.x <= last.x + last.w + 0.02) {
        const right = Math.max(last.x + last.w, r.x + r.w);
        const bottom = Math.max(last.y + last.h, r.y + r.h);
        last.x = Math.min(last.x, r.x);
        last.y = Math.min(last.y, r.y);
        last.w = right - last.x;
        last.h = bottom - last.y;
      } else {
        lines.push({ ...r });
      }
    }
    const round = (v: number) => Math.round(v * 10000) / 10000;
    for (const l of lines) out.push([n, round(l.x), round(l.y), round(l.w), round(l.h)]);
  }
  return out;
}

/** Draws the area of `page` around `y` into `el`: what a link points at, without leaving your place. */
function renderPreview(el: HTMLElement, doc: PdfDocument, pageNumber: number, y: number, filter: string) {
  let cancelled = false;
  const frame = document.createElement("div");
  frame.className = styles.preview;
  frame.style.height = `${PREVIEW_HEIGHT}px`;
  const canvas = document.createElement("canvas");
  canvas.style.filter = filter;
  frame.appendChild(canvas);
  el.appendChild(frame);
  void doc.getPage(pageNumber).then(async (page) => {
    if (cancelled) return;
    // Zoomed in past the page's side margins, so the target text is readable.
    const base = page.getViewport({ scale: 1 });
    const width = PREVIEW_WIDTH * PREVIEW_ZOOM;
    const height = (width / base.width) * base.height;
    const x = width * PREVIEW_MARGIN;
    canvas.style.transform = `translate(${-x}px, ${-Math.max(0, Math.min(height - PREVIEW_HEIGHT, y * height - 18))}px)`;
    await renderPage(page, canvas, width);
  });
  return () => {
    cancelled = true;
    frame.remove();
  };
}
