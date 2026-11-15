-- catalog.db: a local, rebuildable index of remote catalogs (a cache, not user data).
CREATE TABLE entries (
    rowid             INTEGER PRIMARY KEY,
    provider          TEXT NOT NULL,              -- e.g. 'gutenberg'
    source_id         TEXT NOT NULL,              -- the provider's id for the work
    title             TEXT NOT NULL,
    authors           TEXT NOT NULL DEFAULT '[]', -- JSON array, display order
    language          TEXT,                       -- primary ISO 639-1 code
    issued            TEXT,
    subjects          TEXT NOT NULL DEFAULT '[]', -- JSON array
    categories        TEXT NOT NULL DEFAULT '[]', -- JSON array of curated categories
    popularity        INTEGER,                    -- 1 = most downloaded; NULL = unranked
    downloads         INTEGER,
    summary           TEXT,
    reading_level     TEXT,
    detail_fetched_at INTEGER,
    UNIQUE (provider, source_id)
);

CREATE INDEX entries_popularity ON entries (popularity) WHERE popularity IS NOT NULL;

CREATE TABLE entry_categories (
    category    TEXT    NOT NULL,
    entry_rowid INTEGER NOT NULL REFERENCES entries (rowid) ON DELETE CASCADE,
    PRIMARY KEY (category, entry_rowid)
) WITHOUT ROWID;

-- External-content FTS index over `entries`; rebuilt after each bulk sync.
CREATE VIRTUAL TABLE entries_fts USING fts5 (
    title,
    authors,
    subjects,
    content = 'entries',
    content_rowid = 'rowid',
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE sync_state (
    provider      TEXT PRIMARY KEY,
    synced_at     INTEGER NOT NULL,
    last_modified TEXT
);
