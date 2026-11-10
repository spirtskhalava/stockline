import type { OrderLine, Product, WarehouseUpdate } from "./types";

/** What PrestaShop should show: on hand minus what's already sold but not shipped. */
export const available = (p: Pick<Product, "stock" | "reserved">) => Math.max(0, p.stock - p.reserved);

export type SyncResult =
  | { action: "skip"; reason: "stale" | "unknown-sku" }
  | { action: "update"; stock: number; oversold: number };

/**
 * Warehouse sends absolute on-hand counts with a version number.
 * Updates can arrive out of order (retries, parallel workers), so an older
 * version never overwrites a newer one. Absolute numbers instead of deltas
 * mean a lost message fixes itself with the next update.
 */
export function applyWarehouseUpdate(current: Product | undefined, u: WarehouseUpdate): SyncResult {
  if (!current) return { action: "skip", reason: "unknown-sku" };
  if (u.version <= current.warehouseVersion) return { action: "skip", reason: "stale" };
  const stock = Math.max(0, Math.floor(u.onHand));
  const oversold = Math.max(0, current.reserved - stock);
  return { action: "update", stock, oversold };
}

/*
 * PrestaShop default order states. Shops add their own, so this is configurable
 * through PS_RESERVING_STATES. Rule of thumb: an order holds stock while it's
 * paid or waiting for payment, and stops holding it once it's shipped
 * (the warehouse count already went down) or cancelled.
 */
export const DEFAULT_RESERVING_STATES = [
  1, // awaiting check payment
  2, // payment accepted
  3, // processing in progress
  9, // on backorder (not paid)
  10, // awaiting bank wire
  11, // remote payment accepted
  12, // on backorder (paid)
];

export function reservingStates(): Set<number> {
  const env = process.env.PS_RESERVING_STATES;
  const list = env ? env.split(",").map((s) => Number(s.trim())).filter(Number.isFinite) : DEFAULT_RESERVING_STATES;
  return new Set(list);
}

/**
 * How much each SKU's reservation changes when an order moves from one state
 * to another. prevState undefined = we see the order for the first time.
 * Returns only non-zero changes.
 */
export function reservationDelta(
  prevState: number | undefined,
  nextState: number,
  lines: OrderLine[],
  reserving: Set<number> = reservingStates(),
): Map<string, number> {
  const was = prevState !== undefined && reserving.has(prevState);
  const is = reserving.has(nextState);
  const out = new Map<string, number>();
  if (was === is) return out;
  const sign = is ? 1 : -1;
  for (const l of lines) out.set(l.sku, (out.get(l.sku) ?? 0) + sign * l.qty);
  return out;
}

/** Push only when the number PrestaShop shows would actually change. */
export function needsPush(p: Product): boolean {
  return p.psStockAvailableId !== undefined && p.lastPushedQty !== available(p);
}
