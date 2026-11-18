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
│  protocol.rs   book:// cover:// catalog-cover:// — files by id, cached covers│
│  stream/       stream:// — catalog books read on demand (HTTP ranges → zip)  │
│  catalog/      Discover: provider sync → catalog.db, details, acquisition   │
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
          %LOCALAPPDATA%\dev.digitallibrary.app\   (cache — safe to delete)
            catalog.db                  index of remote catalogs (rebuildable)
            catalog-covers\             cached remote covers
            streams\                    temporary copies of books read on demand
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
| **Local catalog index (`catalog.db`)** | Gutenberg's ~78k works are mirrored from its official catalog feed. Browsing and search are then instant and work offline, with no dependency on a slow third-party API. Details and covers are fetched lazily and cached. It's a separate database because it's a cache: deleting it costs a re-sync, never user data. |
| **Covers proxied through Rust (`catalog-cover://`)** | Covers are cached on disk, at most 6 fetches run at once (polite to the provider), the CSP stays free of remote origins, and the webview can't request arbitrary URLs (only known provider + id). |
| **Design tokens (`styles/tokens.css`)** | Every color, spacing value, radius and shadow is a CSS variable. The app uses direction C, "Index" (see `design/mocks/`): Archivo + JetBrains Mono, red-orange on ink and paper, numbered sections. |
| **A separate, calm reader** | The library is loud; the reader is deliberately quiet. Its four themes avoid pure black on white, and Night uses soft text against glare. Typefaces are Literata and Atkinson Hyperlegible, with a 60–75 character measure, ragged right and hyphenation. Controls auto-hide. Settings live in `features/reader/settings.ts` and are injected into the EPUB iframe as a stylesheet, or applied as a filter to PDF pages. |
| **Motion system (`lib/motion.ts`)** | One vocabulary for every tween, derived from the Index shape language. The house curve is expo-out (fast start, long settle). Moves are axis-true slides, never wobbles, and there's no bouncy overshoot. Type rises out of masks, hairlines draw, the black pills travel between options, and tilted cards are "dealt". Motion (the framer-motion successor) handles enter/exit, layout and shared pills. Simple on-mount effects are CSS keyframes (`.rise-in`, `.draw-rule`). The cover → listing flight is a hand-rolled FLIP with a portalled ghost: one element instead of hundreds of layout-tracked cards. The reader opens as a `clip-path` window out of the clicked cover and only loads the book once open, so parsing never drops animation frames. Everything respects the OS "reduce motion" setting. |
| **Permanent volume numbers** | Each import takes the next number from a counter (migration 0003), so "No. 042" never changes, even after deletions. |
| **Footnotes open in place** | Note links are caught before epub.js navigates (a capture-phase click listener in the book's frame). The note is found by id, in the same chapter or by loading another one, and copied into a popover through a whitelist of plain formatting tags. Book HTML is untrusted, so it never enters the app's document raw. |
| **Highlights as data, not markup** | EPUB highlights are CFI ranges drawn by epub.js's marks layer; PDF highlights are page rects normalised to 0..1, so they survive any zoom. Neither touches the book file. |
| **Streaming through the zip directory** | An EPUB is a zip, and zips keep their directory at the end. Reading the directory with HTTP range requests, then only the entries epub.js asks for, means a 25 MB illustrated edition opens after ~0.3 MB. No new dependency: a `Read + Seek` adapter over ranges feeds the existing `zip` crate. |
| **Sets** | Curated groups (an author's novels, a canon) defined in `catalog/sets.rs` by Gutenberg id. Ownership comes from the library's `source_*` columns, so getting a book from Discover fills its slot. |

## Data model

```
books ──< book_authors >── authors
  │
  ├── reading_progress (1:1)    locator = EPUB CFI or PDF page number, percent 0..1
  └── books_fts (FTS5)          title · authors · description

annotations                     book_ref = a book id, or "<provider>/<id>" for a streamed book
stream_progress                 (provider, source_id) → locator, percent for streamed books
```

- `annotations.locator` is an EPUB CFI range, or for PDFs JSON `{"page":n,"rects":[[page,x,y,w,h],…]}` with
  coordinates normalised to the page. `book_ref` is deliberately not a foreign key, because notes on a streamed book
  exist before (and without) a library row. Deleting a book deletes its notes in the same transaction.

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

**Footnotes and citations.** EPUB: a link is a note reference when the book marks it (`epub:type`
`noteref`/`biblioref`/`glossref`, or the matching `doc-*` ARIA roles) or when it looks like one: a short marker
such as `12`, `[3]`, `*` or `†`, often superscript, or classes/targets naming a footnote (Gutenberg's
`fnanchor` → `#Footnote_1_1`). The target's note container is found (an `aside`, list item, `.footnote`, or the
paragraph around a bare anchor), back-links are dropped, and the text is shown in a popover with "Go to note".
Other internal links still navigate; web links open in the browser. Logic lives in `features/reader/footnotes.ts`.
PDF: each rendered page gets a link layer from pdf.js annotations; an internal link resolves its destination and
the popover shows a zoomed crop of that spot ("Go to page n" jumps there).

**Highlights and notes.** Selecting text shows a menu (four inks, Note, Copy). EPUB selections come from
epub.js's `selected` event as CFI ranges; PDFs get pdf.js's invisible text layer for selection, and the
selection's client rects are merged per line and normalised to the page. Inks multiply on light pages and screen
on dark ones (the whole marks layer is blended, so text stays crisp). Clicking a highlight opens a card to recolour,
annotate or delete it; notes autosave. The Notes panel lists everything in reading order and copies it as Markdown.

**Reading on demand.** "Read now" in a listing opens `stream_open(provider, id)`. Rust tries the same EPUB
sources, in the same order, as "Get", asking each for `bytes=0-0`:
- `206 Partial Content`: the file is read in place through `stream/range.rs`, a `Read + Seek` over HTTP ranges
  with 64 KB blocks, a 4-block read-ahead and a 64 MB per-book block cache. `zip::ZipArchive` reads the
  central directory through it, and each `stream://localhost/<provider>/<id>/<entry>` request decompresses
  just that entry (same 64 MB zip-bomb cap as import).
- `200`: the server ignores ranges, so the whole file goes to a temporary copy in the cache dir.

epub.js opens the book as a directory URL, so it requests the container, package, navigation and the chapters you
open, and nothing else. It never builds a full location map for a streamed book (that would download all of it),
so progress is estimated by chapter. Closing calls `stream_close(key, keep_minutes)`, and a sweeper drops sessions
(and temporary copies) once they've been closed that long. The streams folder is emptied on launch. Reading position
(`stream_progress`) and notes (`book_ref = "<provider>/<id>"`) are kept. "Keep" runs the normal acquire, reusing
the streamed file's URL (or its temporary copy) so CFIs stay valid, then `adopt_stream` moves notes and position
to the new library book in one transaction.

**Discover.** On launch, a stale or empty catalog triggers a background sync, reported through `catalog-status` events:
1. Download `pg_catalog.csv.gz`, using `If-Modified-Since` so an unchanged catalog is skipped.
2. Parse it, then upsert in one transaction and rebuild the FTS index.
3. Fetch 40 pages of the "most downloaded" OPDS feed to rank the top 1,000 books.

The front page is a spotlight plus curated category rows, de-duplicated so a book appears once. Search blends FTS relevance with popularity. "Get" downloads the EPUB (with `catalog-download` progress events) into `Library/incoming/`, then runs it through the normal import pipeline with an `Origin` (`source_provider`/`source_id`), so the catalog can show "In library". Every listing carries a `provider` and an `Offer`. Those are the seams for a first-party store (see [STOREFRONT.md](STOREFRONT.md)).

**Sources and fallbacks.** gutenberg.org has outages: it returned 503 "down for maintenance" for days in Nov 2026. Every Gutenberg request has a fallback (`catalog/gutenberg.rs`):

| Need | Primary | Fallback |
|---|---|---|
| Catalogue CSV, covers | gutenberg.org | `gutenberg.pglaf.org` (official PGLAF mirror, same paths, ~70 KB/s) |
| Popularity ranking | gutenberg.org OPDS feed | Gutendex popular pages, which also carry summaries and download counts; pages that hang are skipped |
| Book details | gutenberg.org OPDS | Gutendex lookup; otherwise whatever is cached |
| EPUB download | gutenberg.org | Mirror: illustrated edition if ≤ 8 MB, else the compact text edition |

After a 5xx or network failure, gutenberg.org is marked down for 10 minutes, and the mirror is tried first so requests don't wait on a dead server.

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
  features/shell/    numbered header navigation
  features/home/     Home: collection number, stats, index strip, sets, "Tonight" card deck
  features/discover/ Discover front page, search/browse grid, listing sheet, Get button
  features/circles/  Circles preview (needs accounts + sync; see STOREFRONT.md)
  features/reader/   calm reader, settings panel, EPUB/PDF engines
  store/discover.ts  catalog rows, browse results, open listing, in-flight downloads
  styles/            tokens.css (design system) + global.css (incl. motion utilities)
  lib/motion.ts      easing, durations, springs and shared variants
  components/motion/ MaskNumber, CountUp, Scramble
  components/ErrorBoundary.tsx  a crash shows a recoverable screen, never a blank window
```

The readers are code-split. epub.js and pdf.js (~800 KB) load only when a book is opened, so the library view starts with ~250 KB of JS.

## Collected editions

Some books get their own designed showcase, with their own theme, artwork and reading palette. The first is the **Holy Bible**, in an Orthodox theme.

- **Page** (`features/editions/EditionView.tsx`): the book is the hero, a perspective-tilted black leather cover with a bone-white three-bar cross. It sits centred on a dark stage, and real icons and crosses float around it at angles. Below the fold: a verse, a short text and the available translations.
- **Parallax**: one `--scroll` / `--mx` / `--my` CSS variable write per frame. Each floating layer has a `--depth`, and its transform is pure CSS `calc()`, so everything moves on the compositor with no React re-renders. Nearer pieces move faster and are brighter. It respects reduced motion.
- **Book**: a single tilted face with page edges drawn by stacked `box-shadow`s. It deliberately avoids nested `preserve-3d`, which WebKit misplaces inside transformed, clipped parents.
- **Volumes** (`src-tauri/src/catalog/editions.rs`): an edition offers complete single volumes, here the KJV (66 books) and the Douay-Rheims (73, including the deuterocanonical books the Orthodox canon also reads). Moving between books (Genesis → Revelation) happens in the reader's **Contents** panel, which is available for any EPUB.
- **Theme**: `themes.css` scopes the edition's palette onto the whole shell via `data-edition-theme`. Books opened from the edition use its reader palette for that session (Vigil: black page, bone text, red rubric headings).
- **Artwork**: real public-domain and CC0 images, with sources in `src/assets/editions/<theme>/CREDITS.md`. For the Bible: the Sinai *Christ Pantocrator* (6th c.), the Sinai *St Nicholas* (13th c.), Rublev's *Holy Trinity* (c. 1411), the *Archangel Michael* (Constantinople, 14th c.; background cut away), and a CC0 three-bar cross.
- **Adding an edition**: add an `EditionDef` (Rust), a palette in `themes.css`, a reader-theme mapping in `themes.ts`, and the art plus its `FLOATS` layout.

## Performance and memory

Benchmarked with `scripts/make-bench-library.py` (600 EPUBs, each with a 1000×1500 cover). Figures are the WebKit content process RSS on Linux, with compositing off so they're comparable across builds.

| Scenario | Before | After |
|---|---|---|
| Home | 238 MB | 189 MB |
| Collection opened | 420 MB | 212 MB |
| After scrolling the collection | 505 MB | 296 MB |
| Initial JavaScript | 462 kB | 347 kB |

What does it:

- **Thumbnails.** Grids load 240 px or 360 px JPEG thumbnails, chosen by screen density, instead of original covers. A 1500×2300 cover is about 14 MB decoded; a thumbnail is about 0.2–0.5 MB. Thumbnails are made at import, or lazily for older libraries, one at a time to avoid allocation spikes.
- **Windowed grids** (`components/VirtualGrid.tsx`). Large collections (over 150 books) and Discover's infinite results keep only nearby rows in the DOM.
- **Range-loaded PDFs.** pdf.js asks for byte ranges through `PDFDataRangeTransport`, and `book://` answers with `206 Partial Content`. Large PDFs open instantly and only the pages you view are read.
- **Cached EPUB location maps** (`book_locations`). Paging and percentages need a map of the whole book; it's computed once, then reused.
- **Lean queries.** Home asks for 7 books, not the whole library, and grid queries skip long descriptions.
- **Flat-memory catalog sync.** The 78k-row catalog is decompressed, parsed and inserted as a stream.
- **Lazy Motion.** The animation engine loads after first paint. `content-visibility` skips off-screen Discover rows.

## Theme and window chrome

- **Light / Dark / System.** Set via `data-theme` on `<html>` (`lib/theme.ts`); dark mode inverts the palette's roles rather than just darkening it. The native window theme follows, so Mica tints to match. The reader keeps its own palette, and its `color-scheme` is kept in step with the book iframe's, otherwise browsers paint the iframe opaque.
- **Windows** (`tauri.windows.conf.json`). Frameless, with the header as title bar (`data-tauri-drag-region`) and Index-styled caption buttons. On Windows 11 (build ≥ 22000, checked in Rust) the background goes slightly translucent over Mica; on Windows 10 it stays opaque.
- **macOS** (`tauri.macos.conf.json`): native traffic lights overlaid on the header.
- **Linux**: native frame.

## Security posture

- Strict CSP: no remote origins, no inline scripts, and EPUB scripts are disabled (`allowScriptedContent: false`).
  Footnote content is rebuilt from a tag whitelist, never inserted as HTML. Links from books and PDFs open
  externally only for `http(s):` and `mailto:`.
- `stream://` only serves entries of books the user has opened (looked up by session, never by URL), rejects `..`
  paths, and never serves book scripts as script.
- Capabilities grant only `core:default`, the window controls the custom title bar needs, `dialog:allow-open`, `dialog:allow-ask`, `log:default` and `opener:allow-open-url`. There is no general filesystem or shell access from the UI.
- All network access happens in Rust. Listing ids are validated before URLs are built, downloads are size-capped, and the User-Agent identifies the app, never the user.
- Stored file names are validated before joining paths, so path traversal is rejected. Zip entries are size-capped when reading EPUBs, to defuse zip bombs.

## Testing

- `npm test` runs the Rust unit and integration tests. They cover annotations (create, update, clear, re-key on
  "Keep", delete with the book) and streaming (range reader correctness, opening a chapter without fetching the whole
  file, cache reuse, expiry, temp-file cleanup, path validation). `cargo test -- --ignored streams_from_the_mirror`
  streams a real 25 MB book from the Gutenberg mirror and checks only ~1% is fetched. Also: EPUB parsing (EPUB 2 and 3 covers, roles, entities, CDATA, ISBN), repository queries and FTS, sort-name rules, path safety, and a full import with de-duplication against a temp dir. Catalog tests cover the Gutenberg CSV, author-name and OPDS parsing, and ranking, browsing and search blending.
- `npm run typecheck` checks the UI against the generated bindings.
- CI (`.github/workflows/windows.yml`) builds and tests on `windows-latest` and uploads the `.msi` and NSIS installers.

## Roadmap (rough order)

0. ~~Discover with a free catalog (Project Gutenberg)~~ ✓. Next: Standard Ebooks as a second provider.
1. ~~Visual design~~ ✓ Direction C is implemented. Next polish: a custom title bar (`decorations: false`), page-turn and card-deck motion, and a dark variant of the UI.
2. Book detail panel and metadata editing (title, authors, cover replacement).
3. Collections / custom shelves.
4. ~~Reader settings, table of contents, highlights and notes, footnotes, reading on demand~~ ✓. Next: notes
   search across books, and sync once accounts exist.
5. Windows file associations for `.epub` and `.pdf` (launch-arg import is already in place).
6. Auto-update via the Tauri updater plugin and code-signed installers.
