import type { Shelf } from "../../bindings/Shelf";
import type { BookFormat } from "../../bindings/BookFormat";
import { useLibrary } from "../../store/library";
import styles from "./Sidebar.module.css";

const SHELVES: { id: Shelf; label: string; count: (s: ReturnType<typeof useStats>) => number }[] = [
  { id: "all", label: "All books", count: (s) => s.total },
  { id: "reading", label: "Continue reading", count: (s) => s.reading },
  { id: "favorites", label: "Favorites", count: (s) => s.favorites },
  { id: "finished", label: "Finished", count: (s) => s.finished },
];

const FORMATS: { id: BookFormat | undefined; label: string }[] = [
  { id: undefined, label: "Any format" },
  { id: "epub", label: "EPUB" },
  { id: "pdf", label: "PDF" },
];

const useStats = () => useLibrary((s) => s.stats);

export function Sidebar() {
  const stats = useStats();
  const query = useLibrary((s) => s.query);
  const setQuery = useLibrary((s) => s.setQuery);

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>Digital Library</div>

      <nav className={styles.section}>
        <div className={styles.heading}>Library</div>
        {SHELVES.map((s) => (
          <button
            key={s.id}
            className={`${styles.item} ${query.shelf === s.id ? styles.active : ""}`}
            onClick={() => setQuery({ shelf: s.id })}
          >
            <span>{s.label}</span>
            <span className={styles.count}>{s.count(stats)}</span>
          </button>
        ))}
      </nav>

      <nav className={styles.section}>
        <div className={styles.heading}>Format</div>
        {FORMATS.map((f) => (
          <button
            key={f.label}
            className={`${styles.item} ${query.format === f.id ? styles.active : ""}`}
            onClick={() => setQuery({ format: f.id })}
          >
            {f.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
