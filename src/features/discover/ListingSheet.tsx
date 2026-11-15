import { useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { authorLine } from "../../lib/format";
import { useDiscover } from "../../store/discover";
import { CatalogCover } from "./CatalogCover";
import { GetButton } from "./GetButton";
import styles from "./ListingSheet.module.css";

const LANGUAGE_NAMES = new Intl.DisplayNames(["en"], { type: "language" });

/** Slide-over with everything about a listing; the "product page". */
export function ListingSheet() {
  const open = useDiscover((s) => s.open)!;
  const close = useDiscover((s) => s.closeListing);
  const { entry, detail } = open;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const facts: [string, string][] = [];
  if (entry.language) facts.push(["Language", LANGUAGE_NAMES.of(entry.language) ?? entry.language]);
  if (detail?.downloads) facts.push(["Recent downloads", detail.downloads.toLocaleString()]);
  if (detail?.readingLevel) facts.push(["Reading level", detail.readingLevel]);
  if (detail?.issued) facts.push(["Added to catalog", detail.issued]);

  return (
    <div className={styles.backdrop} onClick={close}>
      <aside className={styles.sheet} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={entry.title}>
        <button className={styles.close} onClick={close} aria-label="Close">
          ✕
        </button>
        <div className={styles.hero}>
          <div className={styles.cover}>
            <CatalogCover entry={entry} size="lg" />
          </div>
          <div>
            <h1 className={styles.title}>{entry.title}</h1>
            <div className={styles.author}>{authorLine(entry)}</div>
            <div className={styles.price}>Free · Public domain</div>
            <div className={styles.actions}>
              <GetButton entry={entry} large />
            </div>
          </div>
        </div>

        <section className={styles.section}>
          <h3>About this book</h3>
          {detail ? (
            <p className={styles.summary}>{detail.summary ?? "No description available yet."}</p>
          ) : (
            <div className={styles.skeleton} />
          )}
          {detail?.summary && <div className={styles.note}>Summary provided by Project Gutenberg.</div>}
        </section>

        {facts.length > 0 && (
          <section className={styles.section}>
            <dl className={styles.facts}>
              {facts.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {(entry.categories.length > 0 || (detail?.subjects.length ?? 0) > 0) && (
          <section className={styles.section}>
            <h3>Topics</h3>
            <div className={styles.chips}>
              {[...entry.categories, ...(detail?.subjects ?? [])].slice(0, 14).map((t) => (
                <span key={t} className={styles.chip}>
                  {t}
                </span>
              ))}
            </div>
          </section>
        )}

        {detail && (
          <button className={styles.source} onClick={() => void openUrl(detail.webUrl)}>
            View on Project Gutenberg ↗
          </button>
        )}
      </aside>
    </div>
  );
}
