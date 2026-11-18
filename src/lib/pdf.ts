import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { bookUrl, fetchBookBytes } from "./api";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDocument = pdfjs.PDFDocumentProxy;
export type PdfPage = pdfjs.PDFPageProxy;

export type OpenPdf = { doc: PdfDocument; close: () => Promise<void> };

/** pdf.js asks for data in chunks of this size. */
const CHUNK = 256 * 1024;

async function fetchRange(url: string, begin: number, endInclusive: number): Promise<Response> {
  return fetch(url, { headers: { Range: `bytes=${begin}-${endInclusive}` } });
}

/**
 * Opens a library PDF. Data is loaded on demand in byte ranges, so a 300 MB
 * scan opens instantly and only the pages you look at are ever read into
 * memory. Falls back to loading the whole file if ranges aren't available.
 * Call `close()` to release the worker and its memory.
 */
export async function openPdf(id: string): Promise<OpenPdf> {
  const url = bookUrl(id);
  let task: pdfjs.PDFDocumentLoadingTask;

  const head = await fetchRange(url, 0, CHUNK - 1).catch(() => null);
  const total = Number(head?.headers.get("Content-Range")?.split("/")[1]);
  if (head?.status === 206 && Number.isFinite(total) && total > CHUNK) {
    const transport = new pdfjs.PDFDataRangeTransport(total, new Uint8Array(await head.arrayBuffer()));
    transport.requestDataRange = (begin: number, end: number) => {
      fetchRange(url, begin, end - 1)
        .then((r) => r.arrayBuffer())
        .then((buf) => transport.onDataRange(begin, new Uint8Array(buf)))
        .catch((e) => console.warn("pdf range failed", begin, end, e));
    };
    task = pdfjs.getDocument({ range: transport, rangeChunkSize: CHUNK, disableAutoFetch: true, disableStream: true });
  } else {
    const data = head?.status === 200 ? await head.arrayBuffer() : await fetchBookBytes(id);
    task = pdfjs.getDocument({ data: new Uint8Array(data) });
  }

  try {
    return { doc: await task.promise, close: () => task.destroy() };
  } catch (e) {
    void task.destroy();
    throw e;
  }
}

/** Renders a page into a canvas at the given CSS width, crisp on HiDPI screens. */
export async function renderPage(page: PdfPage, canvas: HTMLCanvasElement, cssWidth: number) {
  const base = page.getViewport({ scale: 1 });
  const dpr = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${(cssWidth / base.width) * base.height}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
}

/**
 * Lays pdf.js's invisible, selectable text over a rendered page, so text can
 * be selected, copied and highlighted. Returns a cancel function.
 */
export function renderTextLayer(page: PdfPage, container: HTMLElement, cssWidth: number): () => void {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: cssWidth / base.width });
  container.replaceChildren();
  container.style.setProperty("--total-scale-factor", String(viewport.scale));
  const layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container, viewport });
  layer.render().catch((e: unknown) => {
    if (!(e instanceof Error && e.name === "AbortException")) console.warn("text layer", e);
  });
  return () => layer.cancel();
}

/** A link on a page, with its box normalised to the page (0..1). */
export type PdfLink = { x: number; y: number; w: number; h: number; url?: string; dest?: unknown };

export async function pageLinks(page: PdfPage): Promise<PdfLink[]> {
  const vp = page.getViewport({ scale: 1 });
  const annotations: Array<{ subtype?: string; rect?: number[]; url?: string; unsafeUrl?: string; dest?: unknown }> =
    await page.getAnnotations({ intent: "display" });
  return annotations
    .filter((a) => a.subtype === "Link" && a.rect && (a.url || a.dest))
    .map((a) => {
      const [x1, y1] = vp.convertToViewportPoint(a.rect![0], a.rect![1]);
      const [x2, y2] = vp.convertToViewportPoint(a.rect![2], a.rect![3]);
      return {
        x: Math.min(x1, x2) / vp.width,
        y: Math.min(y1, y2) / vp.height,
        w: Math.abs(x2 - x1) / vp.width,
        h: Math.abs(y2 - y1) / vp.height,
        url: a.url,
        dest: a.dest,
      };
    });
}

/**
 * Where an internal link goes: a page number and how far down it the target
 * sits (0..1), from a named or explicit PDF destination.
 */
export async function resolveDestination(doc: PdfDocument, dest: unknown): Promise<{ page: number; y: number } | null> {
  const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
  if (!Array.isArray(explicit) || explicit.length < 2) return null;
  const [ref, mode, ...args] = explicit as [unknown, { name?: string } | null, ...Array<number | null>];
  const index = typeof ref === "number" ? ref : await doc.getPageIndex(ref as Parameters<PdfDocument["getPageIndex"]>[0]);
  const name = mode?.name;
  const top = name === "XYZ" ? args[1] : name === "FitH" || name === "FitBH" ? args[0] : name === "FitR" ? args[3] : null;
  if (typeof top !== "number") return { page: index + 1, y: 0 };
  const page = await doc.getPage(index + 1);
  const vp = page.getViewport({ scale: 1 });
  const [, y] = vp.convertToViewportPoint(0, top);
  return { page: index + 1, y: Math.min(1, Math.max(0, y / vp.height)) };
}
