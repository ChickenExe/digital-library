import "@fontsource-variable/literata/wght.css"; // Greek (incl. polytonic) for the liturgical type
import { useCallback, useEffect, useRef, useState } from "react";
import type { Edition } from "../../bindings/Edition";
import type { EditionVolume } from "../../bindings/EditionVolume";
import { api, errorMessage, events, listingKey } from "../../lib/api";
import { debounce } from "../../lib/format";
import { prefersReducedMotion } from "../../lib/motion";
import { Scramble } from "../../components/motion/Scramble";
import { useDiscover } from "../../store/discover";
import { useLibrary } from "../../store/library";
import { ART } from "./orthodoxArt";
import { EDITION_THEMES } from "./themes";
import styles from "./EditionView.module.css";

/**
 * Pieces floating around the book. Positions are % of the stage; `depth`
 * scales parallax (0 = still, higher = closer to the viewer, moves more).
 */
const FLOATS: { src: string; alt: string; x: number; y: number; w: string; rot: number; depth: number; kind: "icon" | "cross" }[] = [
  { src: ART.cross, alt: "", x: 50, y: 50, w: "min(46vh, 520px)", rot: 0, depth: 0.15, kind: "cross" },
  { src: ART.pantocrator.src, alt: ART.pantocrator.title, x: 15, y: 40, w: "clamp(180px, 19vw, 300px)", rot: -9, depth: 0.55, kind: "icon" },
  { src: ART.nicholas.src, alt: ART.nicholas.title, x: 27, y: 78, w: "clamp(110px, 11vw, 170px)", rot: 7, depth: 1.15, kind: "icon" },
  { src: ART.trinity.src, alt: ART.trinity.title, x: 83, y: 32, w: "clamp(170px, 17vw, 270px)", rot: 8, depth: 0.75, kind: "icon" },
  { src: ART.michael.src, alt: ART.michael.title, x: 74, y: 80, w: "clamp(120px, 12vw, 190px)", rot: -6, depth: 1.3, kind: "icon" },
  { src: ART.cross, alt: "", x: 8, y: 12, w: "34px", rot: -14, depth: 1.7, kind: "cross" },
  { src: ART.cross, alt: "", x: 93, y: 70, w: "46px", rot: 12, depth: 0.45, kind: "cross" },
  { src: ART.cross, alt: "", x: 63, y: 8, w: "26px", rot: 18, depth: 2.1, kind: "cross" },
];

/** 5.x — A collected edition: the book itself, centred, in its own world. */
export default function EditionView({ id }: { id: string }) {
  const edition = useEdition(id);
  const back = useLibrary((s) => s.editionReturn);
  const navigate = useLibrary((s) => s.navigate);
  const page = useParallax();
  const [volumeIndex, setVolumeIndex] = useState(0);

  const readerTheme = edition ? EDITION_THEMES[edition.summary.theme]?.readerTheme : undefined;
  const volume = edition?.volumes[volumeIndex];

  return (
    <main ref={page} className={styles.page}>
      <section className={styles.stage}>
        <div className={styles.glow} aria-hidden />
        {FLOATS.map((f, i) => (
          <div
            key={i}
            className={`${styles.float} ${i === 0 ? styles.bigCross : ""}`}
            style={{ "--x": `${f.x}%`, "--y": `${f.y}%`, "--w": f.w, "--depth": f.depth, "--rot": `${f.rot}deg`, "--i": i } as React.CSSProperties}
            aria-hidden={!f.alt}
          >
            <div className={styles.floatInner}>
              {f.kind === "icon" ? (
                <img src={f.src} alt={f.alt} draggable={false} loading={i > 2 ? "lazy" : undefined} />
              ) : (
                <span className={styles.crossShape} style={{ "--cross": `url(${f.src})` } as React.CSSProperties} />
              )}
            </div>
          </div>
        ))}

        <div className={`section-label mono ${styles.topRow}`}>
          <span>
            <b>5.0</b> — <Scramble text="Collected edition" />
          </span>
          <button className="mono" onClick={() => navigate(back)}>
            ← Back
          </button>
        </div>

        <div className={styles.center}>
          {volume ? (
            <BookButton volume={volume} readerTheme={readerTheme}>
              <Book3D title={edition!.summary.title} original={edition!.summary.original} />
            </BookButton>
          ) : (
            <Book3D title="" original="" />
          )}
          <div className={styles.under}>
            {edition && volume && <VolumeActions volume={volume} readerTheme={readerTheme} />}
            {edition && edition.volumes.length > 1 && (
              <div className={`${styles.toggle} mono`} role="tablist" aria-label="Translation">
                {edition.volumes.map((v, i) => (
                  <button key={v.entry.id} role="tab" aria-selected={i === volumeIndex} className={i === volumeIndex ? styles.on : ""} onClick={() => setVolumeIndex(i)}>
                    {v.label}
                  </button>
                ))}
              </div>
            )}
            {volume && <div className={`mono ${styles.note}`}>{volume.note}</div>}
          </div>
        </div>
        <div className={`mono ${styles.scrollHint}`} aria-hidden>
          Scroll
        </div>
      </section>

      {edition && (
        <section className={styles.lower}>
          <blockquote className={styles.verse}>
            <p>{edition.verse}</p>
            <cite className="mono">{edition.verseRef}</cite>
          </blockquote>
          <p className={styles.blurb}>{edition.blurb}</p>
          <div className={styles.volumes}>
            {edition.volumes.map((v, i) => (
              <VolumeRow key={v.entry.id} volume={v} index={i} readerTheme={readerTheme} />
            ))}
          </div>
          <footer className={`${styles.colophon} mono`}>
            Texts: public domain, via Project Gutenberg. Icons: Christ Pantocrator (Sinai, 6th c.), St Nicholas (Sinai,
            13th c.), Andrei Rublev’s Holy Trinity (c. 1411), and the Archangel Michael (Constantinople, 14th c.). Public
            domain, via Wikimedia Commons.
          </footer>
        </section>
      )}
    </main>
  );
}

