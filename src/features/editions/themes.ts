/**
 * Visual themes for collected editions. Each one scopes a palette onto the
 * shell (via `data-edition-theme`) and picks the reader palette its books open in.
 */
export type EditionTheme = {
  /** Reader palette for books opened from this edition (see reader/settings.ts). */
  readerTheme: string;
};

export const EDITION_THEMES: Record<string, EditionTheme> = {
  orthodox: { readerTheme: "vigil" },
};
