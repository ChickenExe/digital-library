import { useEffect, useMemo, useRef, useState } from "react";
import type { CatalogRow } from "../../bindings/CatalogRow";
import { debounce } from "../../lib/format";
import { useDiscover } from "../../store/discover";
import { CatalogCard } from "./CatalogCard";
import { ListingSheet } from "./ListingSheet";
import { Spotlight } from "./Spotlight";
import styles from "./DiscoverView.module.css";

const LANGUAGES: { code: string | null; label: string }[] = [
  { code: "en", label: "English" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "es", label: "Spanish" },
  { code: "it", label: "Italian" },
  { code: "nl", label: "Dutch" },
  { code: "fi", label: "Finnish" },
  { code: null, label: "All languages" },
];

export function DiscoverView() {
  const status = useDiscover((s) => s.status);
  const rows = useDiscover((s) => s.rows);
  const browse = useDiscover((s) => s.browse);
  const open = useDiscover((s) => s.open);

  const ready = !!status && status.entries > 0;
  return (
    <main className={styles.main}>
      <DiscoverToolbar />
      {!ready ? (
        <CatalogSetup />
      ) : browse ? (
        <BrowseResults />
      ) : (
        <div className={styles.scroll}>
          {rows[0]?.entries[0] && <Spotlight entry={rows[0].entries[0]} />}
          {rows.map((row) => (
            <ShelfRow key={row.id} row={row} />
          ))}
          <p className={styles.credit}>
            Free public-domain books from Project Gutenberg. More stores coming soon.
          </p>
        </div>
      )}
      {open && <ListingSheet />}
    </main>
  );
}

function DiscoverToolbar() {
  const browse = useDiscover((s) => s.browse);
  const setBrowse = useDiscover((s) => s.setBrowse);
  const language = useDiscover((s) => s.language);
  const setLanguage = useDiscover((s) => s.setLanguage);
  const [text, setText] = useState(browse?.search ?? "");
  const push = useMemo(
    () =>
      debounce((v: string) => {
        const q = v.trim();
        setBrowse(q ? { search: q, category: null, title: `Results for “${q}”` } : null);
      }, 200),
    [setBrowse],
  );
  useEffect(() => {
    if (!browse) setText("");
  }, [browse]);

  return (
    <header className={styles.toolbar}>
      {browse && (
        <button className="btn" onClick={() => setBrowse(null)}>
          ← Discover
        </button>
      )}
      <input
        className={styles.search}
        type="search"
        placeholder="Search 70,000+ free books by title, author or subject…"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          push(e.target.value);
        }}
      />
      <select
        className={styles.select}
        value={language ?? ""}
        onChange={(e) => setLanguage(e.target.value || null)}
        aria-label="Language"
      >
        {LANGUAGES.map((l) => (
          <option key={l.label} value={l.code ?? ""}>
            {l.label}
          </option>
        ))}
      </select>
    </header>
  );
}

function ShelfRow({ row }: { row: CatalogRow }) {
  const setBrowse = useDiscover((s) => s.setBrowse);
  const track = useRef<HTMLDivElement>(null);
  const scroll = (dir: 1 | -1) =>
    track.current?.scrollBy({ left: dir * track.current.clientWidth * 0.85, behavior: "smooth" });
  return (
    <section className={styles.row}>
      <div className={styles.rowHeader}>
        <h2>{row.title}</h2>
        <div className={styles.rowActions}>
          {row.category && (
            <button
              className={styles.link}
              onClick={() => setBrowse({ search: "", category: row.category, title: row.title })}
            >
              See all
            </button>
          )}
          <button className={styles.arrow} onClick={() => scroll(-1)} aria-label="Scroll left">
            ‹
          </button>
          <button className={styles.arrow} onClick={() => scroll(1)} aria-label="Scroll right">
            ›
          </button>
        </div>
      </div>
      <div ref={track} className={styles.track}>
        {row.entries.map((e) => (
          <div key={e.id} className={styles.trackItem}>
            <CatalogCard entry={e} />
          </div>
        ))}
      </div>
    </section>
  );
}

function BrowseResults() {
  const browse = useDiscover((s) => s.browse)!;
  const results = useDiscover((s) => s.results);
  const total = useDiscover((s) => s.total);
  const loadMore = useDiscover((s) => s.loadMore);
  const sentinel = useRef<HTMLDivElement>(null);

  // Infinite scroll.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && void loadMore(), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, results.length]);

  return (
    <div className={styles.scroll}>
      <div className={styles.browseHeader}>
        <h2>{browse.title}</h2>
        <span>{total.toLocaleString()} books</span>
      </div>
      <div className={styles.grid}>
        {results.map((e) => (
          <CatalogCard key={e.id} entry={e} />
        ))}
      </div>
      <div ref={sentinel} />
    </div>
  );
}

function CatalogSetup() {
  const status = useDiscover((s) => s.status);
  const retry = () => void import("../../lib/api").then(({ api }) => api.catalogSync(true));
  return (
    <div className={styles.setup}>
      <h2>Setting up Discover</h2>
      <p>
        {status?.phase === "error"
          ? `We couldn’t reach the catalog: ${status.message ?? "unknown error"}`
          : (status?.message ?? "Preparing the catalog of free books…")}
      </p>
      {status?.phase === "error" ? (
        <button className="btn btn-primary" onClick={retry}>
          Try again
        </button>
      ) : (
        <div className={styles.spinner} />
      )}
    </div>
  );
}
