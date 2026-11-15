/**
 * Typed wrappers around Tauri commands. This file is the only place the UI
 * talks to Rust — components never call `invoke` directly.
 * Types come from `src/bindings`, generated from Rust by ts-rs (`npm run bindings`).
 */
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Book } from "../bindings/Book";
import type { BookQuery } from "../bindings/BookQuery";
import type { ImportProgress } from "../bindings/ImportProgress";
import type { ImportReport } from "../bindings/ImportReport";
import type { LibraryStats } from "../bindings/LibraryStats";

/** Shape of every error a command can reject with (see `src-tauri/src/error.rs`). */
export type AppError = {
  kind: "db" | "io" | "parse" | "unsupported" | "notFound" | "invalid";
  message: string;
};

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as AppError).message);
  return String(e);
}

export const api = {
  listBooks: (query: BookQuery) => invoke<Book[]>("list_books", { query }),
  getBook: (id: string) => invoke<Book>("get_book", { id }),
  stats: () => invoke<LibraryStats>("library_stats"),
  importPaths: (paths: string[]) => invoke<ImportReport>("import_paths", { paths }),
  deleteBook: (id: string) => invoke<void>("delete_book", { id }),
  setFavorite: (id: string, favorite: boolean) => invoke<Book>("set_favorite", { id, favorite }),
  saveProgress: (id: string, locator: string, percent: number) =>
    invoke<void>("save_progress", { id, locator, percent }),
  /** Sent as a raw binary body — no JSON encoding of the bytes. */
  saveCover: (id: string, bytes: Uint8Array) =>
    invoke<void>("save_cover", bytes, { headers: { "x-book-id": id } }),
  markCoverMissing: (id: string) => invoke<void>("mark_cover_missing", { id }),
};

export const events = {
  onLibraryChanged: (cb: () => void): Promise<UnlistenFn> => listen("library-changed", cb),
  onImportProgress: (cb: (p: ImportProgress) => void): Promise<UnlistenFn> =>
    listen<ImportProgress>("import-progress", (e) => cb(e.payload)),
};

/** URL of the book file, served by the `book://` protocol (http://book.localhost on Windows). */
export const bookUrl = (id: string) => convertFileSrc(id, "book");

export const coverUrl = (book: Pick<Book, "id" | "coverVersion">) =>
  `${convertFileSrc(book.id, "cover")}?v=${book.coverVersion}`;

export async function fetchBookBytes(id: string): Promise<ArrayBuffer> {
  const res = await fetch(bookUrl(id));
  if (!res.ok) throw new Error(`Could not load book (${res.status})`);
  return res.arrayBuffer();
}
