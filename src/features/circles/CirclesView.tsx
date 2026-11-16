import { Scramble } from "../../components/motion/Scramble";
import styles from "./CirclesView.module.css";

const POINTS = [
  {
    no: "4.1",
    title: "Read together",
    body: "Start a circle with friends, a book club or a class. Pick a book and a finish date, and everyone reads at their own pace.",
  },
  {
    no: "4.2",
    title: "Spoiler-safe notes",
    body: "Notes are pinned to the chapter they're about. You only see discussion up to where you've read, never ahead.",
  },
  {
    no: "4.3",
    title: "Bookstore shelves",
    body: "Independent bookstores and curators share shelves you can follow. Your favorite shop, inside your library.",
  },
];

const MEMBERS = [
  { initial: "K", at: 18 },
  { initial: "E", at: 37 },
  { initial: "Y", at: 52, you: true },
  { initial: "T", at: 66 },
  { initial: "M", at: 84 },
];

/** 04 — Circles. Needs accounts + a sync service; this page previews the feature. */
export function CirclesView() {
  return (
    <main className={styles.main}>
      <section className={styles.intro}>
        <div className="section-label mono">
          <span>
            <b>4.0</b> — <Scramble text="Circles" />
          </span>
          <span className={styles.soon}>In development</span>
        </div>
        <h1 className={styles.title} aria-label="Reading, together.">
          {["Reading,", "together."].map((line, i) => (
            <span key={line} className={styles.line} aria-hidden>
              <span style={{ "--i": i } as React.CSSProperties}>{line}</span>
            </span>
          ))}
        </h1>
        <p className={`${styles.lede} rise-in`} style={{ "--rise-delay": "260ms" } as React.CSSProperties}>
          Circles turn a book into a shared event: small groups reading the same pages, at their own pace, with notes
          that never spoil what&rsquo;s ahead.
        </p>
        <div className={`${styles.points} draw-rule`} style={{ "--rule-color": "var(--color-ink)", "--rule-delay": "320ms" } as React.CSSProperties}>
          {POINTS.map((p, i) => (
            <div key={p.no} className={`${styles.point} rise-in`} style={{ "--i": i * 3, "--rise-delay": "380ms" } as React.CSSProperties}>
              <div className="mono">{p.no}</div>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.preview}>
        <div className={`${styles.card} ${styles.ink}`}>
          <div className={`${styles.row} mono`}>
            <span>Preview — Example circle</span>
            <span className={styles.red}>23 notes</span>
          </div>
          <h2>
            Gothic
            <br />
            October
          </h2>
          <div className={`${styles.meta} mono`}>8 readers · Dracula · ends Oct 31</div>
          <div className={styles.ruler}>
            {MEMBERS.map((m) => (
              <div key={m.initial} className={`${styles.mk} ${m.you ? styles.you : ""}`} style={{ left: `${m.at}%` }}>
                <span>{m.initial}</span>
                {m.you ? "You" : m.at}
              </div>
            ))}
          </div>
          <div className={`${styles.legend} mono`}>Where everyone is in the book</div>
        </div>
        <div className={`${styles.card} ${styles.paper}`}>
          <div className={`${styles.row} mono`}>
            <span>Chapter 12 · visible to you</span>
          </div>
          <blockquote>“Welcome to my house! Enter freely and of your own will!”</blockquote>
          <div className={`${styles.meta} mono`}>Most highlighted · 312 readers</div>
        </div>
      </section>
    </main>
  );
}
