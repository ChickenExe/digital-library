/**
 * The Rust side can't rasterise PDFs (we deliberately don't bundle pdfium), so
 * books imported with `coverState: "pending"` get their first page rendered
 * here with pdf.js and uploaded back as a JPEG. Runs one at a time, in the
 * background, and is idempotent across refreshes.
 */
import type { Book } from "../../bindings/Book";
import { api } from "../../lib/api";
import { openPdf, renderPage, type OpenPdf } from "../../lib/pdf";

const COVER_WIDTH = 480;
const inFlight = new Set<string>();
let queue: Promise<void> = Promise.resolve();

export function generateMissingPdfCovers(books: Book[]) {
  for (const book of books) {
    if (book.format !== "pdf" || book.coverState !== "pending" || inFlight.has(book.id)) continue;
    inFlight.add(book.id);
    queue = queue.then(() => renderCover(book.id)).finally(() => inFlight.delete(book.id));
  }
}

async function renderCover(id: string) {
  let pdf: OpenPdf | undefined;
  try {
    pdf = await openPdf(id);
    const page = await pdf.doc.getPage(1);
    const canvas = document.createElement("canvas");
    // renderPage multiplies by devicePixelRatio; covers want a fixed pixel size.
    await renderPage(page, canvas, COVER_WIDTH / (window.devicePixelRatio || 1));
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.86));
    if (!blob) throw new Error("toBlob failed");
    await api.saveCover(id, new Uint8Array(await blob.arrayBuffer()));
  } catch (e) {
    console.warn("cover generation failed", id, e);
    await api.markCoverMissing(id).catch(() => {});
  } finally {
    await pdf?.close();
  }
}
