import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { events } from "./lib/api";
import { useLibrary } from "./store/library";
import { useDiscover } from "./store/discover";
import { Sidebar } from "./features/library/Sidebar";
import { LibraryView } from "./features/library/LibraryView";
import { DiscoverView } from "./features/discover/DiscoverView";
import { ReaderView } from "./features/reader/ReaderView";
import { Toasts } from "./features/library/Toasts";
import { DropOverlay, useDragState } from "./features/library/DropOverlay";
import styles from "./App.module.css";

export default function App() {
  const view = useLibrary((s) => s.view);
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
    return () => unlisten.forEach((p) => p.then((off) => off()));
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
      <Sidebar />
      {view.kind === "discover" ? <DiscoverView /> : <LibraryView />}
      {dragging && <DropOverlay />}
      <Toasts />
    </div>
  );
}
