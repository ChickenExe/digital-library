import type { CatalogEntry } from "../../bindings/CatalogEntry";
import { listingKey } from "../../lib/api";
import { useDiscover } from "../../store/discover";
import { useLibrary } from "../../store/library";

/** The primary call to action for a listing: Get (free) → progress → Read. */
export function GetButton({ entry, large }: { entry: CatalogEntry; large?: boolean }) {
  const progress = useDiscover((s) => s.downloads[listingKey(entry)]);
  const acquire = useDiscover((s) => s.acquire);
  const closeListing = useDiscover((s) => s.closeListing);
  const openBook = useLibrary((s) => s.openBook);
  const cls = `btn btn-primary${large ? " btn-lg" : ""}`;

  if (entry.ownedBookId) {
    return (
      <button
        className={cls}
        onClick={() => {
          closeListing();
          openBook(entry.ownedBookId!);
        }}
      >
        Read
      </button>
    );
  }
  if (progress) {
    const pct =
      progress !== "starting" && progress.total ? Math.round((progress.received / progress.total) * 100) : null;
    return (
      <button className={cls} disabled>
        {pct === null ? "Downloading…" : `Downloading ${pct}%`}
      </button>
    );
  }
  return (
    <button className={cls} onClick={() => void acquire(entry)}>
      Get · Free
    </button>
  );
}
