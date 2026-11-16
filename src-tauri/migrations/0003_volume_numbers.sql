-- Permanent collector's numbers ("No. 042"): assigned on import in order of
-- acquisition and never reused, so a volume keeps its number forever.
ALTER TABLE books ADD COLUMN volume_no INTEGER;
UPDATE books SET volume_no = (
    SELECT COUNT(*) FROM books b2
    WHERE b2.added_at < books.added_at
       OR (b2.added_at = books.added_at AND b2.rowid <= books.rowid)
);
CREATE UNIQUE INDEX books_volume_no ON books (volume_no);
CREATE TABLE app_counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
INSERT INTO app_counters (name, value) SELECT 'volume_no', COALESCE(MAX(volume_no), 0) FROM books;
