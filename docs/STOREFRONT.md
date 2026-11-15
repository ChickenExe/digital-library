# Becoming the storefront

**Goal:** become a place where publishers, authors and booksellers *choose* to sell ebooks. We don't link out to Amazon or Apple; we are the retailer.

Today the app has a free catalog (Project Gutenberg) and the plumbing a store needs: listings, offers, acquisition, entitlements via the library. This doc covers why sellers would come, what we'd build to earn them, and what that means technically.

> Industry figures below are the commonly published terms at the time of writing. Verify current terms before putting them in a pitch.

---

## 1. Who we're courting, and what frustrates them today

| Seller | What they put up with today |
|---|---|
| **Indie authors & small presses** | ~30–65% of every sale goes to the retailer. On Amazon KDP, the 70% royalty applies only between $2.99 and $9.99 (and has a delivery fee); outside that band it's 35%. KDP Select's perks require ebook exclusivity. The buyer belongs to the retailer, not the author. Discovery is an opaque algorithm plus paid ads. |
| **Mid-size publishers** | Very little reader data beyond sales counts. No control over how books are presented. Paying separately for review-copy tools (NetGalley), launch pages, newsletters and analytics. |
| **Indie bookstores** | Effectively locked out of ebooks: a customer who reads digitally buys from a big retailer. Models that give stores a cut of digital sales (Bookshop.org for print, Libro.fm for audiobooks) are popular, but there's no strong ebook equivalent with a great reading app attached. |

The opening: **better economics + owning the reader relationship + presentation nobody else offers + a real role for booksellers.**

---

## 2. What we offer sellers

### A. Better economics
- **85/15 split by default**, and **90/10 on sales the seller drives themselves** through their own link, newsletter or social post. Bandcamp's model works the same way and is loved for it.
- **No price bands, no exclusivity.** The seller sets the price (agency model), including $0.99 or $14.99, without being penalised.
- **Fast, transparent payouts:** weekly, with a live dashboard and no reserve games.

### B. Sellers own their readers
- **Follow** a publisher or author. New releases, pre-orders and sales appear in the reader's Discover feed, and launches can notify followers in the app.
- **Opt-in buyer contact.** At checkout, a reader can choose to share their email with the publisher, on the reader's terms, never by default.
- **Direct links** that drop a reader straight onto a book's page, with attribution so the 90/10 rate applies.

### C. Presentation as a product (our differentiator)
This is where "prettier than everyone" turns into a business advantage.
- **Art-directed product pages.** Publishers control the hero art, palette (auto-derived from the cover unless overridden), typography accents, a trailer or author video, and pull quotes.
- **Read the first chapter inline.** The sample opens in our reader, and "Buy" carries on from the same page.
- **Editions.** Standard, illustrated and collector's editions (art, maps, annotations, author commentary) at different prices. Digital "deluxe" editions are an untapped market.
- **Series and universe pages** with reading-order guides. These are big for fantasy and romance.
- **Launch pages:** countdown, pre-order and a launch-day notification to followers.

### D. Insight without surveillance
- **Aggregated reading analytics:** completion rate, where readers stop, sample-to-purchase conversion, and series read-through ("62% of book 1 finishers buy book 2"). No major retailer gives publishers this.
- **Privacy by design.** Readers opt in. Data is only shown above minimum cohort sizes, with no individual-level tracking and no data sold. This is a *selling point to readers* too.

### E. Fair discovery
- **Editorial curation first:** staff picks, themed shelves and bookseller shelves (see F).
- **Transparent ranking.** Every paid placement is clearly labelled, and basic visibility never needs ad spend.

### F. Booksellers as curators: shop-in-shop
- **Every indie bookstore gets a branded storefront** inside the app: their logo, staff picks, event tie-ins and local reading-group shelves.
- **"My bookstore."** A reader picks a home bookstore, and that store earns a share of *every* ebook the reader buys (the Libro.fm model, applied to ebooks).
- **Curator shelves** for book clubs, BookTok and Bookstagram creators, earning an affiliate share on sales they drive.
- The pitch to booksellers: *"Your customers who read digitally stop being lost to Amazon."* Booksellers then promote the app to their customers, which helps solve our audience problem.

### G. Flexible commerce
Pre-orders, bundles (a series, or ebook + audiobook later), pay-what-you-want above a minimum, limited-time free, gift copies, and **crowdfunded launches** with reward tiers. Kickstarter has proven readers will fund special editions.

