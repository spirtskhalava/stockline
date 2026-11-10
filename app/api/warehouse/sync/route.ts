import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { hasBearer } from "@/lib/auth";
import { db } from "@/lib/firebaseAdmin";
import { applyWarehouseUpdate } from "@/lib/inventory";
import { PrestaShop } from "@/lib/prestashop";
import { pushStock } from "@/lib/sync";
import type { Product, WarehouseUpdate } from "@/lib/types";

export const runtime = "nodejs";

/**
 * The warehouse system pushes stock changes here:
 *   POST { "updates": [{ "sku": "MUG-01", "onHand": 12, "version": 1042 }] }
 * Each SKU is updated in its own transaction so one bad line doesn't block the rest,
 * then the changed SKUs are pushed to PrestaShop.
 */
export async function POST(req: Request) {
  if (!hasBearer(req.headers.get("authorization"), process.env.WAREHOUSE_SYNC_TOKEN)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { updates?: WarehouseUpdate[] } | null;
  const updates = (body?.updates ?? []).filter(
    (u) => typeof u?.sku === "string" && Number.isFinite(u.onHand) && Number.isFinite(u.version),
  );
  if (!updates.length) return NextResponse.json({ error: "No valid updates" }, { status: 400 });

  const results = await Promise.all(
    updates.map((u) =>
      db.runTransaction(async (tx) => {
        const ref = db.collection("products").doc(u.sku);
        const snap = await tx.get(ref);
        const current = snap.exists ? ({ sku: snap.id, ...snap.data() } as Product) : undefined;
        const res = applyWarehouseUpdate(current, u);
        if (res.action === "update") {
          tx.update(ref, { stock: res.stock, warehouseVersion: u.version, syncedAt: Date.now() });
          if (res.oversold > 0) {
            tx.set(db.collection("alerts").doc(), {
              type: "oversold", sku: u.sku, oversold: res.oversold, at: FieldValue.serverTimestamp(),
            });
          }
        }
        return { sku: u.sku, ...res };
      }),
    ),
  );

  const changed = results.filter((r) => r.action === "update").map((r) => r.sku);
  // the warehouse shouldn't fail because the shop is slow - push errors are logged and retried by cron
  const push = changed.length ? await pushStock(PrestaShop.fromEnv(), changed).catch((e) => ({ error: String(e) })) : null;

  await db.collection("syncLog").add({
    at: Date.now(),
    source: "warehouse",
    received: updates.length,
    updated: changed.length,
    skipped: results.filter((r) => r.action === "skip").map((r) => r.sku),
  });

  return NextResponse.json({ results, push });
}
