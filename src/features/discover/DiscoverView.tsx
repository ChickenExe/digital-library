import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { CatalogRow } from "../../bindings/CatalogRow";
import { debounce, pad2 } from "../../lib/format";
import { rise, stagger, tween } from "../../lib/motion";
import { Scramble } from "../../components/motion/Scramble";
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
  const browse = useDiscover((s) => s.browse);
  const ready = !!status && status.entries > 0;

  return (
    <main className={styles.main}>
      <DiscoverToolbar />
      <AnimatePresence mode="wait" initial={false}>
        {!ready ? (
          <Fade key="setup">
            <CatalogSetup />
          </Fade>
        ) : browse ? (
          <Fade key={`browse:${browse.category ?? ""}:${browse.search}`}>
            <BrowseResults />
          </Fade>
        ) : (
          <Fade key="front">
            <FrontPage />
          </Fade>
        )}
      </AnimatePresence>
    </main>
  );
}

/** Swaps between front page, results and setup with a quick crossfade + lift. */
function Fade({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      className={styles.fade}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0, transition: tween(0.36) }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
    >
      {children}
    </motion.div>
  );
}

function FrontPage() {
  const rows = useDiscover((s) => s.rows);
  const scroller = useRef<HTMLDivElement>(null);
  return (
    <motion.div ref={scroller} className={styles.scroll}>
      {rows[0]?.entries[0] && <Spotlight entry={rows[0].entries[0]} />}
      {rows.map((row, i) => (
        <ShelfRow key={row.id} row={row} index={i + 1} ranked={i === 0} root={scroller} />
      ))}
      <p className={`${styles.credit} mono`}>Free public-domain books from Project Gutenberg · More stores coming soon</p>
    </motion.div>
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

type RowProps = { row: CatalogRow; index: number; ranked: boolean; root: React.RefObject<HTMLDivElement | null> };

/** A shelf that reveals as it scrolls into view: hairline draws, covers deal in left to right. */
function ShelfRow({ row, index, ranked, root }: RowProps) {
  const setBrowse = useDiscover((s) => s.setBrowse);
  const track = useRef<HTMLDivElement>(null);
  const scroll = (dir: 1 | -1) =>
    track.current?.scrollBy({ left: dir * track.current.clientWidth * 0.85, behavior: "smooth" });
  return (
    <motion.section
      className={styles.row}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, root, amount: 0.25 }}
      variants={stagger(0.035)}
    >
      <motion.div className={styles.rowHeader} variants={rise}>
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
      </motion.div>
      <motion.div ref={track} className={styles.track} variants={stagger(0.035, 0.05)}>
        {row.entries.map((e, i) => (
          <motion.div key={e.id} className={styles.trackItem} variants={rise}>
            <CatalogCard entry={e} label={ranked ? `#${pad2(i + 1)}` : undefined} morphKey={`${row.id}:${e.id}`} />
          </motion.div>
        ))}
      </motion.div>
    </motion.section>
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
    <motion.div className={styles.scroll}>
      <div className={styles.browseHeader}>
        <div className="mono" style={{ color: "var(--color-text-muted)" }}>
          {total.toLocaleString()} books
        </div>
        <h2>{browse.title}</h2>
      </div>
      <div className={styles.grid}>
        {results.map((e, i) => (
          <div key={e.id} className="rise-in" style={{ "--i": i % 48 } as React.CSSProperties}>
            <CatalogCard entry={e} morphKey={`browse:${e.id}`} />
          </div>
        ))}
      </div>
      <div ref={sentinel} />
    </motion.div>
  );
}

function CatalogSetup() {
  const status = useDiscover((s) => s.status);
  const retry = () => void import("../../lib/api").then(({ api }) => api.catalogSync(true));
  return (
    <div className={styles.setup}>
      <div className="mono">
        2.0 — <Scramble text="Setting up Discover" />
      </div>
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
