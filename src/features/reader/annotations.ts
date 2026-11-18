/**
 * The open book's highlights and notes. Rust (SQLite) is the source of truth;
 * this is the reader's working copy, updated optimistically from each reply.
 */
import { create } from "zustand";
import type { Annotation } from "../../bindings/Annotation";
import type { AnnotationPatch } from "../../bindings/AnnotationPatch";
import type { NewAnnotation } from "../../bindings/NewAnnotation";
import { api } from "../../lib/api";

type State = {
  ref: string | null;
  items: Annotation[];
  load: (ref: string) => Promise<void>;
  add: (a: Omit<NewAnnotation, "bookRef">) => Promise<Annotation | null>;
  update: (id: string, patch: AnnotationPatch) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reset: () => void;
};

const byPosition = (a: Annotation, b: Annotation) => a.position - b.position || a.createdAt - b.createdAt;

export const useAnnotations = create<State>((set, get) => ({
  ref: null,
  items: [],
  load: async (ref) => {
    set({ ref, items: [] });
    const items = await api.listAnnotations(ref);
    if (get().ref === ref) set({ items });
  },
  add: async (a) => {
    const ref = get().ref;
    if (!ref) return null;
    const created = await api.addAnnotation({ ...a, bookRef: ref });
    if (get().ref === ref) set({ items: [...get().items, created].sort(byPosition) });
    return created;
  },
  update: async (id, patch) => {
    const updated = await api.updateAnnotation(id, patch);
    set({ items: get().items.map((a) => (a.id === id ? updated : a)) });
  },
  remove: async (id) => {
    set({ items: get().items.filter((a) => a.id !== id) });
    await api.deleteAnnotation(id);
  },
  reset: () => set({ ref: null, items: [] }),
}));

/** Markdown export of a book's notes, for pasting anywhere. */
export function annotationsMarkdown(title: string, authors: string[], items: Annotation[]): string {
  const lines = [`# ${title}`, authors.length ? `*${authors.join(", ")}*` : "", ""];
  let chapter: string | null = null;
  for (const a of items) {
    if (a.chapter && a.chapter !== chapter) {
      chapter = a.chapter;
      lines.push(`## ${chapter}`, "");
    }
    lines.push(...a.quote.split("\n").map((l) => `> ${l}`));
    if (a.note) lines.push("", a.note);
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}
