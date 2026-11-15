import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { events } from "./lib/api";
import { useLibrary } from "./store/library";
import { LibraryView } from "./features/library/LibraryView";
import { ReaderView } from "./features/reader/ReaderView";
import { Toasts } from "./features/library/Toasts";
import { DropOverlay, useDragState } from "./features/library/DropOverlay";

export default function App() {
  const view = useLibrary((s) => s.view);
  const dragging = useDragState();

  useEffect(() => {
    const { refresh, setImportProgress } = useLibrary.getState();
    void refresh();
    const unlisten = [
      events.onLibraryChanged(() => void useLibrary.getState().refresh()),
      events.onImportProgress((p) => setImportProgress(p.done < p.total ? p : null)),
      // OS-level drag & drop gives us real file paths (the DOM API doesn't).
      getCurrentWebview().onDragDropEvent((e) => {
        if (e.payload.type === "drop") void useLibrary.getState().importPaths(e.payload.paths);
      }),
    ];
    return () => unlisten.forEach((p) => p.then((off) => off()));
  }, []);

  return (
    <>
      {view.kind === "library" ? <LibraryView /> : <ReaderView bookId={view.bookId} />}
      {dragging && view.kind === "library" && <DropOverlay />}
      <Toasts />
    </>
  );
}
