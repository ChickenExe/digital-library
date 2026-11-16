import { useMemo, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import type { BookFormat } from "../../bindings/BookFormat";
import type { Shelf } from "../../bindings/Shelf";
import type { SortKey } from "../../bindings/SortKey";
import { debounce, volumeLabel } from "../../lib/format";
import { EASE, SPRING } from "../../lib/motion";
import { MaskNumber } from "../../components/motion/MaskNumber";
import { Scramble } from "../../components/motion/Scramble";
import { useLibrary } from "../../store/library";
import { BookCard, BOOK_CARD_CHROME } from "./BookCard";
import { VirtualGrid } from "../../components/VirtualGrid";

/** Up to this many books, filtering animates the grid; beyond it, the grid is virtualized. */
const ANIMATED_GRID_MAX = 150;
import styles from "./LibraryView.module.css";

const SHELVES: { id: Shelf; label: string; count: (s: ReturnType<typeof useStats>) => number }[] = [
  { id: "all", label: "All", count: (s) => s.total },
  { id: "reading", label: "Reading", count: (s) => s.reading },
  { id: "favorites", label: "Favorites", count: (s) => s.favorites },
  { id: "finished", label: "Finished", count: (s) => s.finished },
];
const FORMATS: { id: BookFormat | undefined; label: string }[] = [
  { id: undefined, label: "Any format" },
  { id: "epub", label: "EPUB" },
  { id: "pdf", label: "PDF" },
];
const SORTS: { id: SortKey; label: string }[] = [
  { id: "recent", label: "Newest volumes" },
  { id: "lastRead", label: "Recently read" },
  { id: "title", label: "Title" },
  { id: "author", label: "Author" },
];

const useStats = () => useLibrary((s) => s.stats);

/** 03 — Collection: everything you own, numbered. */
export function LibraryView() {
  const books = useLibrary((s) => s.books);
  const loaded = useLibrary((s) => s.loaded);
  const query = useLibrary((s) => s.query);
  const setQuery = useLibrary((s) => s.setQuery);
  const stats = useStats();
  const [search, setSearch] = useState(query.search ?? "");
  const pushSearch = useMemo(() => debounce((v: string) => setQuery({ search: v || undefined }), 150), [setQuery]);

  return (
    <main className={styles.main}>
      <div className={styles.head}>
        <div className={styles.titleRow}>
          <div>
            <div className="section-label mono">
              <span>
                <b>3.1</b> — <Scramble text="Collection" />
              </span>
            </div>
            <h1 className={styles.title}>
              <MaskNumber value={volumeLabel(stats.total)} /> <span className={`${styles.unit} rise-in`}>volumes</span>
            </h1>
          </div>
          <div className={styles.controls}>
            <input
              className={`${styles.search} mono`}
              type="search"
              placeholder="Search your collection"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                pushSearch(e.target.value);
              }}
            />
            <select
              className={`${styles.select} mono`}
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
          </div>
        </div>
        <div className={`${styles.tabs} mono`}>
          {SHELVES.map((s, i) => (
            <button
              key={s.id}
              className={query.shelf === s.id ? styles.on : ""}
              onClick={() => setQuery({ shelf: s.id })}
            >
              {query.shelf === s.id && <m.span layoutId="shelf-pill" className={styles.pill} transition={SPRING.pill} />}
              <span className={styles.tabLabel}>
                <b>{String(i + 1).padStart(2, "0")}</b>
                {s.label}
                <em>{s.count(stats)}</em>
              </span>
            </button>
          ))}
          <span className={styles.divider} />
          {FORMATS.map((f) => (
            <button
              key={f.label}
              className={query.format === f.id ? styles.on : ""}
              onClick={() => setQuery({ format: f.id })}
            >
              {query.format === f.id && <m.span layoutId="format-pill" className={styles.pill} transition={SPRING.pill} />}
              <span className={styles.tabLabel}>{f.label}</span>
            </button>
          ))}
        </div>
      </div>

      {loaded && books.length === 0 ? (
        <EmptyState filtered={stats.total > 0 || !!query.search} />
      ) : books.length > ANIMATED_GRID_MAX ? (
        // Large collections: windowed grid. Only visible rows exist, so memory stays flat.
        <VirtualGrid
          items={books}
          getKey={(b) => b.id}
          render={(b) => <BookCard book={b} />}
          minColumnWidth={132}
          itemHeight={(w) => w * 1.5 + BOOK_CARD_CHROME}
          gap={{ row: 32, column: 24 }}
          padding={{ x: 48, top: 32, bottom: 48 }}
        />
      ) : (
        <m.div className={styles.grid} layoutScroll>
          {/* Filtering and sorting re-flow the grid: survivors glide, leavers shrink away. */}
          <AnimatePresence mode="popLayout" initial={true}>
            {books.map((b, i) => (
              <m.div
                key={b.id}
                layout="position"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE.out, delay: Math.min(i, 18) * 0.025 } }}
                exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.18, ease: EASE.in } }}
                transition={SPRING.panel}
              >
                <BookCard book={b} />
              </m.div>
            ))}
          </AnimatePresence>
        </m.div>
      )}
    </main>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  const pickAndImport = useLibrary((s) => s.pickAndImport);
  const navigate = useLibrary((s) => s.navigate);
  return (
    <div className={styles.empty}>
      <div className={styles.emptyNum}>000</div>
      {filtered ? (
        <p>No volumes match this view.</p>
      ) : (
        <>
          <p>Your collection starts here. Find a free classic, or bring your own EPUB and PDF files.</p>
          <div className={styles.emptyActions}>
            <button className="btn btn-primary btn-lg" onClick={() => navigate("discover")}>
              Browse free books
            </button>
            <button className="btn btn-lg" onClick={() => void pickAndImport()}>
              Add files
            </button>
          </div>
        </>
      )}
    </div>
  );
}
