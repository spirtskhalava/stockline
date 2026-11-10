import { NextResponse } from "next/server";
import { hasBearer } from "@/lib/auth";
import { PrestaShop } from "@/lib/prestashop";
import { reconcile } from "@/lib/sync";

export const runtime = "nodejs";
export const maxDuration = 120;

// Nightly: catch quantities changed by hand in the PrestaShop back office.
export async function POST(req: Request) {
  if (!hasBearer(req.headers.get("authorization"), process.env.CRON_TOKEN)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await reconcile(PrestaShop.fromEnv()));
}
