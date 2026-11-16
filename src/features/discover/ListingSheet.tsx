import { useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { authorLine } from "../../lib/format";
import { useDiscover } from "../../store/discover";
import { CatalogCover } from "./CatalogCover";
import { GetButton } from "./GetButton";
import styles from "./ListingSheet.module.css";

const LANGUAGE_NAMES = new Intl.DisplayNames(["en"], { type: "language" });

/** Slide-over with everything about a listing: the "product page". */
export function ListingSheet() {
  const open = useDiscover((s) => s.open)!;
  const close = useDiscover((s) => s.closeListing);
  const { entry, detail } = open;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const facts: [string, string][] = [["Price", "Free · public domain"]];
  if (entry.language) facts.push(["Language", LANGUAGE_NAMES.of(entry.language) ?? entry.language]);
  if (detail?.downloads) facts.push(["Recent downloads", detail.downloads.toLocaleString()]);
  if (detail?.readingLevel) facts.push(["Reading level", detail.readingLevel]);
  if (entry.popularity) facts.push(["Rank", `#${entry.popularity} most read`]);

  return (
    <div className={styles.backdrop} onClick={close}>
      <aside className={styles.sheet} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={entry.title}>
        <div className={`${styles.top} mono`}>
          <span>2.x — Listing</span>
          <button onClick={close} aria-label="Close">
            Close ✕
          </button>
        </div>

        <div className={styles.hero}>
          <div className={styles.cover}>
            <CatalogCover entry={entry} size="lg" />
          </div>
          <div className={styles.heroText}>
            <h1 className={styles.title}>{entry.title}</h1>
            <div className={`${styles.author} mono`}>{authorLine(entry)}</div>
            <div className={styles.actions}>
              <GetButton entry={entry} large />
            </div>
          </div>
        </div>

        <dl className={styles.facts}>
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt className="mono">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>

        <section className={styles.section}>
          <div className="section-label mono">
            <span>
              <b>A</b> — About this book
            </span>
            {detail?.summary && <span>Summary · Project Gutenberg</span>}
          </div>
          {detail ? (
            <p className={styles.summary}>{detail.summary ?? "No description available yet."}</p>
          ) : (
            <div className={styles.skeleton} />
          )}
        </section>

        {(entry.categories.length > 0 || (detail?.subjects.length ?? 0) > 0) && (
          <section className={styles.section}>
            <div className="section-label mono">
              <span>
                <b>B</b> — Topics
              </span>
            </div>
            <div className={styles.chips}>
              {[...entry.categories, ...(detail?.subjects ?? [])].slice(0, 14).map((t) => (
                <span key={t} className={`${styles.chip} mono`}>
                  {t}
                </span>
              ))}
            </div>
          </section>
        )}

        {detail && (
          <button className={`${styles.source} mono`} onClick={() => void openUrl(detail.webUrl)}>
            View on Project Gutenberg ↗
          </button>
        )}
      </aside>
    </div>
  );
}
