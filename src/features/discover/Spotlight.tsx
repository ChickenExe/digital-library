import { useEffect, useState } from "react";
import type { CatalogDetail } from "../../bindings/CatalogDetail";
import type { CatalogEntry } from "../../bindings/CatalogEntry";
import { api } from "../../lib/api";
import { authorLine } from "../../lib/format";
import { useDiscover } from "../../store/discover";
import { CatalogCover } from "./CatalogCover";
import { GetButton } from "./GetButton";
import styles from "./Spotlight.module.css";

/** Front-page feature: the most-read book, on a big red card. */
export function Spotlight({ entry }: { entry: CatalogEntry }) {
  const [detail, setDetail] = useState<CatalogDetail | null>(null);
  const openListing = useDiscover((s) => s.openListing);
  const live = useDiscover((s) => s.rows[0]?.entries.find((e) => e.id === entry.id)) ?? entry;

  useEffect(() => {
    api.catalogDetail(entry.provider, entry.id).then(setDetail, () => setDetail(null));
  }, [entry.provider, entry.id]);

  return (
    <section className={styles.spotlight}>
      <div className={styles.body}>
        <div className={`${styles.kicker} mono`}>
          <span>2.0 — Spotlight · #01 most read this week</span>
        </div>
        <h1 className={styles.title}>{live.title}</h1>
        <div className={`${styles.author} mono`}>{authorLine(live)}</div>
        {detail?.summary && <p className={styles.summary}>{detail.summary}</p>}
        <div className={styles.actions}>
          <GetButton entry={live} large variant="ink" />
          <button className={`btn btn-lg ${styles.ghost}`} onClick={() => void openListing(live)}>
            Details
          </button>
        </div>
      </div>
      <button className={styles.cover} onClick={() => void openListing(live)}>
        <CatalogCover entry={live} size="lg" />
      </button>
    </section>
  );
}
