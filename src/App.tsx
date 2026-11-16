import { useEffect, useRef } from "react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { events } from "./lib/api";
import { page, SECTION_ORDER } from "./lib/motion";
import { useLibrary, type Section } from "./store/library";
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

  // The section stays mounted under the reader, so closing a book lands exactly where you were.
  const section: Section = view.kind === "reader" ? view.returnTo : view.kind;
  const direction = useDirection(section);
  const Current = VIEWS[section];

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
    <MotionConfig reducedMotion="user">
      <div className={styles.shell} inert={view.kind === "reader"}>
        <Header />
        {/* A red hairline sweeps under the header on every section change. */}
        <motion.div
          key={`sweep-${section}`}
          className={styles.sweep}
          style={{ originX: direction >= 0 ? 0 : 1 }}
          initial={{ scaleX: 0, opacity: 1 }}
          animate={{ scaleX: 1, opacity: 0, transition: { scaleX: { duration: 0.5, ease: [0.16, 1, 0.3, 1] }, opacity: { delay: 0.35, duration: 0.3 } } }}
        />
        <div className={styles.stage}>
          {/* popLayout: the old page leaves while the new one arrives (no blank gap). */}
          <AnimatePresence mode="popLayout" custom={direction} initial={false}>
            <motion.div
              key={section}
              className={styles.page}
              custom={direction}
              variants={page}
              initial="enter"
              animate="center"
              exit="exit"
            >
              <Current />
            </motion.div>
          </AnimatePresence>
        </div>
        <AnimatePresence onExitComplete={() => useDiscover.getState().endMorph()}>
          {listingOpen && <ListingSheet key="listing" />}
        </AnimatePresence>
        <AnimatePresence>{dragging && <DropOverlay key="drop" />}</AnimatePresence>
      </div>

      <AnimatePresence>
        {view.kind === "reader" && <ReaderView key={view.bookId} bookId={view.bookId} origin={view.origin} />}
      </AnimatePresence>
      <Toasts />
    </MotionConfig>
  );
}

/** +1 when moving right along 01→04, -1 when moving left. */
function useDirection(section: Section): number {
  const prev = useRef(section);
  const dir = useRef(1);
  if (prev.current !== section) {
    dir.current = SECTION_ORDER[section] >= SECTION_ORDER[prev.current] ? 1 : -1;
    prev.current = section;
  }
  return dir.current;
}
