/**
 * App state. Rust (SQLite) is the source of truth; this store holds the
 * current query + a cached result set and re-fetches whenever the backend
 * emits `library-changed`.
 */
import { create } from "zustand";
import { open } from "@tauri-apps/plugin-dialog";
import type { Book } from "../bindings/Book";
import type { BookQuery } from "../bindings/BookQuery";
import type { ImportProgress } from "../bindings/ImportProgress";
import type { ImportReport } from "../bindings/ImportReport";
import type { LibraryStats } from "../bindings/LibraryStats";
import { api, errorMessage } from "../lib/api";

export type View = { kind: "library" } | { kind: "reader"; bookId: string };

type Toast = { id: number; tone: "info" | "error"; text: string };

type LibraryState = {
  view: View;
  query: BookQuery;
  books: Book[];
  stats: LibraryStats;
  loaded: boolean;
  importing: ImportProgress | null;
  toasts: Toast[];

  refresh: () => Promise<void>;
  setQuery: (patch: Partial<BookQuery>) => void;
  pickAndImport: () => Promise<void>;
  importPaths: (paths: string[]) => Promise<void>;
  setImportProgress: (p: ImportProgress | null) => void;
  toggleFavorite: (book: Book) => Promise<void>;
  deleteBook: (book: Book) => Promise<void>;
  openBook: (id: string) => void;
  closeReader: () => void;
  toast: (text: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: number) => void;
};

let refreshSeq = 0;
let toastSeq = 0;

export const useLibrary = create<LibraryState>((set, get) => ({
  view: { kind: "library" },
  query: { shelf: "all", sort: "recent" },
  books: [],
  stats: { total: 0, reading: 0, favorites: 0, finished: 0 },
  loaded: false,
  importing: null,
  toasts: [],

  refresh: async () => {
    // Drop stale responses when the user types faster than SQLite answers.
    const seq = ++refreshSeq;
    try {
      const [books, stats] = await Promise.all([api.listBooks(get().query), api.stats()]);
      if (seq !== refreshSeq) return;
      set({ books, stats, loaded: true });
      // pdf.js is heavy; only load it when there's actually a cover to render.
      if (books.some((b) => b.coverState === "pending")) {
        void import("../features/covers/pdfCovers").then((m) => m.generateMissingPdfCovers(books));
      }
    } catch (e) {
      get().toast(errorMessage(e), "error");
    }
  },

  setQuery: (patch) => {
    set({ query: { ...get().query, ...patch } });
    void get().refresh();
  },

  pickAndImport: async () => {
    const picked = await open({
      multiple: true,
      title: "Add books",
      filters: [{ name: "Books", extensions: ["epub", "pdf"] }],
    });
    if (picked) await get().importPaths(Array.isArray(picked) ? picked : [picked]);
  },

  importPaths: async (paths) => {
    if (!paths.length) return;
    set({ importing: { done: 0, total: paths.length, current: "" } });
    try {
      summarize(await api.importPaths(paths), get().toast);
    } catch (e) {
      get().toast(errorMessage(e), "error");
    } finally {
      set({ importing: null });
      await get().refresh();
    }
  },

  setImportProgress: (p) => set({ importing: p }),

  toggleFavorite: async (book) => {
    const updated = await api.setFavorite(book.id, !book.favorite);
    set({ books: get().books.map((b) => (b.id === book.id ? updated : b)) });
    void get().refresh();
  },

  deleteBook: async (book) => {
    try {
      await api.deleteBook(book.id);
      get().toast(`Removed “${book.title}”`);
    } catch (e) {
      get().toast(errorMessage(e), "error");
    }
  },

  openBook: (id) => set({ view: { kind: "reader", bookId: id } }),
  closeReader: () => {
    set({ view: { kind: "library" } });
    void get().refresh();
  },

  toast: (text, tone = "info") => {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts, { id, tone, text }] });
    setTimeout(() => get().dismissToast(id), tone === "error" ? 7000 : 3500);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

function summarize(report: ImportReport, toast: LibraryState["toast"]) {
  const parts: string[] = [];
  if (report.imported.length)
    parts.push(`Added ${report.imported.length} book${report.imported.length === 1 ? "" : "s"}`);
  if (report.duplicates.length) parts.push(`${report.duplicates.length} already in library`);
  if (parts.length) toast(parts.join(" · "));
  for (const f of report.failed) {
    const name = f.path.split(/[\\/]/).pop();
    toast(`Couldn’t import ${name}: ${f.reason}`, "error");
  }
  if (!parts.length && !report.failed.length) toast("No EPUB or PDF files found");
}
