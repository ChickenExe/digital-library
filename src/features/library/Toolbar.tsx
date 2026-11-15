import { useMemo, useState } from "react";
import type { SortKey } from "../../bindings/SortKey";
import { debounce } from "../../lib/format";
import { useLibrary } from "../../store/library";
import styles from "./Toolbar.module.css";

const SORTS: { id: SortKey; label: string }[] = [
  { id: "recent", label: "Recently added" },
  { id: "lastRead", label: "Recently read" },
  { id: "title", label: "Title" },
  { id: "author", label: "Author" },
];

export function Toolbar() {
  const query = useLibrary((s) => s.query);
  const setQuery = useLibrary((s) => s.setQuery);
  const pickAndImport = useLibrary((s) => s.pickAndImport);
  const importing = useLibrary((s) => s.importing);
  const [search, setSearch] = useState(query.search ?? "");
  const pushSearch = useMemo(
    () => debounce((v: string) => setQuery({ search: v || undefined }), 150),
    [setQuery],
  );

  return (
    <header className={styles.toolbar}>
      <input
        className={styles.search}
        type="search"
        placeholder="Search titles, authors, descriptions…"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          pushSearch(e.target.value);
        }}
      />
      <select
        className={styles.select}
        value={query.sort}
        onChange={(e) => setQuery({ sort: e.target.value as SortKey })}
        aria-label="Sort by"
      >
        {SORTS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <button className="btn btn-primary" disabled={!!importing} onClick={() => void pickAndImport()}>
        Add books
      </button>
    </header>
  );
}
