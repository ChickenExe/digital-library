import { useEffect, useRef, useState } from "react";
import type { Book } from "../../bindings/Book";
import { openPdf, renderPage, type OpenPdf, type PdfDocument } from "../../lib/pdf";
import type { ProgressHandler } from "./ReaderView";
import styles from "./Reader.module.css";

type Props = { book: Book; initialLocator?: string; onProgress: ProgressHandler };

const MAX_PAGE_WIDTH = 900;

/**
 * Continuous-scroll PDF reader. Every page gets a correctly-sized placeholder
 * up front (so the scrollbar is honest), and pages are only rasterised when
 * they come near the viewport.
 */
export function PdfReader({ book, initialLocator, onProgress }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [aspect, setAspect] = useState(1.414);
  const [width, setWidth] = useState(MAX_PAGE_WIDTH);
  const [error, setError] = useState<string | null>(null);
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;

  useEffect(() => {
    let cancelled = false;
    let loaded: OpenPdf | undefined;
    openPdf(book.id)
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
  }, [book.id]);

  // Fit pages to the available width.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.min(MAX_PAGE_WIDTH, el.clientWidth - 64)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Restore position once placeholders exist.
  useEffect(() => {
    if (!doc || !initialLocator) return;
    const page = Number(initialLocator);
    const el = scroller.current?.querySelector<HTMLElement>(`[data-page="${page}"]`);
    el?.scrollIntoView({ block: "start" });
  }, [doc, initialLocator]);

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
      onProgressRef.current(String(current), percent);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [doc]);

  if (error) return <div className={styles.error}>Couldn’t open this PDF: {error}</div>;

  return (
    <div ref={scroller} className={styles.pdf}>
      {doc &&
        Array.from({ length: doc.numPages }, (_, i) => (
          <PdfPage key={i} doc={doc} pageNumber={i + 1} width={width} height={width * aspect} root={scroller} />
        ))}
    </div>
  );
}

function PdfPage(props: {
  doc: PdfDocument;
  pageNumber: number;
  width: number;
  height: number;
  root: React.RefObject<HTMLDivElement | null>;
}) {
  const { doc, pageNumber, width, height, root } = props;
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

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
    doc
      .getPage(pageNumber)
      .then((page) => {
        if (!cancelled && canvas.current) return renderPage(page, canvas.current, width);
      })
      .catch((e) => console.warn("render page", pageNumber, e));
    return () => {
      cancelled = true;
    };
  }, [visible, doc, pageNumber, width]);

  return (
    <div ref={box} data-page={pageNumber} className={styles.pdfPage} style={{ width, height }}>
      {visible && <canvas ref={canvas} />}
    </div>
  );
}
