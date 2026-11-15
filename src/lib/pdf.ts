import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { fetchBookBytes } from "./api";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDocument = pdfjs.PDFDocumentProxy;
export type PdfPage = pdfjs.PDFPageProxy;

export type OpenPdf = { doc: PdfDocument; close: () => Promise<void> };

/** Opens a library PDF. Call `close()` to release the worker and its memory. */
export async function openPdf(id: string): Promise<OpenPdf> {
  const data = new Uint8Array(await fetchBookBytes(id));
  const task = pdfjs.getDocument({ data });
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
