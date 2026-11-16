import { useState } from "react";
import type { CatalogEntry } from "../../bindings/CatalogEntry";
import { catalogCoverUrl } from "../../lib/api";
import { authorLine, hueFor } from "../../lib/format";
import styles from "./CatalogCover.module.css";

/** Remote cover with a typeset placeholder while loading or when missing. */
export function CatalogCover({ entry, size = "md" }: { entry: CatalogEntry; size?: "md" | "lg" }) {
  const [state, setState] = useState<"loading" | "ok" | "failed">("loading");
  const hue = hueFor(entry.id);
  return (
    <div className={`${styles.cover} ${styles[size]}`}>
      {state !== "ok" && (
        <div
          className={styles.placeholder}
          style={{ background: `hsl(${hue} 16% 24%)` }}
        >
          <div className={styles.title}>{entry.title}</div>
          <div className={styles.author}>{authorLine(entry)}</div>
        </div>
      )}
      {state !== "failed" && (
        <img
          src={catalogCoverUrl(entry)}
          alt=""
          loading="lazy"
          draggable={false}
          className={styles.img}
          style={{ opacity: state === "ok" ? 1 : 0 }}
          onLoad={() => setState("ok")}
          onError={() => setState("failed")}
        />
      )}
    </div>
  );
}
