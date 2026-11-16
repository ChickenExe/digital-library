/**
 * Discover state: the catalog front page, search/browse results, the open
 * listing, and in-flight downloads. Rust owns the data; this is a view cache.
 */
import { create } from "zustand";
import type { CatalogDetail } from "../bindings/CatalogDetail";
import type { CatalogEntry } from "../bindings/CatalogEntry";
import type { CatalogRow } from "../bindings/CatalogRow";
import type { CatalogStatus } from "../bindings/CatalogStatus";
import type { DownloadProgress } from "../bindings/DownloadProgress";
import { api, errorMessage, listingKey } from "../lib/api";
import { originOf, useLibrary, type Origin } from "./library";

const PAGE = 48;

export type Browse = { search: string; category: string | null; title: string };

type DiscoverState = {
  status: CatalogStatus | null;
  language: string | null;
  rows: CatalogRow[];
  /** Non-null while showing search results or a "See all" category. */
  browse: Browse | null;
  results: CatalogEntry[];
  total: number;
  loadingMore: boolean;
  /** The listing open in the detail sheet. */
  open: { entry: CatalogEntry; detail: CatalogDetail | null; from: Origin | null } | null;
  /** The card whose cover is currently "lifted" into the sheet (hidden in place until it lands back). */
  morphing: string | null;
  /** keyed by listingKey */
  downloads: Record<string, DownloadProgress | "starting">;

  init: () => Promise<void>;
  setStatus: (s: CatalogStatus) => void;
  loadHome: () => Promise<void>;
  setLanguage: (lang: string | null) => void;
  setBrowse: (b: Browse | null) => void;
  loadMore: () => Promise<void>;
  /** `morph` names the card (and cover element) the sheet opens from, so the cover can fly into it. */
  openListing: (entry: CatalogEntry, morph?: { key: string; el: Element | null }) => Promise<void>;
  endMorph: () => void;
  closeListing: () => void;
  acquire: (entry: CatalogEntry, openAfter?: boolean) => Promise<void>;
  onDownloadProgress: (p: DownloadProgress) => void;
};

let browseSeq = 0;

export const useDiscover = create<DiscoverState>((set, get) => ({
  status: null,
  language: "en",
  rows: [],
  browse: null,
  results: [],
  total: 0,
  loadingMore: false,
  open: null,
  morphing: null,
  downloads: {},

  init: async () => {
    const status = await api.catalogStatus();
    set({ status });
    if (status.entries > 0) await get().loadHome();
  },

  setStatus: (status) => {
    const prev = get().status;
    set({ status });
    // Refresh once the index (or its popularity ranking) becomes usable.
    const becameUsable = status.entries > 0 && (!prev || prev.phase !== status.phase);
    if (becameUsable && (status.phase === "ranking" || status.phase === "ready")) {
      void get().loadHome();
      if (get().browse) get().setBrowse(get().browse);
    }
  },

  loadHome: async () => {
    try {
      set({ rows: await api.catalogHome(get().language ?? undefined) });
    } catch (e) {
      useLibrary.getState().toast(errorMessage(e), "error");
    }
  },

  setLanguage: (language) => {
    set({ language });
    void get().loadHome();
    if (get().browse) get().setBrowse(get().browse);
  },

  setBrowse: (browse) => {
    const seq = ++browseSeq;
    set({ browse, results: [], total: 0 });
    if (!browse) return;
    api
      .catalogSearch({
        search: browse.search || undefined,
        category: browse.category ?? undefined,
        language: get().language ?? undefined,
        limit: PAGE,
      })
      .then((page) => seq === browseSeq && set({ results: page.entries, total: page.total }))
      .catch((e) => useLibrary.getState().toast(errorMessage(e), "error"));
  },

  loadMore: async () => {
    const { browse, results, total, loadingMore, language } = get();
    if (!browse || loadingMore || results.length >= total) return;
    const seq = browseSeq;
    set({ loadingMore: true });
    try {
      const page = await api.catalogSearch({
        search: browse.search || undefined,
        category: browse.category ?? undefined,
        language: language ?? undefined,
        offset: results.length,
        limit: PAGE,
      });
      if (seq === browseSeq) set({ results: [...get().results, ...page.entries] });
    } finally {
      set({ loadingMore: false });
    }
  },

  openListing: async (entry, morph) => {
    set({
      open: { entry, detail: null, from: originOf(morph?.el) },
      morphing: morph?.el ? morph.key : null,
    });
    try {
      const detail = await api.catalogDetail(entry.provider, entry.id);
      const current = get().open;
      if (current?.entry.id === entry.id) set({ open: { ...current, entry: detail.entry, detail } });
    } catch (e) {
      useLibrary.getState().toast(errorMessage(e), "error");
    }
  },

  closeListing: () => set({ open: null }),
  endMorph: () => set({ morphing: null }),

  acquire: async (entry, openAfter = false) => {
    const key = listingKey(entry);
    if (get().downloads[key]) return;
    set({ downloads: { ...get().downloads, [key]: "starting" } });
    const library = useLibrary.getState();
    try {
      const book = await api.catalogAcquire(entry.provider, entry.id);
      library.toast(`“${book.title}” is in your library`);
      markOwned(set, get, entry, book.id);
      if (openAfter) {
        set({ open: null });
        library.openBook(book.id);
      }
    } catch (e) {
      library.toast(`Couldn’t get “${entry.title}”: ${errorMessage(e)}`, "error");
    } finally {
      const { [key]: _, ...rest } = get().downloads;
      set({ downloads: rest });
    }
  },

  onDownloadProgress: (p) => {
    const key = listingKey(p);
    if (get().downloads[key]) set({ downloads: { ...get().downloads, [key]: p } });
  },
}));

/** Reflect a new acquisition everywhere the listing appears, without refetching. */
function markOwned(
  set: (p: Partial<DiscoverState>) => void,
  get: () => DiscoverState,
  entry: CatalogEntry,
  bookId: string,
) {
  const mark = (e: CatalogEntry) =>
    e.provider === entry.provider && e.id === entry.id ? { ...e, ownedBookId: bookId } : e;
  const { rows, results, open } = get();
  set({
    rows: rows.map((r) => ({ ...r, entries: r.entries.map(mark) })),
    results: results.map(mark),
    open:
      open && open.entry.id === entry.id
        ? {
            ...open,
            entry: mark(open.entry),
            detail: open.detail ? { ...open.detail, entry: mark(open.detail.entry) } : null,
          }
        : open,
  });
}
