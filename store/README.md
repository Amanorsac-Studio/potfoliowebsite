# The store (test build)

Everything under `/store/` is the marketplace: packs of multitracks,
stems, pads, loops, PerformLive templates, clicks and charts, sold by
artists and creators who applied and were let in.

**It is not live.** This folder ships on the working branch only, every
page is `noindex`, and an amber ribbon on every page says so. Nothing
here is linked from the rest of the site.

## Looking at it

Any Workers preview build of the branch serves it at
`https://<version>-potfoliowebsite.<subdomain>.workers.dev/store/`.
Locally, any static server that maps `/store/item` to `store/item.html`
will do.

Pages:

| address                        | what                                                     |
|--------------------------------|----------------------------------------------------------|
| `/store/`                      | shelf: hero, lanes, featured, artists, new, creators     |
| `/store/?q=…` `/store/?lane=…` | search and lane filters                                  |
| `/store/item?p=<slug>`         | a pack: cover, preview, contents, buy                    |
| `/store/creator?c=<slug>`      | an artist or creator and their packs                     |
| `/store/creators`              | the pitch and the application form                       |
| `/store/library`               | what the signed-in account owns                          |
| `/store/success` `/cancelled`  | after checkout                                           |
| `/store/dashboard`             | creator dashboard shell: sales, packs, payouts           |

## Where the data is

`fixture.json`. Three artists (Kingsley Anyenor, Viivi Adjei, Isaac
Narh, with their YouTube links) and five creators (Kwame Asante,
Akosua Mensah, Chinedu Okafor, Ama Serwaa Boateng, Thabo Mokoena).
Every pack title is generic on purpose - no song titles were invented
for anyone. Edit the file and the pages follow.

## One backend

Same Supabase project, same accounts, same `purchases` table the apps
use. `store.js` has two adapters with the same function names:
`fromFixture` (today) and `live` (when the tables exist). `TEST` at the
top of the file is the only switch. Flipping it also removes the
ribbon and turns "Buy" into a real call to `create-store-checkout`.

Creators are ordinary accounts that applied on `/store/creators` and
were approved. What the form asks for is a first shape; the real
requirements are still to come and the fields can change freely -
`store.js` sends whatever the form contains.

## Before it goes live

- tables: `store_creators`, `store_items`, `creator_applications`
  (shape in the comment above `live` in `store.js`), plus RLS
- functions: `create-store-checkout`, `store-download`
- pack files in R2 under a `store/` prefix; covers as real images
- `TEST = false`, remove `noindex`, link it from the site, add the
  pages to the Worker's sitemap list
- artists asked, and named only with their say-so
