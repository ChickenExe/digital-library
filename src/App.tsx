import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { events } from "./lib/api";
import { useLibrary } from "./store/library";
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

export default function App() {
  const view = useLibrary((s) => s.view);
  const listingOpen = useDiscover((s) => !!s.open);
  const dragging = useDragState();

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
    // Ctrl/⌘+K jumps to search.
    const onKey = (e: KeyboardEvent) => {
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

  if (view.kind === "reader") {
    return (
      <>
        <ReaderView bookId={view.bookId} />
        <Toasts />
      </>
    );
  }

  return (
    <div className={styles.shell}>
      <Header />
      {view.kind === "home" && <HomeView />}
      {view.kind === "discover" && <DiscoverView />}
      {view.kind === "collection" && <LibraryView />}
      {view.kind === "circles" && <CirclesView />}
      {listingOpen && <ListingSheet />}
      {dragging && <DropOverlay />}
      <Toasts />
    </div>
  );
}
