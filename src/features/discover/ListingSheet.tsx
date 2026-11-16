import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { m, usePresence } from "motion/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { authorLine } from "../../lib/format";
import { EASE, prefersReducedMotion, SPRING } from "../../lib/motion";
import type { Origin } from "../../store/library";
import { useDiscover } from "../../store/discover";
import { CatalogCover } from "./CatalogCover";
import { GetButton } from "./GetButton";
import styles from "./ListingSheet.module.css";

const LANGUAGE_NAMES = new Intl.DisplayNames(["en"], { type: "language" });

/**
 * Slide-over "product page" for a listing.
 *
 * Choreography: the scrim fades, the paper panel slides in from the right, the
 * cover lifts off the card you clicked and flies into place (FLIP), and the
 * text rises in behind it. Closing plays it backwards: the cover flies home.
 */
export function ListingSheet() {
  // While exiting, the store has already cleared `open`; keep rendering the last listing.
  const live = useDiscover((s) => s.open);
  const latched = useRef(live);
  if (live) latched.current = live;
  const open = latched.current!;
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

  const fadeOut = { opacity: 0, transition: { duration: 0.14 } };

  return (
    <>
      <m.div
        className={styles.scrim}
        onClick={close}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: 0.25 } }}
        exit={{ opacity: 0, transition: { duration: 0.3, delay: 0.12 } }}
      />
      <m.div
        className={styles.panel}
        initial={{ x: "100%" }}
        animate={{ x: 0, transition: SPRING.panel }}
        exit={{ x: "100%", transition: { duration: 0.32, ease: EASE.in, delay: 0.1 } }}
      />
      <aside className={styles.sheet} role="dialog" aria-label={entry.title}>
        <m.div className={`${styles.top} mono`} exit={fadeOut}>
          <span>2.x — Listing</span>
          <button onClick={close} aria-label="Close">
            Close ✕
          </button>
        </m.div>

        <div className={styles.hero}>
          <FlipCover from={open.from}>
            <CatalogCover entry={entry} size="lg" />
          </FlipCover>
          <m.div
            className={`${styles.heroText} rise-in`}
            style={{ "--rise-delay": "140ms" } as React.CSSProperties}
            exit={fadeOut}
          >
            <h1 className={styles.title}>{entry.title}</h1>
            <div className={`${styles.author} mono`}>{authorLine(entry)}</div>
            <div className={styles.actions}>
              <GetButton entry={entry} large />
            </div>
          </m.div>
        </div>

        <m.div exit={fadeOut}>
          <dl
            className={`${styles.facts} draw-rule`}
            style={{ "--rule-color": "var(--color-ink)", "--rule-delay": "200ms" } as React.CSSProperties}
          >
            {facts.map(([k, v], i) => (
              <div key={k} className="rise-in" style={{ "--i": i, "--rise-delay": "220ms" } as React.CSSProperties}>
                <dt className="mono">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>

          <section className={`${styles.section} rise-in`} style={{ "--rise-delay": "300ms" } as React.CSSProperties}>
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
            <section className={`${styles.section} rise-in`} style={{ "--rise-delay": "360ms" } as React.CSSProperties}>
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
        </m.div>
      </aside>
    </>
  );
}

const FLY_EASE = `cubic-bezier(${EASE.out.join(",")})`;
const HOME_EASE = `cubic-bezier(${EASE.inOut.join(",")})`;

const rectOf = (el: Element): Origin => {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
};

/**
 * FLIP with a ghost: the real cover sits (hidden) in its slot while a copy,
 * portalled above everything so no scroll container can clip it, flies from
 * the card you clicked into the slot. On exit the ghost flies home before the
 * sheet is allowed to unmount.
 */
function FlipCover({ from, children }: { from: Origin | null; children: React.ReactNode }) {
  const slot = useRef<HTMLDivElement>(null);
  const [isPresent, safeToRemove] = usePresence();
  const [ghost, setGhost] = useState<{ to: Origin; dir: "in" | "out" } | null>(null);

  useLayoutEffect(() => {
    if (from && slot.current && !prefersReducedMotion()) setGhost({ to: rectOf(slot.current), dir: "in" });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isPresent) return;
    if (from && slot.current && !prefersReducedMotion()) setGhost({ to: rectOf(slot.current), dir: "out" });
    else safeToRemove?.();
  }, [isPresent]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div ref={slot} className={styles.cover} style={{ visibility: ghost ? "hidden" : undefined }}>
        {children}
      </div>
      {ghost &&
        from &&
        createPortal(
          <Ghost
            key={ghost.dir}
            from={from}
            to={ghost.to}
            dir={ghost.dir}
            onDone={() => (ghost.dir === "in" ? setGhost(null) : safeToRemove?.())}
          >
            {children}
          </Ghost>,
          document.body,
        )}
    </>
  );
}

function Ghost(props: { from: Origin; to: Origin; dir: "in" | "out"; onDone: () => void; children: React.ReactNode }) {
  const { from, to, dir, onDone, children } = props;
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const delta = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;
    const frames = dir === "in" ? [{ transform: delta }, { transform: "none" }] : [{ transform: "none" }, { transform: delta }];
    const flight = ref.current!.animate(frames, {
      duration: dir === "in" ? 640 : 460,
      easing: dir === "in" ? FLY_EASE : HOME_EASE,
      fill: "forwards",
    });
    void flight.finished.then(onDone, onDone);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div
      ref={ref}
      className={styles.ghost}
      style={{ left: to.left, top: to.top, width: to.width, height: to.height }}
      aria-hidden
    >
      {children}
    </div>
  );
}
