import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrestaShop } from "./prestashop";

// Tiny fake of the PrestaShop webservice: enough to check auth, query params and the XML round trip.
let server: Server;
let ps: PrestaShop;
let stockXml = `<?xml version="1.0"?><prestashop><stock_available><id><![CDATA[7]]></id><quantity><![CDATA[12]]></quantity></stock_available></prestashop>`;
const seen: string[] = [];
let failNext = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (req.headers.authorization !== "Basic " + Buffer.from("KEY:").toString("base64")) {
      res.writeHead(401).end();
      return;
    }
    if (failNext > 0) {
      failNext--;
      res.writeHead(503).end("busy");
      return;
    }
    if (req.url?.startsWith("/api/orders")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        orders: [{ id: 5, reference: "ABC", current_state: "2", date_upd: "2026-11-10 12:00:00",
          associations: { order_rows: [{ product_reference: "MUG-01", product_quantity: "3" }] } }],
      }));
      return;
    }
    if (req.url?.startsWith("/api/stock_availables/7")) {
      if (req.method === "PUT") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => { stockXml = body; res.end(body); });
        return;
      }
      res.end(stockXml);
      return;
    }
    if (req.url?.startsWith("/api/stock_availables")) {
      res.end("[]"); // what PrestaShop returns for an empty list
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, r));
  ps = new PrestaShop(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, "KEY");
});

afterAll(() => server.close());

describe("PrestaShop client", () => {
  it("reads orders with the date filter", async () => {
    const orders = await ps.ordersUpdatedSince("2026-11-10 11:00:00");
    expect(orders[0]).toMatchObject({ id: 5, state: 2, lines: [{ sku: "MUG-01", qty: 3 }] });
    // URLSearchParams sends spaces as "+", which PHP decodes back to spaces
    const params = new URL(seen.at(-1)!.split(" ")[1], "http://x").searchParams;
    expect(params.get("filter[date_upd]")).toBe("[2026-11-10 11:00:00,2100-01-01 00:00:00]");
    expect(params.get("output_format")).toBe("JSON");
  });

  it("updates quantity through GET xml -> PUT xml", async () => {
    await ps.setQuantity(7, 4);
    expect(stockXml).toContain("<quantity><![CDATA[4]]></quantity>");
    expect(stockXml).toContain("<id><![CDATA[7]]></id>");
  });

  it("retries on 5xx", async () => {
    failNext = 2;
    await expect(ps.setQuantity(7, 9)).resolves.toBeUndefined();
    expect(stockXml).toContain("<![CDATA[9]]>");
  });

  it("handles the empty-list quirk", async () => {
    expect(await ps.stockAvailables()).toEqual([]);
  });
});
