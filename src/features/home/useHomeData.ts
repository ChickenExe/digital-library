import { useCallback, useEffect, useState } from "react";
import type { Book } from "../../bindings/Book";
import type { CollectionSet } from "../../bindings/CollectionSet";
import { api, events } from "../../lib/api";

export type HomeData = {
  latest: Book[];
  readingNow: Book | null;
  sets: CollectionSet[];
};

/** Everything the Home screen shows, refreshed whenever the library changes. */
export function useHomeData(): HomeData | null {
  const [data, setData] = useState<HomeData | null>(null);

  const load = useCallback(async () => {
    // Only fetch what Home shows, not the whole library.
    const [latest, reading, sets] = await Promise.all([
      api.listBooks({ shelf: "all", sort: "recent", limit: 7 }),
      api.listBooks({ shelf: "reading", sort: "lastRead", limit: 1 }),
      api.collectionSets(),
    ]);
    setData({ latest, readingNow: reading[0] ?? null, sets });
  }, []);

  useEffect(() => {
    void load();
    const off = events.onLibraryChanged(() => void load());
    return () => void off.then((f) => f());
  }, [load]);

  return data;
}

/** The set worth nudging: most progress without being complete. */
export function pickNextSet(sets: CollectionSet[]): CollectionSet | null {
  const open = sets.filter((s) => s.owned < s.total);
  if (!open.length) return null;
  return [...open].sort((a, b) => b.owned / b.total - a.owned / a.total || b.owned - a.owned)[0];
}
