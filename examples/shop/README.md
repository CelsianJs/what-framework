# What Shop — full-stack store example

A commerce + dashboard app showing the full What Framework full-stack story:

- **ISR storefront** (`/`) — `mode:'static'`, `revalidate:60`, `tags:['products']`.
  Served from the origin cache, regenerated in the background (stale-while-revalidate).
- **Dynamic product pages** (`/product/[id]`) — `loader` + `getStaticPaths`
  (`fallback:'blocking'`) + per-product `<Head>`.
- **Server dashboard** (`/dashboard`) — `mode:'server'`: rendered fresh per
  request, `Cache-Control: private, no-store`, with a (demo) auth gate in the loader.
- **Cart actions** (`src/actions/cart.js`) — `addToCart`/`removeFromCart` served at
  `/__what_action`, each calling `revalidateTag('products')` + `revalidatePath('/')`
  so the cached storefront and product pages regenerate after a mutation.

Origin-first: works on any host with no CDN. Add a CDN and the engine fans
purges out to it for edge ISR.

## Run

```bash
node server.js          # http://localhost:3000
# or, from a scaffold:  npm start  /  what start
```

## Try the loop

```bash
curl -i localhost:3000/                       # X-What-Cache: MISS, then HIT
curl -i localhost:3000/product/tee            # MISS -> HIT, s-maxage=60
curl -i localhost:3000/dashboard              # private, no-store; "Not authorized"
curl -i -H 'x-demo-admin: 1' localhost:3000/dashboard   # the admin view
curl -X POST localhost:3000/__what_action \
  -H 'x-what-action: addToCart' -H 'content-type: application/json' \
  -d '{"args":[{"id":"mug"}]}'                # revalidates products -> grid MISS next
curl -X POST localhost:3000/__what_revalidate \
  -H 'content-type: application/json' \
  -d '{"tags":["products"],"secret":"dev-secret"}'   # CMS/webhook purge
```

See `test/shop.e2e.test.js` for the end-to-end proof of all of the above.
