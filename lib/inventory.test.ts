import { describe, expect, it } from "vitest";
import { applyWarehouseUpdate, available, needsPush, reservationDelta } from "./inventory";
import type { Product } from "./types";

const product = (over: Partial<Product> = {}): Product => ({
  sku: "MUG-01", name: "Clay mug", stock: 10, reserved: 0, warehouseVersion: 5, psStockAvailableId: 7, ...over,
});

const reserving = new Set([1, 2, 3, 10, 11, 12]);
const lines = [{ sku: "MUG-01", qty: 2 }, { sku: "BWL-01", qty: 1 }, { sku: "MUG-01", qty: 1 }];

describe("available", () => {
  it("subtracts reserved and never goes negative", () => {
    expect(available({ stock: 10, reserved: 3 })).toBe(7);
    expect(available({ stock: 2, reserved: 5 })).toBe(0);
  });
});

describe("applyWarehouseUpdate", () => {
  it("ignores stale versions", () => {
    expect(applyWarehouseUpdate(product(), { sku: "MUG-01", onHand: 1, version: 5 })).toEqual({ action: "skip", reason: "stale" });
  });

  it("flags oversold when stock drops under reservations", () => {
    expect(applyWarehouseUpdate(product({ reserved: 4 }), { sku: "MUG-01", onHand: 1, version: 6 }))
      .toEqual({ action: "update", stock: 1, oversold: 3 });
  });

  it("skips unknown skus", () => {
    expect(applyWarehouseUpdate(undefined, { sku: "NOPE", onHand: 1, version: 1 }).action).toBe("skip");
  });
});

describe("reservationDelta", () => {
  it("new paid order reserves stock, merging repeated skus", () => {
    expect(reservationDelta(undefined, 2, lines, reserving)).toEqual(new Map([["MUG-01", 3], ["BWL-01", 1]]));
  });

  it("paid -> shipped releases the reservation", () => {
    expect(reservationDelta(2, 4, lines, reserving).get("MUG-01")).toBe(-3);
  });

  it("awaiting payment -> paid changes nothing", () => {
    expect(reservationDelta(10, 2, lines, reserving).size).toBe(0);
  });

  it("order first seen already cancelled changes nothing", () => {
    expect(reservationDelta(undefined, 6, lines, reserving).size).toBe(0);
  });

  it("cancelled order re-opened reserves again", () => {
    expect(reservationDelta(6, 3, lines, reserving).get("BWL-01")).toBe(1);
  });
});

describe("needsPush", () => {
  it("pushes only when the shop number would change", () => {
    expect(needsPush(product({ lastPushedQty: 10 }))).toBe(false);
    expect(needsPush(product({ lastPushedQty: 10, reserved: 1 }))).toBe(true);
    expect(needsPush(product({ psStockAvailableId: undefined }))).toBe(false);
  });
});
