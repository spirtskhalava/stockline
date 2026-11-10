export interface Product {
  sku: string; // = PrestaShop product/combination reference
  name: string;
  stock: number; // on hand, as last reported by the warehouse
  reserved: number; // in PrestaShop orders the warehouse hasn't shipped yet
  warehouseVersion: number;
  psProductId?: number;
  psAttributeId?: number; // 0 for simple products
  psStockAvailableId?: number;
  lastPushedQty?: number; // what we last wrote to PrestaShop
  pushedAt?: number;
}

export interface WarehouseUpdate {
  sku: string;
  onHand: number;
  version: number; // increases with every change on the warehouse side
}

export interface OrderLine {
  sku: string;
  qty: number;
}

export interface ShopOrder {
  id: number;
  reference: string;
  state: number;
  updatedAt: string; // PrestaShop date_upd, "YYYY-MM-DD HH:MM:SS"
  lines: OrderLine[];
}
