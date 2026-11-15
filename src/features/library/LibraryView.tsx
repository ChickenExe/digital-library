import { useLibrary } from "../../store/library";
import { Sidebar } from "./Sidebar";
import { Toolbar } from "./Toolbar";
import { BookCard } from "./BookCard";
import styles from "./LibraryView.module.css";

export function LibraryView() {
  const books = useLibrary((s) => s.books);
  const loaded = useLibrary((s) => s.loaded);
  const query = useLibrary((s) => s.query);
  const total = useLibrary((s) => s.stats.total);

  return (
    <div className={styles.shell}>
      <Sidebar />
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
    </div>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  const pickAndImport = useLibrary((s) => s.pickAndImport);
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
      <p>Drag EPUB or PDF files anywhere onto this window, or</p>
      <button className="btn btn-primary" onClick={() => void pickAndImport()}>
        Add books…
      </button>
    </div>
  );
}
