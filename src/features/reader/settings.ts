/**
 * Reader preferences, tuned for comfort over long sessions:
 * - No pure black on pure white; dark themes use soft text to avoid halation.
 * - A ~60–75 character measure, generous leading, ragged-right with hyphenation.
 * Persisted locally; applied live to EPUBs (and as a filter to PDFs).
 */
import { create } from "zustand";
import literataUrl from "@fontsource-variable/literata/files/literata-latin-wght-normal.woff2?url";
import literataItalicUrl from "@fontsource-variable/literata/files/literata-latin-wght-italic.woff2?url";
import atkinsonUrl from "@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2?url";
import atkinsonItalicUrl from "@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-italic.woff2?url";

export type ThemeId = "paper" | "sepia" | "dusk" | "night" | "vigil";
export type FontId = "literata" | "atkinson" | "publisher";
export type WidthId = "narrow" | "medium" | "wide";
export type FlowId = "paginated" | "scrolled";

export type ReaderTheme = {
  label: string;
  bg: string;
  text: string;
  muted: string;
  accent: string;
  /** CSS filter applied to rendered PDF pages so they match the theme. */
  pdfFilter: string;
  dark: boolean;
  /** Headings set in the accent colour, like the red rubrics of liturgical books. */
  rubrics?: boolean;
};

export const THEMES: Record<ThemeId, ReaderTheme> = {
  paper: { label: "Paper", bg: "#f6f1e7", text: "#2c2a26", muted: "#8b857a", accent: "#b4532a", pdfFilter: "none", dark: false },
  sepia: { label: "Sepia", bg: "#efe2c6", text: "#43361f", muted: "#8c7a58", accent: "#9c4a1e", pdfFilter: "sepia(0.35) brightness(0.96)", dark: false },
  dusk: { label: "Dusk", bg: "#2d2f33", text: "#d6d1c6", muted: "#8d8a83", accent: "#e8875f", pdfFilter: "invert(0.86) hue-rotate(180deg) brightness(1.05)", dark: true },
  night: { label: "Night", bg: "#151413", text: "#b9b2a5", muted: "#6f6a62", accent: "#d9774f", pdfFilter: "invert(0.9) hue-rotate(180deg) brightness(0.92)", dark: true },
  // Holy Scripture's palette: black page, bone text, cinnabar rubrics. High contrast,
  // but bone rather than pure white so it stays comfortable for long reading.
  vigil: { label: "Vigil", bg: "#0a0a0a", text: "#e6e0d3", muted: "#7d786e", accent: "#d2452f", pdfFilter: "invert(0.92) hue-rotate(180deg)", dark: true, rubrics: true },
};

export const FONTS: Record<FontId, { label: string; family: string; note: string }> = {
  literata: { label: "Literata", family: "'Reader Literata', Georgia, serif", note: "Serif, made for long reading" },
  atkinson: { label: "Atkinson", family: "'Reader Atkinson', system-ui, sans-serif", note: "Sans, maximum legibility" },
  publisher: { label: "Original", family: "inherit", note: "The book's own typography" },
};

export const WIDTHS: Record<WidthId, { label: string; px: number }> = {
  narrow: { label: "Narrow", px: 560 },
  medium: { label: "Medium", px: 680 },
  wide: { label: "Wide", px: 820 },
};

export const LEADINGS = [1.45, 1.6, 1.8] as const;
export const SIZE_MIN = 14;
export const SIZE_MAX = 30;

export type ReaderSettings = {
  theme: ThemeId;
  font: FontId;
  size: number;
  leading: (typeof LEADINGS)[number];
  width: WidthId;
  flow: FlowId;
};

const KEY = "folio.reader.v1";

function initial(): ReaderSettings {
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const defaults: ReaderSettings = {
    theme: prefersDark ? "night" : "paper",
    font: "literata",
    size: 19,
    leading: 1.6,
    width: "medium",
    flow: "paginated",
  };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return defaults;
  }
}

type Store = ReaderSettings & {
  /**
   * A collection's palette for the current reading session (e.g. Holy Scripture
   * opens in Vigil). Not persisted; choosing a theme yourself replaces it.
   */
  sessionTheme: ThemeId | null;
  set: (patch: Partial<ReaderSettings>) => void;
  setSessionTheme: (theme: ThemeId | null) => void;
};

