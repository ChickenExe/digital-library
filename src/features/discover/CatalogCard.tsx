import type { CatalogEntry } from "../../bindings/CatalogEntry";
import { authorLine } from "../../lib/format";
import { useDiscover } from "../../store/discover";
import { CatalogCover } from "./CatalogCover";
import styles from "./CatalogCard.module.css";

type Props = {
  entry: CatalogEntry;
  /** Shown above the cover (e.g. a "#01" rank). */
  label?: string;
  /** Unique per on-screen instance; lets the cover morph into the listing sheet. */
  morphKey?: string;
};

/** Height of a card minus its 2:3 cover (label row + title + author). */
export const CATALOG_CARD_CHROME = 84;

/** A catalog listing card. */
export function CatalogCard({ entry, label, morphKey }: Props) {
  const openListing = useDiscover((s) => s.openListing);
  const lifted = useDiscover((s) => !!morphKey && s.morphing === morphKey);
  return (
    <button
      className={styles.card}
      onClick={(e) =>
        void openListing(entry, morphKey ? { key: morphKey, el: e.currentTarget.querySelector("[data-cover]") } : undefined)
      }
      title={entry.title}
    >
      {(label || entry.ownedBookId) && (
        <div className={`${styles.label} mono`}>
          <span>{label}</span>
          {entry.ownedBookId && <span className={styles.owned}>Owned</span>}
        </div>
      )}
      <div className={styles.coverWrap}>
        {/* While the cover is "lifted" into the listing sheet, leave its slot empty. */}
        <div style={{ visibility: lifted ? "hidden" : undefined }}>
          <CatalogCover entry={entry} />
        </div>
      </div>
      <div className={styles.title}>{entry.title}</div>
      <div className={styles.author}>{authorLine(entry)}</div>
    </button>
  );
}
