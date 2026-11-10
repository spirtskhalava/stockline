import { db } from "@/lib/firebaseAdmin";
import { available, needsPush } from "@/lib/inventory";
import type { Product } from "@/lib/types";
import { pushOne, runMapping, runOrderImport, runReconcile } from "./actions";
import { ActionButton } from "./components/ActionButton";

export const dynamic = "force-dynamic";

const ago = (ms?: number) => {
  if (!ms) return "never";
  const m = Math.round((Date.now() - ms) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`;
};

export default async function Dashboard({ searchParams }: { searchParams: { q?: string; issues?: string } }) {
  const [productsSnap, ordersSnap, logSnap, alertsSnap] = await Promise.all([
    db.collection("products").orderBy("name").get(),
    db.collection("orders").orderBy("seenAt", "desc").limit(15).get(),
    db.collection("syncLog").orderBy("at", "desc").limit(10).get(),
    db.collection("alerts").orderBy("at", "desc").limit(10).get(),
  ]);

  const q = searchParams.q?.toLowerCase() ?? "";
  const all = productsSnap.docs.map((d) => ({ sku: d.id, ...(d.data() as Omit<Product, "sku">) }));
  const issue = (p: Product) => p.reserved > p.stock || needsPush(p) || p.psStockAvailableId === undefined;
  const products = all
    .filter((p) => !q || p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
    .filter((p) => !searchParams.issues || issue(p));

  const unmapped = all.filter((p) => p.psStockAvailableId === undefined).length;
  const pending = all.filter(needsPush).length;
  const oversold = all.filter((p) => p.reserved > p.stock).length;

  return (
    <div className="dash">
      <section className="stats">
        <div><b>{all.length}</b>products</div>
        <div className={pending ? "warn" : ""}><b>{pending}</b>waiting for push</div>
        <div className={oversold ? "bad" : ""}><b>{oversold}</b>oversold</div>
        <div className={unmapped ? "warn" : ""}><b>{unmapped}</b>not in PrestaShop</div>
      </section>

      <section className="actions">
        <ActionButton label="Import orders now" action={runOrderImport} />
        <ActionButton label="Check for drift" action={runReconcile} />
        <ActionButton label="Re-map products" action={runMapping} />
      </section>

      <form className="filters">
        <input name="q" placeholder="SKU or name" defaultValue={searchParams.q} />
        <label><input type="checkbox" name="issues" value="1" defaultChecked={!!searchParams.issues} /> only problems</label>
        <button>Filter</button>
      </form>

      <table>
        <thead>
          <tr><th>SKU</th><th>Name</th><th>On hand</th><th>In open orders</th><th>Shop should show</th><th>Shop shows</th><th>Warehouse sync</th><th /></tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.sku} className={p.reserved > p.stock ? "bad" : needsPush(p) ? "warn" : ""}>
              <td><code>{p.sku}</code></td>
              <td>{p.name}</td>
              <td>{p.stock}</td>
              <td>{p.reserved}</td>
              <td>{available(p)}</td>
              <td>{p.psStockAvailableId === undefined ? <i>not mapped</i> : p.lastPushedQty ?? "?"}</td>
              <td>{ago((p as Product & { syncedAt?: number }).syncedAt)}</td>
              <td>{needsPush(p) && <ActionButton label="Push" action={pushOne.bind(null, p.sku)} />}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="cols">
        <section>
          <h2>Recent shop orders</h2>
          <ul>
            {ordersSnap.docs.map((d) => (
              <li key={d.id}>
                #{d.id} {d.get("reference")} · state {d.get("state")} ·{" "}
                {(d.get("lines") as Array<{ sku: string; qty: number }>).map((l) => `${l.sku}×${l.qty}`).join(", ")}
                {d.get("unknownSkus") && <span className="bad"> · unknown: {d.get("unknownSkus").join(", ")}</span>}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2>Sync log</h2>
          <ul>
            {logSnap.docs.map((d) => (
              <li key={d.id}>
                {ago(d.get("at"))} · {d.get("source")} · {d.get("received")} in, {d.get("updated")} updated
                {d.get("skipped")?.length > 0 && <span className="warn"> · skipped {d.get("skipped").join(", ")}</span>}
              </li>
            ))}
          </ul>
          {alertsSnap.size > 0 && (
            <>
              <h2>Alerts</h2>
              <ul>
                {alertsSnap.docs.map((d) => (
                  <li key={d.id} className="bad">
                    {d.get("type")}{d.get("sku") && `: ${d.get("sku")}`}
                    {d.get("oversold") && ` (${d.get("oversold")} more in orders than on hand)`}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
