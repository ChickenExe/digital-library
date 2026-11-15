import type { CatalogEntry } from "../../bindings/CatalogEntry";
import { authorLine } from "../../lib/format";
import { useDiscover } from "../../store/discover";
import { CatalogCover } from "./CatalogCover";
import styles from "./CatalogCard.module.css";

export function CatalogCard({ entry }: { entry: CatalogEntry }) {
  const openListing = useDiscover((s) => s.openListing);
  return (
    <button className={styles.card} onClick={() => void openListing(entry)} title={entry.title}>
      <div className={styles.coverWrap}>
        <CatalogCover entry={entry} />
        {entry.ownedBookId && <span className={styles.owned}>In library</span>}
      </div>
      <div className={styles.title}>{entry.title}</div>
      <div className={styles.author}>{authorLine(entry)}</div>
    </button>
  );
}