/** The Bible as an object: black leather, bone-white cross, gilt-less and severe. */
function Book3D({ title, original }: { title: string; original: string }) {
  return (
    <div className={styles.bookWrap}>
      {/* One perspective-tilted cover; thickness comes from stacked page-edge shadows.
          (No nested preserve-3d: WebKit misplaces faces inside transformed, clipped parents.) */}
      <div className={styles.book} aria-label={title} role="img">
        <div className={styles.front}>
          <div className={styles.frame} />
          <span className={styles.coverCross} style={{ "--cross": `url(${ART.cross})` } as React.CSSProperties} />
          <div className={styles.coverTitle}>{title}</div>
          <div className={styles.coverOriginal} lang="grc">
            {original.toUpperCase()}
          </div>
        </div>
      </div>
      <div className={styles.shadow} aria-hidden />
    </div>
  );
}

function useAction(volume: EditionVolume, readerTheme?: string) {
  const openBook = useLibrary((s) => s.openBook);
  const acquire = useDiscover((s) => s.acquire);
  const downloading = useDiscover((s) => !!s.downloads[listingKey(volume.entry)]);
  const owned = volume.entry.ownedBookId;
  const run = (from: Element) => (owned ? openBook(owned, from, { readerTheme }) : void acquire(volume.entry));
  const pct = volume.progress !== null ? Math.round(volume.progress * 100) : null;
  const label = downloading ? "Downloading…" : owned ? (pct ? `Continue · ${pct}%` : "Open & read") : "Get · Free";
  return { run, label, downloading };
}

/** The book itself opens (or downloads) the selected translation. */
function BookButton({ volume, readerTheme, children }: { volume: EditionVolume; readerTheme?: string; children: React.ReactNode }) {
  const { run, label, downloading } = useAction(volume, readerTheme);
  return (
    <button className={styles.bookButton} disabled={downloading} aria-label={`${volume.label}: ${label}`} onClick={(e) => run(e.currentTarget)}>
      {children}
    </button>
  );
}

function VolumeActions({ volume, readerTheme }: { volume: EditionVolume; readerTheme?: string }) {
  const { run, label, downloading } = useAction(volume, readerTheme);
  return (
    <button className={`btn btn-ink btn-lg ${styles.cta}`} disabled={downloading} onClick={(e) => run(e.currentTarget)}>
      {label}
    </button>
  );
}

function VolumeRow({ volume, index, readerTheme }: { volume: EditionVolume; index: number; readerTheme?: string }) {
  const { run, label, downloading } = useAction(volume, readerTheme);
  return (
    <button className={styles.volume} disabled={downloading} onClick={(e) => run(e.currentTarget)}>
      <span className={`mono ${styles.volumeNo}`}>0{index + 1}</span>
      <span className={styles.volumeLabel}>{volume.label}</span>
      <span className={`mono ${styles.volumeNote}`}>{volume.note}</span>
      <span className={`mono ${styles.volumeGo}`}>{label} →</span>
      {volume.progress !== null && (
        <span className={styles.volumeTrack}>
          <i style={{ width: `${volume.progress * 100}%` }} />
        </span>
      )}
    </button>
  );
}

/**
 * Scroll + pointer parallax driven by CSS variables on the page element
 * (`--scroll` in px, `--mx`/`--my` in −1…1). One style write per frame;
 * every layer moves on the compositor via transforms.
 */
function useParallax() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    let frame = 0;
    let mx = 0;
    let my = 0;
    const write = () => {
      frame = 0;
      el.style.setProperty("--scroll", String(el.scrollTop));
      el.style.setProperty("--mx", mx.toFixed(3));
      el.style.setProperty("--my", my.toFixed(3));
    };
    const schedule = () => (frame ||= requestAnimationFrame(write));
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      mx = ((e.clientX - r.left) / r.width) * 2 - 1;
      my = ((e.clientY - r.top) / r.height) * 2 - 1;
      schedule();
    };
    el.addEventListener("scroll", schedule, { passive: true });
    el.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", schedule);
      el.removeEventListener("pointermove", onMove);
    };
  }, []);
  return ref;
}

/** Loads an edition and keeps it current as volumes are downloaded and read. */
function useEdition(id: string): Edition | null {
  const [edition, setEdition] = useState<Edition | null>(null);
  const load = useCallback(() => {
    api.edition(id).then(setEdition, (e) => useLibrary.getState().toast(errorMessage(e), "error"));
  }, [id]);
  useEffect(() => {
    load();
    const reload = debounce(load, 250);
    const off = events.onLibraryChanged(() => reload());
    return () => void off.then((f) => f());
  }, [load]);
  return edition;
}
