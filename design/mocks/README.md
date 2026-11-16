# Design directions: "reading as a collection and a community"

> **Chosen: C, "Index"**, now implemented in the app. The reader deliberately departs from it with a calm, low-contrast design for long sessions.

Three visual directions for the home screen. All three show the **same content and features**, so the comparison is purely about look and feel. Open the `.html` files in a browser (designed at 1440×900), or see `screens/`.

| | Direction | Inspired by | Personality |
|---|---|---|---|
| **A** | [The Shelf](a-shelf.html) | Cream "Books" concept | Warm, tactile, editorial. Books are physical objects standing on a real ledge. Fraunces serif + Inter, ochre accent. |
| **B** | [The Reading Room](b-reading-room.html) | Dark teal dashboard | Calm, dense, organized. A night-mode study where everything has a place. Plus Jakarta Sans, butter-yellow accent. |
| **C** | [Index](c-index.html) | Pitch-deck template | Bold, Swiss, kinetic. Your collection as data and identity: huge numerals, numbered sections, fanned 3D cards. Archivo + JetBrains Mono, red-orange on black and white. |

## The concept (shared by every direction)

### Collection: books as things you own and keep
- **Numbered volumes.** Every book gets a collector's number in the order you acquired it ("No. 042"). Your library becomes a catalogue with a history.
- **Sets.** Author canons, series and curated sets ("The Austen Six", "Holmes canon", "Gothic essentials") with empty slots waiting to be filled. A free book is always one click away from completing one.
- **Stamps.** Finishing a book stamps it, like a passport, instead of just ticking a checkbox.
- **Collection stats** as identity, not homework: volumes, authors, pages, years of literature spanned.

### Community: reading alone, together
- **Circles.** Small groups read the same book on a schedule. A **shared progress track** shows where everyone is, and notes are anchored to chapters, so you only see discussion up to your own position (spoiler-safe by design).
- **Most-highlighted passages** across all readers, saved with one tap.
- **Presence.** "Mara, Tomás and 1,282 others are reading this week."
- **Bookseller and curator shelves.** Indie bookstores share shelves into your feed (see [STOREFRONT.md](../../docs/STOREFRONT.md)). This is where community and the future store meet.

## Notes
- **Covers** are public-domain Project Gutenberg editions. Fonts are open-licensed (SIL OFL) via Fontsource; licenses are in `assets/fonts/`.
- **"Folio" is a working name.**
- **People and activity in the mocks are fictional.** Circles, presence and feeds need the backend described in STOREFRONT.md; collection features (numbering, sets, stamps, stats) can ship locally first.
