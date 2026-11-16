import type { CatalogEntry } from "../../bindings/CatalogEntry";
import { authorLine } from "../../lib/format";
import { useDiscover } from "../../store/discover";
import { CatalogCover } from "./CatalogCover";
import styles from "./CatalogCard.module.css";

/** A catalog listing. `label` shows above the cover (e.g. a "#01" rank). */
export function CatalogCard({ entry, label }: { entry: CatalogEntry; label?: string }) {
  const openListing = useDiscover((s) => s.openListing);
  return (
    <button className={styles.card} onClick={() => void openListing(entry)} title={entry.title}>
      {(label || entry.ownedBookId) && (
        <div className={`${styles.label} mono`}>
          <span>{label}</span>
          {entry.ownedBookId && <span className={styles.owned}>Owned</span>}
        </div>
      )}
      <div className={styles.coverWrap}>
        <CatalogCover entry={entry} />
      </div>
      <div className={styles.title}>{entry.title}</div>
      <div className={styles.author}>{authorLine(entry)}</div>
    </button>
  );
}
