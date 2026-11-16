import { useEffect, useMemo, useRef, useState } from "react";
import type { CatalogRow } from "../../bindings/CatalogRow";
import { debounce, pad2 } from "../../lib/format";
import { useDiscover } from "../../store/discover";
import { CatalogCard } from "./CatalogCard";
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

/** 02 — Discover: the free catalog, front page and search. */
export function DiscoverView() {
  const status = useDiscover((s) => s.status);
  const rows = useDiscover((s) => s.rows);
  const browse = useDiscover((s) => s.browse);
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
          {rows.map((row, i) => (
            <ShelfRow key={row.id} row={row} index={i + 1} ranked={i === 0} />
          ))}
          <p className={`${styles.credit} mono`}>
            Free public-domain books from Project Gutenberg · More stores coming soon
          </p>
        </div>
      )}
    </main>
  );
}

function DiscoverToolbar() {
  const browse = useDiscover((s) => s.browse);
  const setBrowse = useDiscover((s) => s.setBrowse);
  const language = useDiscover((s) => s.language);
  const setLanguage = useDiscover((s) => s.setLanguage);
  const status = useDiscover((s) => s.status);
  const [text, setText] = useState(browse?.search ?? "");
  const push = useMemo(
    () =>
      debounce((v: string) => {
        const q = v.trim();
        setBrowse(q ? { search: q, category: null, title: `“${q}”` } : null);
      }, 200),
    [setBrowse],
  );
  useEffect(() => {
    if (!browse) setText("");
  }, [browse]);

  const count = status?.entries ? `${Math.floor(status.entries / 1000)},000+` : "70,000+";
  return (
    <header className={styles.toolbar}>
      {browse && (
        <button className="btn" onClick={() => setBrowse(null)}>
          ← Front page
        </button>
      )}
      <input
        data-search
        className={`${styles.search} mono`}
        type="search"
        placeholder={`Search ${count} free books · title, author, subject`}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          push(e.target.value);
        }}
      />
      <select
        className={`${styles.select} mono`}
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

function ShelfRow({ row, index, ranked }: { row: CatalogRow; index: number; ranked: boolean }) {
  const setBrowse = useDiscover((s) => s.setBrowse);
  const track = useRef<HTMLDivElement>(null);
  const scroll = (dir: 1 | -1) =>
    track.current?.scrollBy({ left: dir * track.current.clientWidth * 0.85, behavior: "smooth" });
  return (
    <section className={styles.row}>
      <div className={styles.rowHeader}>
        <div>
          <div className="mono" style={{ color: "var(--color-text-muted)" }}>
            2.{index}
          </div>
          <h2>{row.title}</h2>
        </div>
        <div className={styles.rowActions}>
          {row.category && (
            <button className="btn" onClick={() => setBrowse({ search: "", category: row.category, title: row.title })}>
              See all
            </button>
          )}
          <button className={styles.arrow} onClick={() => scroll(-1)} aria-label="Scroll left">
            ←
          </button>
          <button className={styles.arrow} onClick={() => scroll(1)} aria-label="Scroll right">
            →
          </button>
        </div>
      </div>
      <div ref={track} className={styles.track}>
        {row.entries.map((e, i) => (
          <div key={e.id} className={styles.trackItem}>
            <CatalogCard entry={e} label={ranked ? `#${pad2(i + 1)}` : undefined} />
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
        <div className="mono" style={{ color: "var(--color-text-muted)" }}>
          {total.toLocaleString()} books
        </div>
        <h2>{browse.title}</h2>
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
      <div className="mono">2.0 — Setting up Discover</div>
      <h2>
        {status?.phase === "error" ? "Offline" : "Indexing"}
        <br />
        the stacks
      </h2>
      <p>
        {status?.phase === "error"
          ? `We couldn’t reach the catalog: ${status.message ?? "unknown error"}`
          : (status?.message ?? "Preparing the catalog of free books…")}
      </p>
      {status?.phase === "error" ? (
        <button className="btn btn-primary btn-lg" onClick={retry}>
          Try again
        </button>
      ) : (
        <div className={styles.spinner} />
      )}
    </div>
  );
}
