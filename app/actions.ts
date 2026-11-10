"use server";

import { revalidatePath } from "next/cache";
import { PrestaShop } from "@/lib/prestashop";
import { importOrders, mapProducts, pushStock, reconcile } from "@/lib/sync";

// Buttons on the dashboard. Each returns a short human-readable result.

export async function runOrderImport() {
  const ps = PrestaShop.fromEnv();
  const orders = await importOrders(ps);
  const push = await pushStock(ps, orders.touched);
  revalidatePath("/");
  return `${orders.fetched} orders checked, ${push.pushed.length} products pushed`;
}

export async function runMapping() {
  const r = await mapProducts(PrestaShop.fromEnv());
  revalidatePath("/");
  return `${r.linked} linked, ${r.created} new, ${r.skipped} without stock record`;
}

export async function runReconcile() {
  const r = await reconcile(PrestaShop.fromEnv());
  revalidatePath("/");
  return r.drift.length ? `${r.drift.length} drifted, ${r.pushed.length} fixed` : "PrestaShop matches, nothing to fix";
}

export async function pushOne(sku: string) {
  const r = await pushStock(PrestaShop.fromEnv(), [sku]);
  revalidatePath("/");
  return r.failed[0]?.error ?? (r.pushed.length ? "pushed" : "already up to date");
}
