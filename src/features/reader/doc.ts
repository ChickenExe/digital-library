/**
 * What the reader has open. A document has two halves that can differ:
 * - `source`: where its bytes come from (the library file, or a stream);
 * - `owner`:  where its reading position and notes are saved.
 * Keeping a streamed book moves the owner to the new library copy while the
 * pages on screen keep coming from the stream, so nothing reloads.
 */
import { create } from "zustand";
import type { BookFormat } from "../../bindings/BookFormat";
import type { ReadingProgress } from "../../bindings/ReadingProgress";
import type { StreamStatus } from "../../bindings/StreamStatus";
import { api } from "../../lib/api";
import type { ReaderTarget } from "../../store/library";

export type DocSource = { kind: "library"; bookId: string } | { kind: "stream"; key: string; provider: string; id: string };
export type DocOwner = { kind: "library"; bookId: string } | { kind: "stream"; provider: string; id: string };

export type ReaderDoc = {
  title: string;
  authors: string[];
  format: BookFormat;
  progress: ReadingProgress | null;
  source: DocSource;
  owner: DocOwner;
  /** Set while streaming. */
  stream?: StreamStatus;
};

/** The key notes are filed under: a library id, or "<provider>/<id>". */
export const ownerRef = (o: DocOwner) => (o.kind === "library" ? o.bookId : `${o.provider}/${o.id}`);

/** A stable id for the source, so engines reopen only when the bytes change. */
export const sourceKey = (s: DocSource) => (s.kind === "library" ? s.bookId : s.key);

export async function openDoc(target: ReaderTarget): Promise<ReaderDoc> {
  if (target.kind === "book") {
    const b = await api.getBook(target.id);
    const owner = { kind: "library", bookId: b.id } as const;
    return { title: b.title, authors: b.authors, format: b.format, progress: b.progress, source: owner, owner };
  }
  const s = await api.streamOpen(target.provider, target.id);
  return {
    title: s.title,
    authors: s.authors,
    format: "epub",
    progress: s.progress,
    source: { kind: "stream", key: s.key, provider: s.provider, id: s.id },
    owner: { kind: "stream", provider: s.provider, id: s.id },
    stream: s.status,
  };
}

export function saveDocProgress(owner: DocOwner, locator: string, percent: number) {
  return owner.kind === "library"
    ? api.saveProgress(owner.bookId, locator, percent)
    : api.streamSaveProgress(owner.provider, owner.id, locator, percent);
}

/** Lets go of a streamed book: it's discarded `keepMinutes` from now unless reopened. */
export function closeDoc(source: DocSource) {
  if (source.kind === "stream") {
    void api.streamClose(source.key, useStreamSettings.getState().keepMinutes).catch(() => {});
  }
}

/** How long a streamed book stays cached after it's closed. */
export const KEEP_OPTIONS = [
  { minutes: 0, label: "Now" },
  { minutes: 5, label: "5 min" },
  { minutes: 15, label: "15 min" },
  { minutes: 60, label: "1 hour" },
] as const;

const KEY = "folio.stream.v1";

export const useStreamSettings = create<{ keepMinutes: number; setKeepMinutes: (m: number) => void }>((set) => ({
  keepMinutes: (() => {
    const v = Number(JSON.parse(localStorage.getItem(KEY) ?? "{}").keepMinutes);
    return Number.isFinite(v) && v >= 0 ? v : 15;
  })(),
  setKeepMinutes: (keepMinutes) => {
    localStorage.setItem(KEY, JSON.stringify({ keepMinutes }));
    set({ keepMinutes });
  },
}));
