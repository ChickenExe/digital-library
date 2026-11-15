import type { Book } from "../bindings/Book";

export const authorLine = (book: Pick<Book, "authors">) =>
  book.authors.length ? book.authors.join(", ") : "Unknown author";

export const percentLabel = (p: number) => `${Math.round(p * 100)}%`;

export function fileSizeLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Stable hue per book so placeholder covers don't reshuffle between renders. */
export function hueFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const debounced = (...args: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  debounced.flush = (...args: A) => {
    clearTimeout(t);
    fn(...args);
  };
  return debounced;
}
