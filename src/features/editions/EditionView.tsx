import "@fontsource-variable/literata/wght.css"; // Greek (incl. polytonic) for the liturgical type
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CatalogEntry } from "../../bindings/CatalogEntry";
import type { Edition } from "../../bindings/Edition";
import type { EditionItem } from "../../bindings/EditionItem";
import type { EditionSection } from "../../bindings/EditionSection";
import { api, errorMessage, events, listingKey } from "../../lib/api";
import { debounce } from "../../lib/format";
import { Scramble } from "../../components/motion/Scramble";
import { MaskNumber } from "../../components/motion/MaskNumber";
import { useDiscover } from "../../store/discover";
import { useLibrary } from "../../store/library";
import { OrthodoxCross } from "./OrthodoxCross";
import { EDITION_THEMES } from "./themes";
import styles from "./EditionView.module.css";

/** 5.x — A collected edition: a book or series with its own designed home. */
export default function EditionView({ id }: { id: string }) {
  const edition = useEdition(id);
  const back = useLibrary((s) => s.editionReturn);
  const navigate = useLibrary((s) => s.navigate);
  const collect = useCollectAll(edition);

  if (!edition) return <main className={styles.page} />;
  const { summary } = edition;
  const canon = edition.sections.filter((s) => s.part !== "Tradition");
  const tradition = edition.sections.filter((s) => s.part === "Tradition");
  const readerTheme = EDITION_THEMES[summary.theme]?.readerTheme;

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroText}>
          <div className={`section-label mono ${styles.topRow}`}>
            <span>
              <b>5.0</b> — <Scramble text={`Collected edition · ${summary.subtitle}`} />
            </span>
            <button className="mono" onClick={() => navigate(back)}>
              ← Back
            </button>
          </div>

          <h1 className={styles.title} aria-label={summary.title}>
            {summary.title.split(" ").map((w, i) => (
              <span key={w} className={styles.line} aria-hidden>
                <span style={{ "--i": i } as React.CSSProperties}>{w}</span>
              </span>
            ))}
          </h1>
          <div className={styles.original} lang="grc">
            {summary.original}
          </div>
          <p className={`${styles.blurb} rise-in`} style={{ "--rise-delay": "420ms" } as React.CSSProperties}>
            {edition.blurb}
          </p>

          <div className={`${styles.stats} draw-rule`} style={{ "--rule-color": "var(--color-ink)", "--rule-delay": "300ms" } as React.CSSProperties}>
            <Stat label="Books" value={<MaskNumber value={String(summary.total)} delay={0.3} />} />
            <Stat label="Collected" value={`${summary.owned}`} suffix={`/${summary.available}`} />
            <Stat label="Read" value={`${summary.finished}`} />
            <Stat label="Texts" value="KJV" suffix=" · Douay-Rheims" small />
          </div>

          <div className={`${styles.actions} rise-in`} style={{ "--rise-delay": "520ms" } as React.CSSProperties}>
            {collect.state ? (
              <button className="btn btn-ink btn-lg" onClick={collect.stop}>
                Collecting {collect.state.done}/{collect.state.total} · Stop
              </button>
            ) : summary.owned < summary.available ? (
              <button className="btn btn-ink btn-lg" onClick={() => void collect.start()}>
                Collect the canon · {summary.available - summary.owned} books
              </button>
            ) : (
              <span className={`mono ${styles.complete}`}>✓ The canon is complete</span>
            )}
            {edition.singleVolume && <SingleVolume entry={edition.singleVolume} readerTheme={readerTheme} />}
          </div>
        </div>

        <div className={styles.crossWrap}>
          <OrthodoxCross />
        </div>
      </section>

      <CanonBar sections={canon} />

      {canon.map((s, i) => (
        <Section key={s.id} section={s} index={i} readerTheme={readerTheme} />
      ))}
      {tradition.map((s, i) => (
        <Section key={s.id} section={s} index={canon.length + i} readerTheme={readerTheme} tradition />
      ))}

      <footer className={`${styles.colophon} mono`}>
        Texts: the King James Version, and the Douay-Rheims (Challoner revision) for the deuterocanonical
        books and the Greek additions to Esther and Daniel. Public domain, via Project Gutenberg.
      </footer>
    </main>
  );
}

function Stat({ label, value, suffix, small }: { label: string; value: React.ReactNode; suffix?: string; small?: boolean }) {
  return (
    <div className={styles.stat}>
      <div className="mono">{label}</div>
      <div className={`${styles.statValue} ${small ? styles.statSmall : ""}`}>
        {value}
        {suffix && <small>{suffix}</small>}
      </div>
    </div>
  );
}

