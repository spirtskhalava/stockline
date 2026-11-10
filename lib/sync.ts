import { FieldValue } from "firebase-admin/firestore";
import { db } from "./firebaseAdmin";
import { available, needsPush, reservationDelta } from "./inventory";
import { psDate, type PrestaShop } from "./prestashop";
import type { Product, ShopOrder } from "./types";

const products = () => db.collection("products");
const meta = () => db.collection("meta").doc("prestashop");

const toProduct = (d: FirebaseFirestore.DocumentSnapshot) => ({ sku: d.id, ...(d.data() as Omit<Product, "sku">) });

async function alert(type: string, data: Record<string, unknown>) {
  await db.collection("alerts").add({ type, ...data, at: FieldValue.serverTimestamp() });
}

/**
 * Applies one PrestaShop order to reservations. The order doc remembers the
 * last state we saw, so re-reading the same order (the date filter is
 * inclusive, crons overlap) never counts it twice.
 */
export async function applyOrder(order: ShopOrder): Promise<string[]> {
  const ref = db.collection("orders").doc(String(order.id));

  return db.runTransaction(async (tx) => {
    const prev = await tx.get(ref);
    const prevState = prev.exists ? (prev.get("state") as number) : undefined;
    if (prevState === order.state) return [];

    const delta = reservationDelta(prevState, order.state, order.lines);
    const skus = [...delta.keys()];
    const snaps = skus.length ? await tx.getAll(...skus.map((s) => products().doc(s))) : [];

    const touched: string[] = [];
    const unknown: string[] = [];
    snaps.forEach((s, i) => {
      if (!s.exists) return unknown.push(skus[i]);
      tx.update(s.ref, { reserved: FieldValue.increment(delta.get(skus[i])!) });
      touched.push(skus[i]);
    });

    tx.set(ref, {
      reference: order.reference,
      state: order.state,
      lines: order.lines,
      updatedAt: order.updatedAt,
      ...(unknown.length ? { unknownSkus: unknown } : {}),
      seenAt: Date.now(),
    });
    return touched;
  });
}

/** Pulls orders changed since the last run. Returns SKUs whose reservation changed. */
export async function importOrders(ps: PrestaShop) {
  const cursor = (await meta().get()).get("ordersCursor") as string | undefined;
  const since = cursor ?? psDate(new Date(Date.now() - 24 * 3600_000));

  const orders = await ps.ordersUpdatedSince(since);
  const touched = new Set<string>();
  for (const o of orders) {
    (await applyOrder(o)).forEach((s) => touched.add(s));
    if (o.lines.length === 0) await alert("order-without-skus", { orderId: o.id, reference: o.reference });
  }

  if (orders.length) await meta().set({ ordersCursor: orders[orders.length - 1].updatedAt }, { merge: true });
  return { fetched: orders.length, touched: [...touched] };
}

/**
 * Writes `stock - reserved` to PrestaShop for products whose shop number would change.
 * One failing product doesn't stop the others; it stays "needs push" and the next run retries it.
 */
export async function pushStock(ps: PrestaShop, skus?: string[]) {
  const snaps = skus?.length
    ? (await db.getAll(...skus.map((s) => products().doc(s)))).filter((s) => s.exists)
    : (await products().get()).docs;

  const pushed: string[] = [];
  const failed: Array<{ sku: string; error: string }> = [];

  for (const p of snaps.map(toProduct).filter(needsPush)) {
    const qty = available(p);
    try {
      await ps.setQuantity(p.psStockAvailableId!, qty);
      await products().doc(p.sku).update({ lastPushedQty: qty, pushedAt: Date.now() });
      pushed.push(p.sku);
    } catch (e) {
      failed.push({ sku: p.sku, error: (e as Error).message });
    }
  }
  if (failed.length) await alert("push-failed", { failed });
  return { pushed, failed };
}

/**
 * Someone edited quantities by hand in the PrestaShop back office, or a module
 * changed them. Finds products where the shop disagrees with what we pushed.
 */
export async function findDrift(ps: PrestaShop) {
  const [stock, snap] = await Promise.all([ps.stockAvailables(), products().get()]);
  const byId = new Map(stock.map((s) => [s.id, s.quantity]));
  return snap.docs
    .map(toProduct)
    .filter((p) => p.psStockAvailableId !== undefined && p.lastPushedQty !== undefined)
    .map((p) => ({ sku: p.sku, expected: p.lastPushedQty!, inShop: byId.get(p.psStockAvailableId!) }))
    .filter((d) => d.inShop !== undefined && d.inShop !== d.expected);
}

/** Forgets lastPushedQty for drifted products so the next push overwrites the shop value. */
export async function reconcile(ps: PrestaShop) {
  const drift = await findDrift(ps);
  if (drift.length) {
    const batch = db.batch();
    drift.forEach((d) => batch.update(products().doc(d.sku), { lastPushedQty: FieldValue.delete() }));
    await batch.commit();
    await alert("drift", { items: drift });
  }
  const result = await pushStock(ps, drift.map((d) => d.sku));
  return { drift, ...result };
}

/**
 * Links Firestore products to PrestaShop by reference (combination reference
 * for products with variants). New references are created with the shop's
 * current quantity until the warehouse sends a real number.
 */
export async function mapProducts(ps: PrestaShop) {
  const [{ products: psProducts, combinations }, stock] = await Promise.all([ps.references(), ps.stockAvailables()]);
  const stockId = new Map(stock.map((s) => [`${s.productId}:${s.attributeId}`, s]));
  const names = new Map(psProducts.map((p) => [p.id, p.name]));

  const targets = [
    ...psProducts.filter((p) => p.reference).map((p) => ({ sku: p.reference.trim(), productId: p.id, attributeId: 0, name: p.name })),
    ...combinations.filter((c) => c.reference).map((c) => ({
      sku: c.reference.trim(), productId: c.productId, attributeId: c.id, name: names.get(c.productId) ?? c.reference,
    })),
  ];

  const existing = new Set((await products().select().get()).docs.map((d) => d.id));
  let linked = 0, created = 0;
  const batch = db.batch();

  for (const t of targets) {
    const s = stockId.get(`${t.productId}:${t.attributeId}`);
    if (!s) continue;
    const link = { psProductId: t.productId, psAttributeId: t.attributeId, psStockAvailableId: s.id, name: t.name };
    if (existing.has(t.sku)) {
      batch.update(products().doc(t.sku), link);
      linked++;
    } else {
      batch.set(products().doc(t.sku), { ...link, stock: s.quantity, reserved: 0, warehouseVersion: 0, lastPushedQty: s.quantity });
      created++;
    }
  }
  await batch.commit();
  return { linked, created, skipped: targets.length - linked - created };
}
