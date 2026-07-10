// Trading-account I/O: turn invoices into trade lines and read/write the stock
// config (opening value + CFT, and an optional physical closing-stock count).
// Pure math lives in trading-calc (re-exported).
import { metaGet, metaSet } from "./db";
import { docVolumeCft, computeDoc } from "./calc";
import type { Doc } from "./types";
import type { TradeLine } from "./trading-calc";

export * from "./trading-calc";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Total CFT (CBM converted) + taxable/GST/total of one invoice, and its buy/sell direction. */
export function docTrade(d: Doc): TradeLine {
  const t = computeDoc(d);
  return { cft: r2(docVolumeCft(d)), taxable: t.sub, gst: t.gstAmt, grand: t.grand, buy: d.tradeType === "buy" };
}

export interface StockConfig {
  /** opening stock value (₹) */
  value: number;
  /** opening stock CFT */
  cft: number;
  /** physical closing-stock CFT count; null = auto (available − sold) */
  closingCft: number | null;
}

export const getStockConfig = () => metaGet<StockConfig>("stockConfig", { value: 0, cft: 0, closingCft: null });
export const setStockConfig = (c: StockConfig) =>
  metaSet("stockConfig", { value: r2(c.value), cft: r2(c.cft), closingCft: c.closingCft == null ? null : r2(c.closingCft) });
