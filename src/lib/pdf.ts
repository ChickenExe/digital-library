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
