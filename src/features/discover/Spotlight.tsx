import { useEffect, useState } from "react";
import type { CatalogDetail } from "../../bindings/CatalogDetail";
import type { CatalogEntry } from "../../bindings/CatalogEntry";
import { api } from "../../lib/api";
import { authorLine } from "../../lib/format";
import { useDiscover } from "../../store/discover";
import { CatalogCover } from "./CatalogCover";
import { GetButton } from "./GetButton";
import styles from "./Spotlight.module.css";

/** Front-page feature for a single book. */
export function Spotlight({ entry }: { entry: CatalogEntry }) {
  const [detail, setDetail] = useState<CatalogDetail | null>(null);
  const openListing = useDiscover((s) => s.openListing);
  const live = useDiscover((s) => s.rows[0]?.entries.find((e) => e.id === entry.id)) ?? entry;

  useEffect(() => {
    api.catalogDetail(entry.provider, entry.id).then(setDetail, () => setDetail(null));
  }, [entry.provider, entry.id]);

  return (
    <section className={styles.spotlight}>
      <button className={styles.cover} onClick={() => void openListing(live)}>
        <CatalogCover entry={live} size="lg" />
      </button>
      <div className={styles.body}>
        <div className={styles.kicker}>Most read this week</div>
        <h1 className={styles.title}>{live.title}</h1>
        <div className={styles.author}>{authorLine(live)}</div>
        {detail?.summary && <p className={styles.summary}>{detail.summary}</p>}
        <div className={styles.actions}>
          <GetButton entry={live} large />
          <button className="btn btn-lg" onClick={() => void openListing(live)}>
            Details
          </button>
        </div>
      </div>
    </section>
  );
}
