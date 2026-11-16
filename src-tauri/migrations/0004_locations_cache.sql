-- Cached epub.js location maps (character offsets → CFIs). Generating one walks
-- the whole book on the UI thread, which takes seconds for long books; caching
-- makes every reopen instant. Safe to drop: it's regenerated on demand.
CREATE TABLE book_locations (
    book_id     TEXT PRIMARY KEY REFERENCES books (id) ON DELETE CASCADE,
    chars_per   INTEGER NOT NULL,
    data        TEXT NOT NULL
);
