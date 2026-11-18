-- Highlights and notes. `book_ref` is a library book id, or "<provider>/<id>"
-- for a book read on demand (streamed) from a catalog. A streamed book's notes
-- are kept when its content is discarded, and move to the library copy if the
-- reader later keeps the book (see books::adopt_stream).
CREATE TABLE annotations (
    id          TEXT PRIMARY KEY,               -- UUIDv7
    book_ref    TEXT NOT NULL,
    -- EPUB: a CFI range. PDF: JSON {"page":n,"rects":[[page,x,y,w,h],…]} with
    -- coordinates normalised to the page (0..1), so they survive any zoom.
    locator     TEXT NOT NULL,
    quote       TEXT NOT NULL,
    note        TEXT,
    color       TEXT NOT NULL CHECK (color IN ('yellow', 'green', 'blue', 'pink')),
    chapter     TEXT,
    position    REAL NOT NULL DEFAULT 0,        -- 0..1 through the book, for ordering and labels
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
CREATE INDEX annotations_book ON annotations (book_ref, position);

-- Where you are in a streamed book. Survives the content being discarded, so
-- reopening it (or keeping it) resumes in place.
CREATE TABLE stream_progress (
    provider    TEXT NOT NULL,
    source_id   TEXT NOT NULL,
    locator     TEXT NOT NULL,
    percent     REAL NOT NULL CHECK (percent BETWEEN 0 AND 1),
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (provider, source_id)
);