### H. Tools publishers already pay for, built in
- **Review copies (ARCs):** reviewers request a copy, the publisher approves, and a watermarked file is delivered and tracked. This replaces a separate NetGalley subscription.
- **Accessibility checks on upload.** The European Accessibility Act (applying since June 2025) requires accessible ebooks in the EU. Built-in EPUB accessibility validation is a concrete compliance draw.

### I. DRM is the seller's choice
- **Recommended default: DRM-free with social watermarking** (buyer info embedded in the file). Many publishers already sell this way.
- **Optional: Readium LCP,** the open, lightweight DRM standard (it needs EDRLab certification). No dependency on Adobe's ecosystem.

### J. Effortless onboarding
- **Direct upload:** EPUB plus a metadata form for authors, or ONIX 3.0 feeds for publishers (the industry-standard metadata format).
- **Become a sales channel in the aggregators** (Draft2Digital, PublishDrive, StreetLib, Ingram CoreSource). Thousands of publishers can then tick a box to list with us, which gives us catalog depth without one-by-one deals.

---

## 3. How we make money
1. **Commission:** 15%, or 10% on seller-driven sales.
2. **Publisher Pro subscription:** deep analytics, ARC campaigns, launch pages, A/B-tested covers and copy.
3. **Clearly labelled promoted placements** on Discover, capped per page.

Never selling reader data.

---

## 4. Go-to-market: solving the chicken-and-egg

| Phase | Readers | Sellers |
|---|---|---|
| **0 (now)** | Free classics + a beautiful reader = a reason to install | — |
| **1** | Genre community launch (romantasy and fantasy have the most engaged online readership) | 20–50 hand-picked indie authors and micro-presses at 90/10, with white-glove product pages |
| **2** | "My bookstore" picks; bookstores promote us locally | Indie bookstore shop-in-shops; aggregator channel integrations for catalog depth |
| **3** | Social features: shelves, follows, reading groups | Mid-size publishers: ARC tooling, analytics, ONIX feeds |

Big Five publishers come last, if ever. The indie long tail is where differentiation matters most and deals are fastest.

---

## 5. What has to be built

The desktop app is a client. A store needs a backend:

```
            ┌────────────── Desktop app (Tauri) ──────────────┐
            │ Discover ─ providers: gutenberg | store          │
            │ Checkout (webview → payment page) → entitlement  │
            │ Library ← downloads (signed URLs, watermarked)    │
            └───────────────▲───────────────┬──────────────────┘
                            │ HTTPS API      │
┌───────────────────────────┴───────────────▼─────────────────────────────┐
│ Store API                                                               │
│  accounts & auth · catalog/listings · search · follows · reviews        │
│  orders → entitlements (license per user per edition)                   │
│  delivery: signed CDN URLs + per-buyer watermarking pipeline            │
│  analytics: opt-in event ingest → aggregated cohorts (k-anonymity)      │
├─────────────────────────────────────────────────────────────────────────┤
│ Payments: merchant of record (handles EU VAT/US sales tax on ebooks)    │
│ Payouts: marketplace payouts with split rules (publisher / bookseller)  │
├─────────────────────────────────────────────────────────────────────────┤
│ Publisher portal (web): upload EPUB/ONIX, EPUBCheck + accessibility,    │
│  territorial rights, pricing, editions, launch pages, ARC campaigns     │
└─────────────────────────────────────────────────────────────────────────┘
```

What's already in place in the app:
- Every catalog entry carries a **`provider`**, so a first-party store is a second provider next to `gutenberg`.
- Listings carry an **`Offer`** (`{ kind: "free" }` today). Paid becomes `{ kind: "paid", price, currency }`, and the Get button turns into Buy.
- **Acquisition** already ends in the standard import pipeline and is recorded via `source_provider`/`source_id`. Purchased books land in the library the same way free ones do.

---

## 6. Risks and honest notes
- **Two-sided cold start** is the hardest part. Phases 0–1 must make the reading app worth installing on its own.
- **Payments and tax** are non-trivial. A merchant of record avoids registering for VAT in every country.
- **Rights management.** Territorial rights, takedowns and piracy reports need process and tooling from day one.
- **Mobile.** People often buy on phones. A desktop-first portfolio piece is fine, but a real store probably needs at least a web storefront. Tauri 2 can also target iOS and Android, so the UI investment carries over.

## 7. Open questions
1. Which genre do we launch around first?
2. Indie authors first, or small presses first? This changes the onboarding flow (single upload vs. ONIX).
3. Is the long-term goal a real company, or a portfolio piece that demonstrates the full vision? This decides how deep the backend goes.
