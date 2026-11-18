// Minimal typings for the parts of foliate-js (MIT) the reader uses.
declare module "foliate-js/view.js" {
  export type FoliateTocItem = { label: string; href: string; subitems?: FoliateTocItem[] };
  export type FoliateBook = {
    metadata?: { title?: unknown; language?: unknown };
    toc?: FoliateTocItem[];
    rendition?: { layout?: string };
    sections: unknown[];
  };
  export type RelocateDetail = {
    fraction: number;
    cfi: string;
    tocItem?: { label?: string };
    time?: { section: number; total: number };
  };
  export interface FoliateRenderer extends HTMLElement {
    setStyles?(css: string | [string, string]): void;
    next(): Promise<void>;
    prev(): Promise<void>;
  }
  export interface FoliateView extends HTMLElement {
    book: FoliateBook;
    renderer: FoliateRenderer;
    isFixedLayout: boolean;
    open(book: File | Blob | string): Promise<void>;
    init(opts: { lastLocation?: string | null; showTextStart?: boolean }): Promise<void>;
    goTo(target: string | number): Promise<unknown>;
    goToFraction(f: number): Promise<void>;
    prev(distance?: number): Promise<void>;
    next(distance?: number): Promise<void>;
    close(): void;
  }
  export function makeBook(file: File | Blob | string): Promise<FoliateBook>;
}
