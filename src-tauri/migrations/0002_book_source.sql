-- Where a book came from when acquired through a catalog (NULL for user imports).
ALTER TABLE books ADD COLUMN source_provider TEXT;
ALTER TABLE books ADD COLUMN source_id TEXT;
CREATE UNIQUE INDEX books_source ON books (source_provider, source_id)
    WHERE source_provider IS NOT NULL;
