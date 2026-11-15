# Digital Library

A desktop home for your ebooks and PDFs. Built with **Tauri 2** (Rust core +
React/TypeScript UI), targeting **Windows** first.

> Status: architecture + working skeleton. The current UI is an intentionally
> neutral wireframe; the visual design comes next.

## What works today

- Import EPUB and PDF files via a picker, by dragging files or folders onto the window,
  or by passing them as command-line arguments (how Windows "Open with" works)
- Metadata extraction (title, authors, description, language, ISBN, page count)
- Cover extraction from EPUBs; first-page covers for PDFs; generated placeholders otherwise
- Duplicate detection by content hash
- Instant full-text search across title, author and description (accent-insensitive)
- Shelves: All, Continue reading, Favorites, Finished; filter by format; four sort orders
- Built-in readers: paginated EPUB (two-page spread) and continuous-scroll PDF
- Reading position saved automatically and restored when you reopen a book

## Getting started

Prerequisites: Node 20+, Rust (stable), and on Windows the
[Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
(WebView2 ships with Windows 10/11). See the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for other platforms.

```bash
npm install
npm run dev        # launches the app with hot reload
npm test           # Rust unit + integration tests
npm run build      # release build → src-tauri/target/release/bundle/ (.msi + setup .exe)
```

Need demo content for UI work?

```bash
python3 scripts/make-sample-books.py ./sample-books
```

Then drag the `sample-books` folder onto the app window.

## Docs

- [Architecture](docs/ARCHITECTURE.md): how the pieces fit and why they were chosen
