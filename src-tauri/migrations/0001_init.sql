-- Core catalogue. Timestamps are unix epoch milliseconds.
CREATE TABLE books (
    id              TEXT PRIMARY KEY,           -- UUIDv7 (time-ordered)
    title           TEXT NOT NULL,
    sort_title      TEXT NOT NULL,              -- title without leading articles, lowercased
    description     TEXT,
    publisher       TEXT,
    language        TEXT,
    published       TEXT,                       -- free-form date string from metadata
    isbn            TEXT,
    format          TEXT NOT NULL CHECK (format IN ('epub', 'pdf')),
    file_name       TEXT NOT NULL,              -- relative to <library>/books
    original_name   TEXT NOT NULL,
    file_size       INTEGER NOT NULL,
    file_hash       TEXT NOT NULL UNIQUE,       -- sha256, used for de-duplication
    page_count      INTEGER,
    cover_file      TEXT,                       -- relative to <library>/covers
    cover_state     TEXT NOT NULL DEFAULT 'missing'
                    CHECK (cover_state IN ('present', 'pending', 'missing')),
    cover_updated_at INTEGER NOT NULL DEFAULT 0, -- cache-buster for cover URLs
    favorite        INTEGER NOT NULL DEFAULT 0,
    added_at        INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

CREATE INDEX books_sort_title ON books (sort_title);
CREATE INDEX books_added_at   ON books (added_at);

CREATE TABLE authors (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    sort_name   TEXT NOT NULL                   -- "Le Guin, Ursula K."
);

CREATE TABLE book_authors (
    book_id     TEXT    NOT NULL REFERENCES books (id) ON DELETE CASCADE,
    author_id   INTEGER NOT NULL REFERENCES authors (id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    PRIMARY KEY (book_id, author_id)
);

CREATE TABLE reading_progress (
    book_id     TEXT PRIMARY KEY REFERENCES books (id) ON DELETE CASCADE,
    locator     TEXT NOT NULL,                  -- EPUB CFI or PDF page number
    percent     REAL NOT NULL CHECK (percent BETWEEN 0 AND 1),
    updated_at  INTEGER NOT NULL
);

-- Full-text search across title/authors/description. Maintained by the
-- repository layer inside the same transaction as the row it indexes.
CREATE VIRTUAL TABLE books_fts USING fts5 (
    book_id UNINDEXED,
    title,
    authors,
    description,
    tokenize = 'unicode61 remove_diacritics 2'
);
