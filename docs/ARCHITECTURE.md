# Architecture

Digital Library is a **Tauri 2** desktop app. The Rust side owns the data:
the database, the files, parsing, and search. The React/TypeScript side owns
the pixels. They talk through a small, typed command API.

```
┌──────────────────────────── WebView2 (Chromium) ────────────────────────────┐
│  React UI                                                                   │
│  features/library  ─┐                                                       │
│  features/reader   ─┼─► store/library.ts (zustand) ─► lib/api.ts ──invoke──┐│
│  features/covers   ─┘                                  ▲  events  ▲        ││
│                         epub.js · pdf.js               │          │        ││
│        fetch(book://id) / <img src=cover://id>         │          │        ││
└───────────────┬────────────────────────────────────────┼──────────┼────────┘│
                │ custom URI schemes                     │ IPC      │         │
┌───────────────▼────────────────────────────────────────┴──────────┴─────────┐
│  Rust core (src-tauri/src)                                                  │
│  protocol.rs   book:// cover://  — file streaming, looked up by id          │
│  commands.rs   thin command handlers, emit `library-changed`                │
│  import/       hash → dedupe → extract (epub.rs / pdf.rs) → copy → insert   │
│  db/           rusqlite + migrations + books repository + FTS5              │
│  library.rs    on-disk layout, safe path joins                              │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       ▼
          %APPDATA%\dev.digitallibrary.app\
            library.db                  SQLite (WAL)
            Library\books\<id>.epub     managed copies of imported files
            Library\covers\<id>.jpg     extracted / generated covers
```

## Key decisions

| Decision | Why |
|---|---|
| **Tauri 2** over Electron or a native Rust GUI | Rust core plus a web UI gives the most room for a polished look (CSS motion, blur, typography) with a ~10 MB installer. On Windows the webview is WebView2, i.e. evergreen Chromium, so rendering is predictable. |
| **SQLite via `rusqlite` (bundled)** | One file, transactional, no server. Bundling compiles SQLite into the binary, so FTS5 and the version are the same on every machine. |
| **FTS5 full-text search** | Search-as-you-type over title, authors and description with prefix matching and accent folding (`tomas` finds `Tomás`). |
| **Managed library folder (copies files)** | The library survives the user moving or deleting their downloads, and file names are id-based so they never collide. "Link in place" can be added later as an option. |
| **Content-hash de-duplication** | Re-importing the same file, even renamed, is a no-op. |
| **Custom `book://` and `cover://` schemes** | The webview streams files without the frontend ever handling filesystem paths. Lookups go by id through the DB, so a URL can't name an arbitrary file. Works under a strict CSP. |
| **PDF covers rendered in the frontend** | pdf.js is already shipped for the reader. Reusing it avoids bundling pdfium (a ~5 MB native DLL). Rendered JPEGs go back to Rust as a raw binary IPC body. |
| **`ts-rs` generated types** | `src/bindings/*.ts` are generated from the Rust structs, so the two sides can't silently drift apart. |
| **Design tokens (`styles/tokens.css`)** | Every color, spacing value, radius and shadow is a CSS variable. The upcoming redesign is mostly a token rewrite plus component CSS. Logic doesn't change. |

## Data model

```
books ──< book_authors >── authors
  │
  ├── reading_progress (1:1)    locator = EPUB CFI or PDF page number, percent 0..1
  └── books_fts (FTS5)          title · authors · description
```

- Ids are **UUIDv7** (time-ordered, so they also index well).
- `cover_state`: `present` (file exists), `pending` (the frontend should render one, used for PDFs), or `missing` (show a placeholder).
- Migrations live in `src-tauri/migrations/NNNN_*.sql`. They are applied in order and tracked with `PRAGMA user_version`. They are append-only: never edit a shipped migration.

## Flows

**Import.** The picker, drag-drop, or launch args hand `import_paths(paths)` a list. Folders are walked recursively. For each file the pipeline:

1. Computes the SHA-256 hash. If it already exists, the file is reported as a duplicate.
2. Extracts metadata: EPUB through `container.xml` → OPF (EPUB 2 and 3 cover rules, then heuristics); PDF through lopdf's metadata-only loader, falling back to the filename.
3. Copies the file and writes the cover.
4. Inserts the book, its authors and the FTS row in one transaction.

If any step fails, the copied files are removed. Progress streams over the `import-progress` event. The DB lock is held per file, not per batch, so the UI stays responsive during large imports.

**Reading.** The reader fetches `book://<id>` as bytes, then:
- EPUB goes to epub.js in paginated mode. Percentages come from a location map generated after first paint.
- PDF goes to pdf.js in continuous scroll. Every page gets a correctly sized placeholder, and only pages near the viewport are rasterised.

Position changes are debounced and saved with `save_progress`.

**Refresh.** Commands that change the catalogue emit `library-changed`. The store re-runs the current query. Stale responses are dropped with a sequence counter.

## Frontend layout

```
src/
  bindings/          generated by ts-rs, do not edit (npm run bindings)
  lib/api.ts         the only place that calls invoke(): typed wrappers + events + URLs
  lib/pdf.ts         pdf.js setup and page rendering
  store/library.ts   zustand store: query, results, stats, view, toasts
  features/library/  sidebar, toolbar, grid, cards, drop overlay, toasts
  features/reader/   ReaderView shell + lazily loaded EpubReader / PdfReader
  features/covers/   background PDF cover generation queue
  styles/            tokens.css (design system) + global.css
```

The readers are code-split. epub.js and pdf.js (~800 KB) load only when a book is opened, so the library view starts with ~250 KB of JS.

## Security posture

- Strict CSP: no remote origins, no inline scripts, and EPUB scripts are disabled (`allowScriptedContent: false`).
- Capabilities grant only `core:default`, `dialog:allow-open`, `dialog:allow-ask` and `log:default`. There is no general filesystem or shell access from the UI.
- Stored file names are validated before joining paths, so path traversal is rejected. Zip entries are size-capped when reading EPUBs, to defuse zip bombs.

## Testing

- `npm test` runs the Rust unit and integration tests: EPUB parsing (EPUB 2 and 3 covers, roles, entities, CDATA, ISBN), repository queries and FTS, sort-name rules, path safety, and a full import with de-duplication against a temp dir.
- `npm run typecheck` checks the UI against the generated bindings.
- CI (`.github/workflows/windows.yml`) builds and tests on `windows-latest` and uploads the `.msi` and NSIS installers.

## Roadmap (rough order)

1. **Visual design**: inspiration → wireframes → pick a direction → rewrite tokens and components. Likely a custom title bar (`decorations: false`) and Windows Mica/Acrylic window effects.
2. Book detail panel and metadata editing (title, authors, cover replacement).
3. Collections / custom shelves.
4. Reader settings: font, size, theme, margins, scroll vs. paged. Also a table of contents, plus highlights and notes.
5. Windows file associations for `.epub` and `.pdf` (launch-arg import is already in place).
6. Auto-update via the Tauri updater plugin and code-signed installers.
