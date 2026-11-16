import type { Book } from "../../bindings/Book";
import type { CollectionSet } from "../../bindings/CollectionSet";
import { coverUrl } from "../../lib/api";
import { authorLine, percentLabel } from "../../lib/format";
import { useDiscover } from "../../store/discover";
import { useLibrary } from "../../store/library";
import { CatalogCover } from "../discover/CatalogCover";
import { GetButton } from "../discover/GetButton";
import styles from "./TonightDeck.module.css";

type Props = { readingNow: Book | null; nextSet: CollectionSet | null };

/**
 * Three tilted cards, fanned like a deck: what you're reading, the set you're
 * closest to finishing, and what everyone else is reading. Hovering a card
 * straightens and lifts it.
 */
export function TonightDeck({ readingNow, nextSet }: Props) {
  const navigate = useLibrary((s) => s.navigate);
  const openBook = useLibrary((s) => s.openBook);
  const openListing = useDiscover((s) => s.openListing);
  const popular = useDiscover((s) => s.rows[0]?.entries.find((e) => !e.ownedBookId) ?? null);
  const nextItem = nextSet?.items.find((i) => !i.ownedBookId) ?? null;

  return (
    <div className={styles.deck}>
      {/* 4.1 Reading now */}
      <article
        className={`${styles.card} ${styles.c1}`}
        onClick={() => (readingNow ? openBook(readingNow.id) : navigate("discover"))}
      >
        <div className={`${styles.row} mono`}>
          <span>4.1 — {readingNow ? "Reading now" : "Start reading"}</span>
          {readingNow && <span>No.{String(readingNow.volume).padStart(3, "0")}</span>}
        </div>
        {readingNow ? (
          <>
            <div className={styles.pct}>
              {Math.round((readingNow.progress?.percent ?? 0) * 100)}
              <small>%</small>
            </div>
            <div className={styles.bar}>
              <i style={{ width: percentLabel(readingNow.progress?.percent ?? 0) }} />
            </div>
            <div className={styles.title}>
              <b>{readingNow.title}</b>
              <span className="mono">{authorLine(readingNow)} · Continue →</span>
            </div>
            {readingNow.coverState === "present" && (
              <img className={styles.cover} src={coverUrl(readingNow)} alt="" draggable={false} />
            )}
          </>
        ) : (
          <>
            <div className={styles.pct}>
              00<small>%</small>
            </div>
            <div className={styles.title}>
              <b>Nothing open</b>
              <span className="mono">Find something in Discover →</span>
            </div>
          </>
        )}
      </article>

      {/* 4.2 Next in a set */}
      <article className={`${styles.card} ${styles.c2}`}>
        <div className={`${styles.row} mono`}>
          <span>4.2 — Next in a set</span>
          {nextSet && (
            <span className={styles.count}>
              {nextSet.owned}/{nextSet.total}
            </span>
          )}
        </div>
        {nextSet && nextItem ? (
          <>
            <h3 className={styles.setTitle}>{nextSet.title}</h3>
            <div className={styles.squares}>
              {nextSet.items.map((i) => (
                <span key={i.id} className={i.ownedBookId ? styles.got : i === nextItem ? styles.next : ""} />
              ))}
            </div>
            <div className={styles.nextRow}>
              <div>
                <div className="mono" style={{ opacity: 0.6 }}>
                  Up next
                </div>
                <div className={styles.nextTitle}>{nextItem.title}</div>
              </div>
              <div onClick={(e) => e.stopPropagation()}>
                <GetButton entry={nextItem} />
              </div>
            </div>
          </>
        ) : (
          <h3 className={styles.setTitle}>All sets complete</h3>
        )}
      </article>

      {/* 4.3 Most read this week */}
      <article className={`${styles.card} ${styles.c3}`} onClick={() => popular && void openListing(popular)}>
        <div className={`${styles.row} mono`}>
          <span>4.3 — Most read this week</span>
          {popular?.popularity && <span>#{String(popular.popularity).padStart(2, "0")}</span>}
        </div>
        {popular && (
          <div className={styles.popular}>
            <div className={styles.popCover}>
              <CatalogCover entry={popular} />
            </div>
            <div>
              <div className={styles.popTitle}>{popular.title}</div>
              <div className="mono" style={{ marginTop: 10, color: "var(--color-text-muted)" }}>
                {authorLine(popular)} · Free →
              </div>
            </div>
          </div>
        )}
      </article>
    </div>
  );
}
