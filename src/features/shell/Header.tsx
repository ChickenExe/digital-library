import { m } from "motion/react";
import { SPRING } from "../../lib/motion";
import type { Section } from "../../store/library";
import { useLibrary } from "../../store/library";
import { useDiscover } from "../../store/discover";
import { ThemeToggle } from "./ThemeToggle";
import { WindowControls } from "./WindowControls";
import styles from "./Header.module.css";

const NAV: { id: Section; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "discover", label: "Discover" },
  { id: "collection", label: "Collection" },
  { id: "circles", label: "Circles" },
];

const IS_MAC = navigator.userAgent.includes("Mac");

export function Header() {
  const view = useLibrary((s) => (s.view.kind === "reader" ? s.view.returnTo : s.view.kind));
  const navigate = useLibrary((s) => s.navigate);
  const importing = useLibrary((s) => s.importing);
  const pickAndImport = useLibrary((s) => s.pickAndImport);
  const setBrowse = useDiscover((s) => s.setBrowse);

  return (
    // The header doubles as the window's title bar: its empty space drags the
    // window (double-click maximizes) wherever the native frame is hidden.
    <header className={styles.header} data-tauri-drag-region>
      <button className={styles.logo} onClick={() => navigate("home")}>
        FOLIO<i />
      </button>
      <nav className={`${styles.nav} mono`}>
        {NAV.map((n, i) => (
          <button
            key={n.id}
            className={view === n.id ? styles.on : ""}
            onClick={() => {
              if (n.id === "discover" && view === "discover") setBrowse(null);
              navigate(n.id);
            }}
          >
            {view === n.id && <m.span layoutId="nav-pill" className={styles.pill} transition={SPRING.pill} />}
            <span className={styles.label}>
              <b>0{i + 1}</b>
              {n.label}
            </span>
          </button>
        ))}
      </nav>
      <div className={styles.tools}>
        <ThemeToggle />
        <button className="btn" disabled={!!importing} onClick={() => void pickAndImport()}>
          + Add files
        </button>
        <button
          className="btn"
          onClick={() => {
            navigate("discover");
            requestAnimationFrame(() => document.querySelector<HTMLInputElement>("[data-search]")?.focus());
          }}
        >
          Search <span className={styles.kbd}>{IS_MAC ? "⌘K" : "Ctrl K"}</span>
        </button>
      </div>
      <WindowControls className={styles.caption} />
    </header>
  );
}
