import { Fragment, useEffect, useRef, useState } from "react";
import { Scramble } from "../../components/motion/Scramble";
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
  const lifted = useDiscover((s) => s.morphing === `spotlight:${entry.id}`);
  const coverRef = useRef<HTMLButtonElement>(null);
  const open = () =>
    void openListing(live, { key: `spotlight:${live.id}`, el: coverRef.current?.querySelector("[data-cover]") ?? null });
  const live = useDiscover((s) => s.rows[0]?.entries.find((e) => e.id === entry.id)) ?? entry;

  useEffect(() => {
    api.catalogDetail(entry.provider, entry.id).then(setDetail, () => setDetail(null));
  }, [entry.provider, entry.id]);

  return (
    <section className={styles.spotlight}>
      <div className={styles.body}>
        <div className={`${styles.kicker} mono`}>
          <span>
            2.0 — <Scramble text="Spotlight · #01 most read this week" />
          </span>
        </div>
        <h1 className={styles.title} aria-label={live.title}>
          {live.title.split(" ").map((word, i) => (
            // The space lives outside the mask: trailing spaces collapse inside inline-blocks.
            <Fragment key={i}>
              <span className={styles.word} aria-hidden>
                <span style={{ "--i": i } as React.CSSProperties}>{word}</span>
              </span>{" "}
            </Fragment>
          ))}
        </h1>
        <div className={`${styles.author} mono`}>{authorLine(live)}</div>
        {detail?.summary && <p className={styles.summary}>{detail.summary}</p>}
        <div className={styles.actions}>
          <GetButton entry={live} large variant="ink" />
          <button className={`btn btn-lg ${styles.ghost}`} onClick={open}>
            Details
          </button>
        </div>
      </div>
      <button ref={coverRef} className={styles.cover} onClick={open}>
        <div style={{ visibility: lifted ? "hidden" : undefined }}>
          <CatalogCover entry={live} size="lg" />
        </div>
      </button>
    </section>
  );
}
