# stockline

Keeps PrestaShop stock in sync with a warehouse system. Warehouse is the source of truth for what's physically on the shelf, PrestaShop takes the orders. Without something in between the shop keeps selling stuff that's already gone, and quantities people edit by hand in the back office drift away over time.

Next.js 14 + TypeScript, Firestore (firebase-admin) for the sync state, PrestaShop Webservice API.

## the idea

Per SKU (product or combination reference) we keep:

- `stock` - on hand, last number from the warehouse
- `reserved` - qty in shop orders the warehouse hasn't shipped yet

and PrestaShop gets `stock - reserved`.

Reserved is needed because the warehouse count only drops when the order is actually picked. Between "customer paid" and "parcel left" the item is still on the shelf but it's sold.

## flow

**warehouse -> prestashop.** Warehouse POSTs absolute counts with a version to `/api/warehouse/sync`:

```json
{ "updates": [{ "sku": "MUG-01", "onHand": 12, "version": 1042 }] }
```

Absolute numbers, not deltas, so if a message gets lost the next one fixes it. Older/duplicate versions are ignored (retries come out of order). Changed SKUs get pushed to the shop right away.

**shop orders -> reservations.** `/api/cron/prestashop` runs every few minutes, reads orders by `date_upd` since the last cursor. For each order the last seen state is stored and reservation only changes when the order moves between a state that holds stock (awaiting payment, paid, processing, backorder) and one that doesn't (shipped, delivered, cancelled, refunded). Reading the same order twice does nothing, which matters because the date filter is inclusive. Shops with custom states set `PS_RESERVING_STATES`.

**drift.** `/api/cron/reconcile` (nightly) compares what PS shows vs what we pushed last and overwrites hand edits, plus writes an alert so someone can check why.

## prestashop annoyances

- reads work with `output_format=JSON` but writes only take XML, so updating stock = GET xml, change `<quantity>`, PUT it back
- empty lists come back as `[]` instead of `{"orders": []}`
- dates are shop local time without timezone (`PS_TIMEZONE`)
- shared hosting throws random 5xx under load, requests retry with backoff. If a push still fails the product stays "waiting for push" and the next cron picks it up
- products are matched by reference, "Re-map products" (or `npm run map`) links SKUs to `stock_availables` ids incl. combinations

Webservice key needs GET on orders, products, combinations, stock_availables and PUT on stock_availables.

## dashboard

`/` behind basic auth. All SKUs with on hand / in open orders / what the shop should show / what we pushed, filter for problems, alerts (oversold, failed pushes), recent orders, sync log. Buttons to import orders now, check drift, re-map, push one SKU.

## run

```
npm install
cp .env.example .env.local      # PS url + webservice key
firebase emulators:start --only firestore --project demo-stockline
npm run map
npm run dev
```

trigger the cron by hand:

```
curl -X POST localhost:3000/api/cron/prestashop -H "authorization: Bearer change-me"
```

## tests

`npm test` - reservation state changes, stale warehouse updates, the xml round trip, and the webservice client against a small fake prestashop server (auth, filters, retries, the `[]` thing).

## todo

- small PS module that calls a webhook on `actionOrderStatusPostUpdate` instead of polling
- several shops on one warehouse
