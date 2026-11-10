import { NextResponse } from "next/server";
import { hasBearer } from "@/lib/auth";
import { db } from "@/lib/firebaseAdmin";
import { PrestaShop } from "@/lib/prestashop";
import { importOrders, pushStock } from "@/lib/sync";

export const runtime = "nodejs";
export const maxDuration = 60;

// Every 2-5 minutes from Cloud Scheduler: new/changed shop orders -> reservations -> push.
// A full push without SKUs also retries anything that failed earlier.
export async function POST(req: Request) {
  if (!hasBearer(req.headers.get("authorization"), process.env.CRON_TOKEN)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ps = PrestaShop.fromEnv();
  const orders = await importOrders(ps);
  const push = await pushStock(ps);

  await db.collection("syncLog").add({
    at: Date.now(),
    source: "prestashop",
    received: orders.fetched,
    updated: push.pushed.length,
    skipped: push.failed.map((f) => f.sku),
  });
  return NextResponse.json({ orders, push });
}
