# The store

Songs and packs, sold by artists and creators who applied and were let
in. Same Supabase project and accounts as the rest of the site.

| address                    | what                                                   |
|----------------------------|--------------------------------------------------------|
| `/store/`                  | the shelf: new releases, top songs, a row per creator  |
| `/store/item?p=<song>`     | a song; `&v=<version>` picks a creator's version       |
| `/store/creator?c=<slug>`  | one maker's titles                                     |
| `/store/creators`          | apply to sell                                          |
| `/store/library`           | what the signed-in account has; Open in PerformLive    |
| `/store/dashboard`         | a creator's songs, sales, review notes                 |
| `/store/new`               | add a song: details, cover, ten tracks, sections, price|
| `/portal/admin-store.html` | the studio: applications, songs in review, the shelf   |

## Pieces

- `supabase-store.sql` — tables, row-level security, the review and
  purchase functions, and the three artists seeded as coming soon.
- `worker.js` → `storeRoutes` — uploads into R2, the manifest for
  PerformLive, ticketed track downloads, cover art.
- `supabase/functions/create-store-checkout` — rent (14 days) or buy
  through Stripe; `stripe-webhook` records it with `record_store_sale`.
- `store/store.js` — the pages. `store/upload.js` — the creator's
  upload page.
- `docs/performlive-store-integration.md` — the handover for the app.

## Going live

The pages are `noindex` and unlinked from the rest of the site. Once
the SQL has run and the two functions are deployed, the store works at
its address; linking it from the rack and dropping `noindex` is the
launch.