export const useReaderSettings = create<Store>((set, get) => ({
  ...initial(),
  sessionTheme: null,
  set: (patch) => {
    set(patch.theme ? { ...patch, sessionTheme: null } : patch);
    const { set: _a, setSessionTheme: _b, sessionTheme: _c, ...data } = { ...get() };
    localStorage.setItem(KEY, JSON.stringify(data));
  },
  setSessionTheme: (sessionTheme) => set({ sessionTheme }),
}));

/** The theme actually in effect: a collection's session palette, else the user's choice. */
export const useEffectiveTheme = (): ThemeId => useReaderSettings((s) => s.sessionTheme ?? s.theme);

export const isThemeId = (v: unknown): v is ThemeId => typeof v === "string" && v in THEMES;

const abs = (u: string) => new URL(u, window.location.href).href;

/** The reading typefaces, as @font-face rules usable in any document (app or book iframe). */
const FONT_FACES = `
@font-face { font-family: 'Reader Literata'; src: url(${abs(literataUrl)}) format('woff2'); font-weight: 200 900; }
@font-face { font-family: 'Reader Literata'; src: url(${abs(literataItalicUrl)}) format('woff2'); font-weight: 200 900; font-style: italic; }
@font-face { font-family: 'Reader Atkinson'; src: url(${abs(atkinsonUrl)}) format('woff2'); font-weight: 200 800; }
@font-face { font-family: 'Reader Atkinson'; src: url(${abs(atkinsonItalicUrl)}) format('woff2'); font-weight: 200 800; font-style: italic; }
`;

// Also available in the app itself, for the settings panel previews.
if (!document.getElementById("reader-fonts")) {
  const style = document.createElement("style");
  style.id = "reader-fonts";
  style.textContent = FONT_FACES;
  document.head.appendChild(style);
}

/** Stylesheet injected into each EPUB page (iframe). */
export function epubCss(s: ReaderSettings): string {
  const t = THEMES[s.theme];
  const font = FONTS[s.font];
  const enforceFont = s.font !== "publisher";
  // color-scheme must match the reader container's, or browsers paint the book's
  // iframe with an opaque (white) backdrop.
  return `${FONT_FACES}
:root { color-scheme: ${t.dark ? "dark" : "light"}; }
html, body { background: transparent !important; }
body {
  color: ${t.text} !important;
  font-size: ${s.size}px !important;
  line-height: ${s.leading} !important;
  ${enforceFont ? `font-family: ${font.family} !important;` : ""}
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  font-kerning: normal;
  hyphens: auto;
  -webkit-hyphens: auto;
  overflow-wrap: break-word;
}
body * { color: inherit !important; background-color: transparent !important; border-color: ${t.muted} !important; }
${enforceFont ? `body *:not(pre):not(code):not(kbd) { font-family: inherit !important; }` : ""}
${t.rubrics ? `h1, h2, h3, h4, h1 *, h2 *, h3 *, h4 * { color: ${t.accent} !important; letter-spacing: 0.04em; }` : ""}
p, li, blockquote, dd { line-height: inherit !important; text-align: left !important; }
h1, h2, h3, h4 { line-height: 1.25 !important; text-align: left !important; font-weight: 600 !important; }
a, a * { color: ${t.accent} !important; text-decoration-thickness: 1px; }
img, svg { max-width: 100% !important; height: auto !important; ${t.dark ? "filter: brightness(0.85) contrast(0.95);" : ""} }
::selection { background: ${t.accent}40; }
`;
}

/**
 * Highlighter inks. On light pages they multiply into the paper like a real
 * marker; on dark pages they're deeper shades that *screen* over the page, so
 * the text stays readable on top.
 */
export const HIGHLIGHTS = {
  yellow: { label: "Yellow", light: "#f4d35e", dark: "#8c7a1f" },
  green: { label: "Green", light: "#a8d88a", dark: "#3f7038" },
  blue: { label: "Blue", light: "#9cc9f0", dark: "#2f5f8e" },
  pink: { label: "Pink", light: "#f4a8c6", dark: "#8c3f62" },
} as const;

export type HighlightInk = { color: string; blend: "multiply" | "screen"; opacity: number };

export function highlightInk(color: keyof typeof HIGHLIGHTS, dark: boolean): HighlightInk {
  const c = HIGHLIGHTS[color];
  return dark ? { color: c.dark, blend: "screen", opacity: 0.85 } : { color: c.light, blend: "multiply", opacity: 0.8 };
}
