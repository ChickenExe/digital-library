import { useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import type { Book } from "../../bindings/Book";
import { coverUrl } from "../../lib/api";
import { authorLine, hueFor, percentLabel, volumeLabel } from "../../lib/format";
import { useLibrary } from "../../store/library";
import styles from "./BookCard.module.css";

/** A volume in the collection: number, cover, status. */
export function BookCard({ book }: { book: Book }) {
  const openBook = useLibrary((s) => s.openBook);
  const toggleFavorite = useLibrary((s) => s.toggleFavorite);
  const deleteBook = useLibrary((s) => s.deleteBook);
  const progress = book.progress?.percent ?? 0;
  const finished = progress >= 0.98;

  return (
    <article className={styles.card}>
      <div className={`${styles.no} mono`}>
        <span>No.{volumeLabel(book.volume)}</span>
        {progress > 0 && !finished && <i className={styles.reading} />}
        {book.favorite && <span className={styles.fav}>♥</span>}
      </div>
      <button
        className={styles.coverButton}
        onClick={(e) => openBook(book.id, e.currentTarget)}
        aria-label={`Open “${book.title}”`}
      >
        <Cover book={book} />
        {finished && <span className={`${styles.stamp} mono`}>Finished</span>}
      </button>
      <div className={styles.actions}>
        <button
          className={styles.action}
          onClick={() => void toggleFavorite(book)}
          aria-label={book.favorite ? "Remove from favorites" : "Add to favorites"}
        >
          {book.favorite ? "♥" : "♡"}
        </button>
        <button
          className={styles.action}
          onClick={async () => {
            const ok = await ask(
              `Remove “${book.title}” from your collection? Its copy in the library folder will be deleted.`,
              { title: "Remove volume", kind: "warning", okLabel: "Remove" },
            );
            if (ok) void deleteBook(book);
          }}
          aria-label="Remove from collection"
        >
          ✕
        </button>
      </div>
      <div className={styles.title} title={book.title}>
        {book.title}
      </div>
      <div className={styles.author}>{authorLine(book)}</div>
      {progress > 0 && !finished && (
        <div className={styles.progress}>
          <span className={styles.track}>
            <i style={{ width: percentLabel(progress) }} />
          </span>
          <span className="mono">{percentLabel(progress)}</span>
        </div>
      )}
    </article>
  );
}

function Cover({ book }: { book: Book }) {
  const [failed, setFailed] = useState(false);
  if (book.coverState === "present" && !failed) {
    return (
      <img
        className={styles.cover}
        src={coverUrl(book)}
        alt=""
        loading="lazy"
        draggable={false}
        onError={() => setFailed(true)}
      />
    );
  }
  const hue = hueFor(book.id);
  return (
    <div className={`${styles.cover} ${styles.placeholder}`} style={{ background: `hsl(${hue} 16% 24%)` }}>
      <div className={styles.placeholderTitle}>{book.title}</div>
      <div className={`${styles.placeholderAuthor} mono`}>{authorLine(book)}</div>
      {book.coverState === "pending" && <div className={styles.shimmer} />}
    </div>
  );
}
