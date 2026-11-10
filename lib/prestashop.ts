import type { ShopOrder } from "./types";

/**
 * Thin client for the PrestaShop Webservice (1.7 / 8.x).
 * Reads use output_format=JSON; writes still need XML, so updates are
 * done as GET xml -> change one field -> PUT xml back.
 */
export class PrestaShop {
  constructor(
    private readonly baseUrl: string, // https://shop.example.com
    private readonly apiKey: string,
  ) {}

  static fromEnv() {
    const url = process.env.PS_URL;
    const key = process.env.PS_API_KEY;
    if (!url || !key) throw new Error("PS_URL and PS_API_KEY must be set");
    return new PrestaShop(url.replace(/\/$/, ""), key);
  }

  private async request(path: string, init: RequestInit = {}, attempt = 1): Promise<Response> {
    const res = await fetch(`${this.baseUrl}/api/${path}`, {
      ...init,
      headers: {
        authorization: "Basic " + Buffer.from(`${this.apiKey}:`).toString("base64"),
        ...init.headers,
      },
      signal: AbortSignal.timeout(15_000),
    });
    // shared hosting loves to throw random 5xx/429 under load - retry a couple of times
    if ((res.status >= 500 || res.status === 429) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 500 * attempt));
      return this.request(path, init, attempt + 1);
    }
    if (!res.ok) throw new Error(`PrestaShop ${init.method ?? "GET"} ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res;
  }

  private async json<T>(path: string): Promise<T> {
    const sep = path.includes("?") ? "&" : "?";
    const res = await this.request(`${path}${sep}output_format=JSON`);
    const data = await res.json();
    // an empty list comes back as [] instead of {"orders": []}
    return (Array.isArray(data) ? {} : data) as T;
  }

  /** Orders changed since `since` (PrestaShop local time), oldest first. */
  async ordersUpdatedSince(since: string, limit = 100): Promise<ShopOrder[]> {
    const q = new URLSearchParams({
      display: "full",
      date: "1",
      "filter[date_upd]": `[${since},2100-01-01 00:00:00]`,
      sort: "[date_upd_ASC]",
      limit: String(limit),
    });
    const data = await this.json<{ orders?: RawOrder[] }>(`orders?${q}`);
    return (data.orders ?? []).map(parseOrder);
  }

  async stockAvailables() {
    const q = new URLSearchParams({ display: "[id,id_product,id_product_attribute,quantity]", limit: "5000" });
    const data = await this.json<{ stock_availables?: RawStock[] }>(`stock_availables?${q}`);
    return (data.stock_availables ?? []).map((s) => ({
      id: Number(s.id),
      productId: Number(s.id_product),
      attributeId: Number(s.id_product_attribute),
      quantity: Number(s.quantity),
    }));
  }

  async references() {
    const [products, combinations] = await Promise.all([
      this.json<{ products?: RawProduct[] }>(`products?${new URLSearchParams({ display: "[id,reference,name]", limit: "5000" })}`),
      this.json<{ combinations?: RawCombination[] }>(`combinations?${new URLSearchParams({ display: "[id,id_product,reference]", limit: "5000" })}`),
    ]);
    return {
      products: (products.products ?? []).map((p) => ({ id: Number(p.id), reference: p.reference, name: localized(p.name) })),
      combinations: (combinations.combinations ?? []).map((c) => ({ id: Number(c.id), productId: Number(c.id_product), reference: c.reference })),
    };
  }

  async setQuantity(stockAvailableId: number, quantity: number) {
    const res = await this.request(`stock_availables/${stockAvailableId}`);
    const xml = setXmlField(await res.text(), "quantity", String(quantity));
    await this.request(`stock_availables/${stockAvailableId}`, {
      method: "PUT",
      headers: { "content-type": "application/xml" },
      body: xml,
    });
  }
}

interface RawOrder {
  id: number | string;
  reference: string;
  current_state: string;
  date_upd: string;
  associations?: { order_rows?: Array<{ product_reference: string; product_quantity: string }> };
}
interface RawStock { id: string; id_product: string; id_product_attribute: string; quantity: string }
interface RawProduct { id: number; reference: string; name: string | Array<{ id: string; value: string }> }
interface RawCombination { id: number; id_product: string; reference: string }

export function parseOrder(o: RawOrder): ShopOrder {
  return {
    id: Number(o.id),
    reference: o.reference,
    state: Number(o.current_state),
    updatedAt: o.date_upd,
    lines: (o.associations?.order_rows ?? [])
      .filter((r) => r.product_reference) // products without a reference can't be matched to the warehouse
      .map((r) => ({ sku: r.product_reference.trim(), qty: Number(r.product_quantity) })),
  };
}

/** Multi-language fields come as [{id, value}] - take the first language. */
export function localized(v: RawProduct["name"]): string {
  return typeof v === "string" ? v : v?.[0]?.value ?? "";
}

/** Replaces the value of a single XML field, keeping PrestaShop's CDATA style. */
export function setXmlField(xml: string, field: string, value: string): string {
  const re = new RegExp(`<${field}>(<!\\[CDATA\\[)?[^<\\]]*(\\]\\]>)?</${field}>`);
  if (!re.test(xml)) throw new Error(`field <${field}> not found in PrestaShop response`);
  return xml.replace(re, `<${field}><![CDATA[${value}]]></${field}>`);
}

/** PrestaShop stores dates in shop-local time without a zone: "YYYY-MM-DD HH:MM:SS". */
export function psDate(d: Date, tz = process.env.PS_TIMEZONE ?? "Europe/Tbilisi") {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
