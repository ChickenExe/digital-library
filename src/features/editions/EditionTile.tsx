import { useCallback, useEffect, useState } from "react";
import type { EditionSummary } from "../../bindings/EditionSummary";
import { api, events } from "../../lib/api";
import { debounce } from "../../lib/format";
import { useLibrary } from "../../store/library";
import { OrthodoxCross } from "./OrthodoxCross";
import styles from "./EditionTile.module.css";

/** Collected editions, kept current as books are collected and read. */
export function useEditionSummaries(): EditionSummary[] {
  const [list, setList] = useState<EditionSummary[]>([]);
  const load = useCallback(() => void api.editionSummaries().then(setList, () => {}), []);
  useEffect(() => {
    load();
    const reload = debounce(load, 300);
    const off = events.onLibraryChanged(() => reload());
    return () => void off.then((f) => f());
  }, [load]);
  return list;
}

/**
 * The doorway to a collected edition. It wears the edition's own theme (the
 * palette is scoped CSS variables), so it reads as a different object even
 * inside the light app.
 */
export function EditionTile({ edition, wide }: { edition: EditionSummary; wide?: boolean }) {
  const openEdition = useLibrary((s) => s.openEdition);
  const pct = edition.available ? edition.owned / edition.available : 0;
  return (
    <button
      className={`${styles.tile} ${wide ? styles.wide : ""}`}
      data-edition-theme={edition.theme}
      onClick={() => openEdition(edition.id, edition.theme)}
    >
      <div className={styles.cross} aria-hidden>
        <OrthodoxCross />
      </div>
      <div className={styles.body}>
        <div className={`mono ${styles.kicker}`}>Collected edition · {edition.subtitle}</div>
        <div className={styles.title}>{edition.title}</div>
        <div className={styles.original} lang="grc">
          {edition.original}
        </div>
        <div className={styles.progress}>
          <span className={styles.track}>
            <i style={{ width: `${pct * 100}%` }} />
          </span>
          <span className="mono">
            {edition.owned}/{edition.available} collected
          </span>
        </div>
      </div>
      <span className={`mono ${styles.open}`}>Open →</span>
    </button>
  );
}