/** Every slot of the canon as one strip: collecting it fills the strip with white. */
function CanonBar({ sections }: { sections: EditionSection[] }) {
  return (
    <div className={styles.canonBar} aria-label="The canon, book by book">
      {sections.map((s, si) => (
        <div key={s.id} className={styles.canonGroup}>
          <div className={`mono ${styles.canonNumeral}`}>{s.numeral}</div>
          <div className={styles.canonSquares}>
            {s.items.map((item, i) => (
              <span
                key={item.no}
                title={`${item.no}. ${item.name}`}
                className={`${styles.square} ${styles[stateOf(item)]}`}
                style={{ "--i": si * 6 + i } as React.CSSProperties}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Section(props: { section: EditionSection; index: number; readerTheme?: string; tradition?: boolean }) {
  const { section, index, readerTheme, tradition } = props;
  const ref = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { rootMargin: "-10% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section ref={ref} className={`${styles.section} ${seen ? styles.seen : ""}`}>
      <header className={`${styles.sectionHead} draw-rule`}>
        <div className={styles.numeral}>{section.numeral}</div>
        <div>
          <div className={`mono ${styles.part}`}>
            5.{index + 1} — {section.part}
          </div>
          <h2>{section.title}</h2>
        </div>
        <div className={styles.sectionGreek} lang="el">
          {section.greek}
        </div>
        <div className={`mono ${styles.count}`}>
          {section.items.length} {section.items.length === 1 ? "book" : tradition ? "works" : "books"}
        </div>
      </header>
      <div className={`${styles.tablets} ${tradition ? styles.wide : ""}`}>
        {section.items.map((item, i) => (
          <Tablet key={item.no} item={item} i={i} readerTheme={readerTheme} />
        ))}
      </div>
    </section>
  );
}

type SlotState = "missing" | "available" | "owned" | "reading" | "finished";

function stateOf(item: EditionItem): SlotState {
  if (!item.entry) return "missing";
  if (!item.entry.ownedBookId) return "available";
  if (item.progress === null) return "owned";
  return item.progress >= 0.98 ? "finished" : "reading";
}

/** One book of the canon: number, names, edition, and what you can do with it. */
function Tablet({ item, i, readerTheme }: { item: EditionItem; i: number; readerTheme?: string }) {
  const openBook = useLibrary((s) => s.openBook);
  const acquire = useDiscover((s) => s.acquire);
  const downloading = useDiscover((s) => (item.entry ? !!s.downloads[listingKey(item.entry)] : false));
  const state = stateOf(item);
  const no = String(item.no).padStart(2, "0");

  const onClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const entry = item.entry;
    if (!entry) return;
    if (entry.ownedBookId) openBook(entry.ownedBookId, e.currentTarget, { readerTheme });
    else void acquire(entry);
  };

  return (
    <button
      className={`${styles.tablet} ${styles[state]}`}
      style={{ "--i": i } as React.CSSProperties}
      onClick={onClick}
      disabled={state === "missing" || downloading}
      aria-label={`${item.name}${state === "missing" ? " (not available)" : ""}`}
    >
      <div className={`mono ${styles.tabletTop}`}>
        <span>{no}</span>
        {item.translation && <span>{item.translation === "Douay-Rheims" ? "D-R" : item.translation}</span>}
      </div>
      {/* Keep a book number with its name ("1 Chronicles" never breaks after the 1). */}
      <div className={styles.name}>{item.name.replace(/^(\d) /, "$1\u00a0")}</div>
      <div className={styles.greek} lang="el">
        {item.greek}
      </div>
      <div className={`mono ${styles.tabletFoot}`}>
        {downloading && <span>Collecting…</span>}
        {!downloading && state === "missing" && <span className={styles.note}>{item.note}</span>}
        {!downloading && state === "available" && <span>{item.note ?? "Collect · free"}</span>}
        {!downloading && state === "owned" && <span>{item.note ?? "Read →"}</span>}
        {!downloading && state === "finished" && <span>✓ Read</span>}
        {!downloading && state === "reading" && (
          <>
            <span className={styles.track}>
              <i style={{ width: `${Math.round((item.progress ?? 0) * 100)}%` }} />
            </span>
            <span>{Math.round((item.progress ?? 0) * 100)}%</span>
          </>
        )}
      </div>
    </button>
  );
}

function SingleVolume({ entry, readerTheme }: { entry: CatalogEntry; readerTheme?: string }) {
  const openBook = useLibrary((s) => s.openBook);
  const acquire = useDiscover((s) => s.acquire);
  const downloading = useDiscover((s) => !!s.downloads[listingKey(entry)]);
  return (
    <button
      className="btn btn-lg"
      disabled={downloading}
      onClick={(e) =>
        entry.ownedBookId ? openBook(entry.ownedBookId, e.currentTarget, { readerTheme }) : void acquire(entry)
      }
    >
      {downloading ? "Collecting…" : entry.ownedBookId ? "Read in one volume →" : "Get it in one volume (KJV)"}
    </button>
  );
}

/** Loads an edition and keeps it current as books are collected and read. */
function useEdition(id: string): Edition | null {
  const [edition, setEdition] = useState<Edition | null>(null);
  const load = useCallback(() => {
    api.edition(id).then(setEdition, (e) => useLibrary.getState().toast(errorMessage(e), "error"));
  }, [id]);
  useEffect(() => {
    load();
    // Collecting the canon fires many library events; coalesce them.
    const reload = debounce(load, 250);
    const off = events.onLibraryChanged(() => reload());
    return () => void off.then((f) => f());
  }, [load]);
  return edition;
}

/** "Collect the canon": downloads every available, uncollected book, one after another. */
function useCollectAll(edition: Edition | null) {
  const [state, setState] = useState<{ done: number; total: number } | null>(null);
  const stopped = useRef(false);

  const queue = useMemo(() => {
    if (!edition) return [];
    const seen = new Set<string>();
    return edition.sections
      .filter((s) => s.part !== "Tradition")
      .flatMap((s) => s.items)
      .map((i) => i.entry)
      .filter((e): e is CatalogEntry => !!e && !e.ownedBookId && !seen.has(e.id) && !!seen.add(e.id));
  }, [edition]);

  const start = async () => {
    const { acquire } = useDiscover.getState();
    const { toast } = useLibrary.getState();
    const items = [...queue];
    stopped.current = false;
    let done = 0;
    setState({ done, total: items.length });
    for (const entry of items) {
      if (stopped.current) break;
      try {
        await acquire(entry, { quiet: true });
      } catch (e) {
        toast(`Stopped collecting: ${errorMessage(e)}`, "error");
        break;
      }
      setState({ done: ++done, total: items.length });
    }
    setState(null);
    if (done > 0) toast(`Collected ${done} ${done === 1 ? "book" : "books"} of the canon`);
  };

  return { state, start, stop: () => (stopped.current = true) };
}
