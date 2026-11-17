import { useEffect, useRef } from "react";
import { m } from "motion/react";
import { EASE, SPRING } from "../../lib/motion";
import styles from "./ContentsPanel.module.css";

export type TocItem = { label: string; href: string; depth: number };

type Props = { items: TocItem[]; current?: string; onGo: (href: string) => void; onClose: () => void };

/**
 * The book's table of contents: for the Bible, Genesis → Revelation. Slides in
 * from the left (settings come from the right), and opens scrolled to where
 * you are.
 */
export function ContentsPanel({ items, current, onGo, onClose }: Props) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>("[aria-current]")?.scrollIntoView({ block: "center" });
  }, []);
  return (
    <>
      <m.div className={styles.scrim} onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <m.nav
        className={styles.panel}
        aria-label="Contents"
        initial={{ x: "-104%" }}
        animate={{ x: 0, transition: SPRING.panel }}
        exit={{ x: "-104%", transition: { duration: 0.22, ease: EASE.in } }}
      >
        <div className={styles.head}>
          <span>Contents</span>
          <span>{items.length}</span>
        </div>
        <ol ref={list} className={styles.list}>
          {items.map((item, i) => {
            const here = item.label === current;
            return (
              <li key={`${item.href}-${i}`}>
                <button
                  className={here ? styles.here : undefined}
                  aria-current={here ? "location" : undefined}
                  style={{ paddingLeft: 16 + item.depth * 16 }}
                  onClick={() => onGo(item.href)}
                >
                  {item.label}
                </button>
              </li>
            );
          })}
        </ol>
      </m.nav>
    </>
  );
}
