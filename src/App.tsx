import { lazy, Suspense, useEffect, useRef } from "react";
import { AnimatePresence, LazyMotion, m, MotionConfig } from "motion/react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { events } from "./lib/api";
import { page, SECTION_ORDER } from "./lib/motion";
import { sectionOf, useLibrary, type Page, type Section } from "./store/library";
import { useDiscover } from "./store/discover";
import { Header } from "./features/shell/Header";
import { HomeView } from "./features/home/HomeView";
import { LibraryView } from "./features/library/LibraryView";
import { DiscoverView } from "./features/discover/DiscoverView";
import { ListingSheet } from "./features/discover/ListingSheet";
import { CirclesView } from "./features/circles/CirclesView";
import { ReaderView } from "./features/reader/ReaderView";
import { Toasts } from "./features/library/Toasts";
import { DropOverlay, useDragState } from "./features/library/DropOverlay";
import styles from "./App.module.css";

// Collected editions are code-split: their fonts and art load only when opened.
const EditionView = lazy(() => import("./features/editions/EditionView"));

const VIEWS: Record<Section, () => React.JSX.Element> = {
  home: HomeView,
  discover: DiscoverView,
  collection: LibraryView,
  circles: CirclesView,
};

export default function App() {
  const view = useLibrary((s) => s.view);
  const listingOpen = useDiscover((s) => !!s.open);
  const dragging = useDragState();

  const editionReturn = useLibrary((s) => s.editionReturn);

  // The page stays mounted under the reader, so closing a book lands exactly where you were.
  const current: Page = view.kind === "reader" ? view.returnTo : view;
  const section = sectionOf(current, editionReturn);
  const pageKey = current.kind === "edition" ? `edition:${current.id}` : current.kind;
  const direction = useDirection(pageKey);
  const editionTheme = current.kind === "edition" ? current.theme : undefined;
  useThemeCrossfade(editionTheme);

  useEffect(() => {
    const { refresh, setImportProgress } = useLibrary.getState();
    void refresh();
    void useDiscover.getState().init();
    const unlisten = [
      events.onLibraryChanged(() => void useLibrary.getState().refresh()),
      events.onImportProgress((p) => setImportProgress(p.done < p.total ? p : null)),
      events.onCatalogStatus((s) => useDiscover.getState().setStatus(s)),
      events.onDownloadProgress((p) => useDiscover.getState().onDownloadProgress(p)),
      // OS-level drag & drop gives us real file paths (the DOM API doesn't).
      getCurrentWebview().onDragDropEvent((e) => {
        if (e.payload.type === "drop") void useLibrary.getState().importPaths(e.payload.paths);
      }),
    ];
    // Ctrl/⌘+K jumps to search (not while reading).
    const onKey = (e: KeyboardEvent) => {
      if (useLibrary.getState().view.kind === "reader") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useLibrary.getState().navigate("discover");
        requestAnimationFrame(() => document.querySelector<HTMLInputElement>("[data-search]")?.focus());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      unlisten.forEach((p) => p.then((off) => off()));
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    // Motion's animation engine loads as a separate chunk after first paint (`m` components
    // render immediately and start animating once it arrives). `strict` keeps it that way.
    <LazyMotion features={loadMotionFeatures} strict>
    <MotionConfig reducedMotion="user">
      {/* An open edition themes the whole shell (header included) via scoped tokens. */}
      <div className={styles.shell} inert={view.kind === "reader"} data-edition-theme={editionTheme}>
        <Header />
        {/* A red hairline sweeps under the header on every section change. */}
        <m.div
          key={`sweep-${pageKey}`}
          className={styles.sweep}
          style={{ originX: direction >= 0 ? 0 : 1 }}
          initial={{ scaleX: 0, opacity: 1 }}
          animate={{ scaleX: 1, opacity: 0, transition: { scaleX: { duration: 0.5, ease: [0.16, 1, 0.3, 1] }, opacity: { delay: 0.35, duration: 0.3 } } }}
        />
        <div className={styles.stage}>
          {/* popLayout: the old page leaves while the new one arrives (no blank gap). */}
          <AnimatePresence mode="popLayout" custom={direction} initial={false}>
            <m.div
              key={pageKey}
              className={styles.page}
              custom={direction}
              variants={page}
              initial="enter"
              animate="center"
              exit="exit"
            >
              {current.kind === "edition" ? (
                <Suspense fallback={null}>
                  <EditionView id={current.id} />
                </Suspense>
              ) : (
                (() => {
                  const Current = VIEWS[section];
                  return <Current />;
                })()
              )}
            </m.div>
          </AnimatePresence>
        </div>
        <AnimatePresence onExitComplete={() => useDiscover.getState().endMorph()}>
          {listingOpen && <ListingSheet key="listing" />}
        </AnimatePresence>
        <AnimatePresence>{dragging && <DropOverlay key="drop" />}</AnimatePresence>
      </div>

      <AnimatePresence>
        {view.kind === "reader" && (
          <ReaderView key={view.bookId} bookId={view.bookId} origin={view.origin} readerTheme={view.readerTheme} />
        )}
      </AnimatePresence>
      <Toasts />
    </MotionConfig>
    </LazyMotion>
  );
}

const loadMotionFeatures = () => import("./lib/motionFeatures").then((mod) => mod.default);

/** Pages beyond the four sections (editions) count as "deeper": entering slides forward. */
const orderOf = (key: string) => (key in SECTION_ORDER ? SECTION_ORDER[key as Section] : 10);

/** +1 when moving right along 01→04 (or into an edition), -1 when moving back. */
function useDirection(key: string): number {
  const prev = useRef(key);
  const dir = useRef(1);
  if (prev.current !== key) {
    dir.current = orderOf(key) >= orderOf(prev.current) ? 1 : -1;
    prev.current = key;
  }
  return dir.current;
}

/** Entering or leaving a themed edition cross-fades the palette rather than snapping. */
function useThemeCrossfade(theme: string | undefined) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const root = document.documentElement;
    root.classList.add("theme-switching");
    const t = window.setTimeout(() => root.classList.remove("theme-switching"), 380);
    return () => window.clearTimeout(t);
  }, [theme]);
}
