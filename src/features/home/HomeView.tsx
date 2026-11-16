import type { Book } from "../../bindings/Book";
import type { CollectionSet } from "../../bindings/CollectionSet";
import { CountUp } from "../../components/motion/CountUp";
import { MaskNumber } from "../../components/motion/MaskNumber";
import { Scramble } from "../../components/motion/Scramble";
import { coverUrl } from "../../lib/api";
import { hueFor, volumeLabel } from "../../lib/format";
import { useDiscover } from "../../store/discover";
import { useLibrary } from "../../store/library";
import { TonightDeck } from "./TonightDeck";
import { pickNextSet, useHomeData } from "./useHomeData";
import styles from "./HomeView.module.css";

export function HomeView() {
  const data = useHomeData();
  const stats = useLibrary((s) => s.stats);
  const navigate = useLibrary((s) => s.navigate);
  const next = data ? pickNextSet(data.sets) : null;

  return (
    <div className={styles.home}>
      <section className={styles.left}>
        <div className="section-label mono">
          <span>
            <b>2.1</b> — <Scramble text="Your collection" />
          </span>
          <span>{stats.total === 1 ? "1 volume" : `${stats.total} volumes`}</span>
        </div>

        <div className={styles.hero}>
          <BigNumber value={stats.total} />
          <div className={`${styles.tag} rise-in`} style={{ "--rise-delay": "380ms" } as React.CSSProperties}>
            <div className={styles.dot} />
            <p>
              <strong>{stats.total === 1 ? "Volume collected." : "Volumes collected."}</strong>{" "}
              {next ? `${next.total - next.owned} short of ${next.title}.` : "Every set complete. Remarkable."}
            </p>
          </div>
        </div>

        <div
          className={`${styles.metrics} draw-rule`}
          style={{ "--rule-color": "var(--color-ink)", "--rule-delay": "120ms" } as React.CSSProperties}
        >
          <Metric label="Authors" value={stats.authors} i={0} />
          <Metric label="Reading" value={stats.reading} i={1} />
          <Metric label="Finished" value={stats.finished} i={2} />
          <Metric label="Favorites" value={stats.favorites} i={3} />
        </div>

        <div className={`section-label mono ${styles.rule} draw-rule`} style={{ "--rule-delay": "220ms" } as React.CSSProperties}>
          <span>
            <b>2.2</b> — <Scramble text="Index · latest volumes" delay={150} />
          </span>
          <button className="mono" onClick={() => navigate("collection")}>
            View all {stats.total} →
          </button>
        </div>
        <div className={styles.strip}>
          {data?.latest.map((b, i) => <Volume key={b.id} book={b} i={i} />)}
          {data && data.latest.length === 0 && (
            <p className={styles.empty}>Nothing here yet. Grab a free classic from Discover. It becomes No. 001.</p>
          )}
        </div>

        <div className={`section-label mono ${styles.rule} draw-rule`} style={{ "--rule-delay": "320ms" } as React.CSSProperties}>
          <span>
            <b>2.3</b> — <Scramble text="Sets" delay={260} />
          </span>
          <span>Collect them all</span>
        </div>
        <div className={styles.sets}>{data?.sets.map((s, i) => <SetRow key={s.id} set={s} row={i} />)}</div>
      </section>

      <section className={styles.right}>
        <div className={`section-label mono ${styles.rightLabel}`}>
          <span>
            <b>4.0</b> — {greeting()}
          </span>
          <span>{new Date().toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</span>
        </div>
        <TonightDeck readingNow={data?.readingNow ?? null} nextSet={next} />
      </section>
    </div>
  );
}

function BigNumber({ value }: { value: number }) {
  const label = volumeLabel(value);
  return (
    <div className={styles.big}>
      <MaskNumber value={label} ghostBefore={label.length - String(value).length} ghostClassName={styles.ghost} delay={0.05} />
    </div>
  );
}

function Metric({ label, value, i }: { label: string; value: number; i: number }) {
  return (
    <div className={`${styles.metric} rise-in`} style={{ "--i": i, "--rise-delay": "200ms" } as React.CSSProperties}>
      <div className="mono">{label}</div>
      <div className={styles.metricValue}>
        <CountUp value={value} delay={0.25 + i * 0.06} />
      </div>
    </div>
  );
}

function Volume({ book, i }: { book: Book; i: number }) {
  const openBook = useLibrary((s) => s.openBook);
  const reading = book.progress && book.progress.percent < 0.98;
  return (
    <button
      className={`${styles.vol} rise-in`}
      style={{ "--i": i * 2, "--rise-delay": "300ms" } as React.CSSProperties}
      onClick={(e) => openBook(book.id, e.currentTarget.querySelector("img, [data-cover]"))}
      aria-label={`Open “${book.title}”`}
    >
      <div className={`${styles.no} mono`}>
        No.{volumeLabel(book.volume)}
        {reading && <i />}
      </div>
      <SmallCover book={book} />
      <div className={styles.vt}>{book.title}</div>
      <div className={styles.va}>{book.authors[0] ?? "Unknown"}</div>
    </button>
  );
}

function SmallCover({ book }: { book: Book }) {
  if (book.coverState === "present") {
    return <img className={styles.cover} src={coverUrl(book)} alt="" draggable={false} />;
  }
  const hue = hueFor(book.id);
  return (
    <div data-cover className={`${styles.cover} ${styles.ph}`} style={{ background: `hsl(${hue} 18% 28%)` }}>
      {book.title}
    </div>
  );
}

function SetRow({ set, row }: { set: CollectionSet; row: number }) {
  const openListing = useDiscover((s) => s.openListing);
  const openBook = useLibrary((s) => s.openBook);
  const nextIndex = set.items.findIndex((i) => !i.ownedBookId);
  return (
    <div className={styles.set}>
      <div className={styles.setHead}>
        <b>{set.title}</b>
        <span className="mono">
          {set.owned}/{set.total}
        </span>
      </div>
      <div className={styles.squares}>
        {set.items.map((item, i) => (
          <button
            key={item.id}
            title={item.ownedBookId ? `${item.title} · in your collection` : `${item.title} · get it free`}
            className={`${styles.sq} ${item.ownedBookId ? styles.got : i === nextIndex ? styles.next : ""}`}
            style={{ "--i": row * 3 + i } as React.CSSProperties}
            onClick={(e) => (item.ownedBookId ? openBook(item.ownedBookId, e.currentTarget) : void openListing(item))}
          />
        ))}
      </div>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Late night";
  if (h < 12) return "This morning";
  if (h < 18) return "This afternoon";
  return "Tonight";
}
