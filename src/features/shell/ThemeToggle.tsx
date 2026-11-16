import { useTheme } from "../../lib/theme";

const LABEL = { system: "Auto", light: "Light", dark: "Dark" } as const;

/** Cycles System → Light → Dark. The glyph shows the theme currently in effect. */
export function ThemeToggle() {
  const pref = useTheme((s) => s.pref);
  const resolved = useTheme((s) => s.resolved);
  const cycle = useTheme((s) => s.cycle);
  return (
    <button
      className="btn"
      onClick={cycle}
      aria-label={`Theme: ${LABEL[pref]} (click to change)`}
      title="Theme: Auto → Light → Dark"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
        <circle cx="6" cy="6" r="5.25" fill="none" stroke="currentColor" />
        <path d="M6 0.75a5.25 5.25 0 0 1 0 10.5z" fill="currentColor" transform={resolved === "dark" ? "rotate(180 6 6)" : undefined} />
      </svg>
      {LABEL[pref]}
    </button>
  );
}
