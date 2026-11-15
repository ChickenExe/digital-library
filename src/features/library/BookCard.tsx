import { useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import type { Book } from "../../bindings/Book";
import { coverUrl } from "../../lib/api";
import { authorLine, hueFor, percentLabel } from "../../lib/format";
import { useLibrary } from "../../store/library";
import styles from "./BookCard.module.css";

export function BookCard({ book }: { book: Book }) {
  const openBook = useLibrary((s) => s.openBook);
  const toggleFavorite = useLibrary((s) => s.toggleFavorite);
  const deleteBook = useLibrary((s) => s.deleteBook);
  const progress = book.progress?.percent ?? 0;

  return (
    <article className={styles.card}>
      <button
        className={styles.coverButton}
        onClick={() => openBook(book.id)}
        title={`Open “${book.title}”`}
      >
        <Cover book={book} />
        {progress > 0 && (
          <div className={styles.progress}>
            <div className={styles.progressFill} style={{ width: percentLabel(progress) }} />
          </div>
        )}
      </button>
      <div className={styles.actions}>
        <button
          className={`${styles.action} ${book.favorite ? styles.favorite : ""}`}
          onClick={() => void toggleFavorite(book)}
          aria-label={book.favorite ? "Remove from favorites" : "Add to favorites"}
        >
          {book.favorite ? "♥" : "♡"}
        </button>
        <button
          className={styles.action}
          onClick={async () => {
            const ok = await ask(
              `Remove “${book.title}” from your library? Its copy in the library folder will be deleted.`,
              { title: "Remove book", kind: "warning", okLabel: "Remove" },
            );
            if (ok) void deleteBook(book);
          }}
          aria-label="Remove from library"
        >
          ✕
        </button>
      </div>
      <div className={styles.meta}>
        <div className={styles.title} title={book.title}>
          {book.title}
        </div>
        <div className={styles.author}>{authorLine(book)}</div>
        <div className={styles.details}>
          <span className={styles.badge}>{book.format.toUpperCase()}</span>
          {progress > 0 && <span>{percentLabel(progress)}</span>}
        </div>
      </div>
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
  // Generated placeholder: deterministic tint + typeset title.
  const hue = hueFor(book.id);
  return (
    <div
      className={`${styles.cover} ${styles.placeholder}`}
      style={{ background: `linear-gradient(160deg, hsl(${hue} 22% 34%), hsl(${(hue + 30) % 360} 26% 20%))` }}
    >
      <div className={styles.placeholderTitle}>{book.title}</div>
      <div className={styles.placeholderAuthor}>{authorLine(book)}</div>
      {book.coverState === "pending" && <div className={styles.shimmer} />}
    </div>
  );
}
