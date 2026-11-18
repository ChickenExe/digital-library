-- Accept more book formats (MOBI/AZW3, FB2, CBZ). The format CHECK lives in the
-- table definition, so the table is rebuilt (SQLite's documented procedure).
-- The runner turns foreign keys off around migrations, so the rows that
-- reference books (authors, progress, locations) are untouched by the drop.
CREATE TABLE books_new (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    sort_title      TEXT NOT NULL,
    description     TEXT,
    publisher       TEXT,
    language        TEXT,
    published       TEXT,
    isbn            TEXT,
    format          TEXT NOT NULL CHECK (format IN ('epub', 'pdf', 'mobi', 'fb2', 'cbz')),
    file_name       TEXT NOT NULL,
    original_name   TEXT NOT NULL,
    file_size       INTEGER NOT NULL,
    file_hash       TEXT NOT NULL UNIQUE,
    page_count      INTEGER,
    cover_file      TEXT,
    cover_state     TEXT NOT NULL DEFAULT 'missing'
                    CHECK (cover_state IN ('present', 'pending', 'missing')),
    cover_updated_at INTEGER NOT NULL DEFAULT 0,
    favorite        INTEGER NOT NULL DEFAULT 0,
    added_at        INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    source_provider TEXT,
    source_id       TEXT,
    volume_no       INTEGER
);

INSERT INTO books_new (
    id, title, sort_title, description, publisher, language, published, isbn, format,
    file_name, original_name, file_size, file_hash, page_count, cover_file, cover_state,
    cover_updated_at, favorite, added_at, updated_at, source_provider, source_id, volume_no
)
SELECT
    id, title, sort_title, description, publisher, language, published, isbn, format,
    file_name, original_name, file_size, file_hash, page_count, cover_file, cover_state,
    cover_updated_at, favorite, added_at, updated_at, source_provider, source_id, volume_no
FROM books;

DROP TABLE books;
ALTER TABLE books_new RENAME TO books;

CREATE INDEX books_sort_title ON books (sort_title);
CREATE INDEX books_added_at   ON books (added_at);
CREATE UNIQUE INDEX books_source ON books (source_provider, source_id)
    WHERE source_provider IS NOT NULL;
CREATE UNIQUE INDEX books_volume_no ON books (volume_no);
