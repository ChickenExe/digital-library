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
import type { CatalogDetail } from "../bindings/CatalogDetail";
import type { CatalogEntry } from "../bindings/CatalogEntry";
import type { CatalogPage } from "../bindings/CatalogPage";
import type { CatalogQuery } from "../bindings/CatalogQuery";
import type { CatalogRow } from "../bindings/CatalogRow";
import type { CatalogStatus } from "../bindings/CatalogStatus";
import type { DownloadProgress } from "../bindings/DownloadProgress";
import type { CollectionSet } from "../bindings/CollectionSet";
import type { Edition } from "../bindings/Edition";
import type { EditionSummary } from "../bindings/EditionSummary";

/** Shape of every error a command can reject with (see `src-tauri/src/error.rs`). */
export type AppError = {
  kind: "db" | "io" | "parse" | "unsupported" | "notFound" | "network" | "invalid";
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
  getLocations: (id: string, charsPer: number) => invoke<string | null>("get_locations", { id, charsPer }),
  saveLocations: (id: string, charsPer: number, data: string) =>
    invoke<void>("save_locations", { id, charsPer, data }),

  // Discover
  catalogStatus: () => invoke<CatalogStatus>("catalog_status"),
  catalogSync: (force = false) => invoke<void>("catalog_sync", { force }),
  catalogHome: (language?: string) => invoke<CatalogRow[]>("catalog_home", { language }),
  catalogSearch: (query: CatalogQuery) => invoke<CatalogPage>("catalog_search", { query }),
  catalogDetail: (provider: string, id: string) =>
    invoke<CatalogDetail>("catalog_detail", { provider, id }),
  catalogAcquire: (provider: string, id: string) =>
    invoke<Book>("catalog_acquire", { provider, id }),
  collectionSets: () => invoke<CollectionSet[]>("collection_sets"),
  editionSummaries: () => invoke<EditionSummary[]>("edition_summaries"),
  edition: (id: string) => invoke<Edition>("edition", { id }),
};

export const events = {
  onLibraryChanged: (cb: () => void): Promise<UnlistenFn> => listen("library-changed", cb),
  onImportProgress: (cb: (p: ImportProgress) => void): Promise<UnlistenFn> =>
    listen<ImportProgress>("import-progress", (e) => cb(e.payload)),
  onCatalogStatus: (cb: (s: CatalogStatus) => void): Promise<UnlistenFn> =>
    listen<CatalogStatus>("catalog-status", (e) => cb(e.payload)),
  onDownloadProgress: (cb: (p: DownloadProgress) => void): Promise<UnlistenFn> =>
    listen<DownloadProgress>("catalog-download", (e) => cb(e.payload)),
};

/** URL of the book file, served by the `book://` protocol (http://book.localhost on Windows). */
export const bookUrl = (id: string) => convertFileSrc(id, "book");

/** Covers are served as thumbnails sized for this screen's pixel density. */
const THUMB_WIDTH = window.devicePixelRatio > 1.34 ? 360 : 240;

export const coverUrl = (book: Pick<Book, "id" | "coverVersion">) =>
  `${convertFileSrc(book.id, "cover")}?v=${book.coverVersion}&w=${THUMB_WIDTH}`;

export async function fetchBookBytes(id: string): Promise<ArrayBuffer> {
  const res = await fetch(bookUrl(id));
  if (!res.ok) throw new Error(`Could not load book (${res.status})`);
  return res.arrayBuffer();
}

/** Remote catalog cover, proxied + cached by Rust (`catalog-cover://`). */
export const catalogCoverUrl = (entry: Pick<CatalogEntry, "provider" | "id">) =>
  convertFileSrc(`${entry.provider}/${entry.id}`, "catalog-cover");

export const listingKey = (entry: Pick<CatalogEntry, "provider" | "id">) =>
  `${entry.provider}/${entry.id}`;
