/**
 * The contract between the reader shell (ReaderView) and its engines
 * (EpubReader, PdfReader). Engines turn clicks and selections in the page into
 * these plain values; the shell owns every popover, panel and the database.
 */
import type { Annotation } from "../../bindings/Annotation";
import type { ReaderDoc } from "./doc";
import type { TocItem } from "./ContentsPanel";

/** A rectangle in viewport (window) coordinates. */
export type Rect = { left: number; top: number; width: number; height: number };

export type ReadingInfo = { chapter?: string; minutesLeft?: number };
/** Readers report position through this; the shell persists it (debounced). */
export type ProgressHandler = (locator: string, percent: number, info?: ReadingInfo) => void;

/** Text the reader has just selected, ready to become a highlight. */
export type SelectionDraft = {
  locator: string;
  quote: string;
  chapter?: string;
  /** 0..1 through the book. */
  position: number;
  rect: Rect;
  /** Clears the selection in the page. */
  clear: () => void;
};

/** A footnote, endnote, citation or in-document link to show in place. */
export type Footnote = {
  kind: "note" | "citation" | "link";
  /** "Note 12", "Citation", "Page 214"… */
  label: string;
  rect: Rect;
  /** Fills the popover body; may return a cleanup. */
  render: (el: HTMLElement) => void | (() => void);
  /** Jumps to the note itself. */
  go: () => void;
};

export type EngineProps = {
  doc: ReaderDoc;
  initialLocator?: string;
  onProgress: ProgressHandler;
  onContents?: (items: TocItem[], go: (href: string) => void) => void;
  annotations: Annotation[];
  onSelection: (selection: SelectionDraft | null) => void;
  onAnnotationClick: (id: string, rect: Rect) => void;
  onFootnote: (note: Footnote) => void;
  /** Receives a function that shows any locator (progress or annotation). */
  onNavigator: (go: (locator: string) => void) => void;
};

export const unionRect = (rects: Iterable<DOMRect | Rect>): Rect | null => {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const x of rects) {
    if (!x.width && !x.height) continue;
    l = Math.min(l, x.left);
    t = Math.min(t, x.top);
    r = Math.max(r, x.left + x.width);
    b = Math.max(b, x.top + x.height);
  }
  return l === Infinity ? null : { left: l, top: t, width: r - l, height: b - t };
};

/** Offsets a rect measured inside an iframe into the parent window's coordinates. */
export const fromFrame = (rect: Rect, frame: Element | null | undefined): Rect => {
  // Copy fields explicitly: a DOMRect's are prototype getters, which spreading drops.
  const f = frame?.getBoundingClientRect();
  return { left: rect.left + (f?.left ?? 0), top: rect.top + (f?.top ?? 0), width: rect.width, height: rect.height };
};
