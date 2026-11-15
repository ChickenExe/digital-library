import { useLibrary } from "../../store/library";
import { Toolbar } from "./Toolbar";
import { BookCard } from "./BookCard";
import styles from "./LibraryView.module.css";

export function LibraryView() {
  const books = useLibrary((s) => s.books);
  const loaded = useLibrary((s) => s.loaded);
  const query = useLibrary((s) => s.query);
  const total = useLibrary((s) => s.stats.total);

  return (
    <main className={styles.main}>
      <Toolbar />
      {loaded && books.length === 0 ? (
        <EmptyState filtered={total > 0 || !!query.search} />
      ) : (
        <div className={styles.grid}>
          {books.map((b) => (
            <BookCard key={b.id} book={b} />
          ))}
        </div>
      )}
    </main>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  const pickAndImport = useLibrary((s) => s.pickAndImport);
  const navigate = useLibrary((s) => s.navigate);
  if (filtered) {
    return (
      <div className={styles.empty}>
        <h2>Nothing here</h2>
        <p>No books match this view.</p>
      </div>
    );
  }
  return (
    <div className={styles.empty}>
      <h2>Your library is empty</h2>
      <p>Find something free to read in Discover, or bring your own EPUB and PDF files.</p>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-primary" onClick={() => navigate("discover")}>
          Browse free books
        </button>
        <button className="btn" onClick={() => void pickAndImport()}>
          Add files…
        </button>
      </div>
    </div>
  );
}
