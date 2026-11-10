import { describe, expect, it } from "vitest";
import { localized, parseOrder, psDate, setXmlField } from "./prestashop";

describe("parseOrder", () => {
  it("maps webservice json to order lines", () => {
    const order = parseOrder({
      id: "1042",
      reference: "XKBKNABJK",
      current_state: "2",
      date_upd: "2026-11-10 14:03:11",
      associations: {
        order_rows: [
          { product_reference: "MUG-01 ", product_quantity: "2" },
          { product_reference: "", product_quantity: "1" },
        ],
      },
    });
    expect(order).toEqual({
      id: 1042, reference: "XKBKNABJK", state: 2, updatedAt: "2026-11-10 14:03:11",
      lines: [{ sku: "MUG-01", qty: 2 }],
    });
  });
});

describe("setXmlField", () => {
  const xml = `<prestashop><stock_available><id><![CDATA[7]]></id><quantity><![CDATA[12]]></quantity><depends_on_stock><![CDATA[0]]></depends_on_stock></stock_available></prestashop>`;

  it("replaces only the requested field", () => {
    const out = setXmlField(xml, "quantity", "3");
    expect(out).toContain("<quantity><![CDATA[3]]></quantity>");
    expect(out).toContain("<id><![CDATA[7]]></id>");
  });

  it("works without CDATA too", () => {
    expect(setXmlField("<a><quantity>5</quantity></a>", "quantity", "0")).toBe("<a><quantity><![CDATA[0]]></quantity></a>");
  });

  it("throws when the field is missing", () => {
    expect(() => setXmlField("<a></a>", "quantity", "1")).toThrow();
  });
});

describe("localized", () => {
  it("handles both plain and multi-language names", () => {
    expect(localized("Mug")).toBe("Mug");
    expect(localized([{ id: "1", value: "Mug" }, { id: "2", value: "ჭიქა" }])).toBe("Mug");
  });
});

describe("psDate", () => {
  it("formats in shop-local time", () => {
    expect(psDate(new Date("2026-11-10T10:05:09Z"), "Europe/Tbilisi")).toBe("2026-11-10 14:05:09");
  });
});
