// Trading-account I/O: turn invoices into trade lines and read/write the stock
// config (opening value + CFT, and an optional physical closing-stock count).
// Pure math lives in trading-calc (re-exported).
import { metaGet, metaSet } from "./data";
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

/** One invoice's GST line for the Input-Tax-Credit ledger. */
export function docItc(d: Doc): import("./trading-calc").ItcLine {
  return {
    gst: computeDoc(d).gstAmt,
    kind: d.gstKind === "igst" ? "igst" : "split",
    buy: d.tradeType === "buy",
  };
}

export interface StockConfig {
  /** opening stock value (₹) */
  value: number;
  /** opening stock CFT */
  cft: number;
  /** physical closing-stock CFT count; null = auto (available − sold) */
  closingCft: number | null;
  /** Gross-profit method: "stock" (from closing stock, default) or
   *  "percent" (GP = sales × gpPercent, closing value balances — the accountant's way). */
  gpMode?: "stock" | "percent";
  /** GP % of sales when gpMode is "percent" (e.g. 10). */
  gpPercent?: number;
  /** GST Input-Tax-Credit opening balances (₹ credit held at the start), per head. */
  itcOpen?: { cgst: number; sgst: number; igst: number };
}

const DEFAULT_CFG: StockConfig = {
  value: 0, cft: 0, closingCft: null, gpMode: "stock", gpPercent: 10,
  itcOpen: { cgst: 0, sgst: 0, igst: 0 },
};

export const getStockConfig = async (): Promise<StockConfig> => {
  const saved = await metaGet<Partial<StockConfig>>("stockConfig", {});
  return { ...DEFAULT_CFG, ...saved, itcOpen: { ...DEFAULT_CFG.itcOpen!, ...(saved.itcOpen || {}) } };
};
export const setStockConfig = (c: StockConfig) =>
  metaSet("stockConfig", {
    value: r2(c.value),
    cft: r2(c.cft),
    closingCft: c.closingCft == null ? null : r2(c.closingCft),
    gpMode: c.gpMode === "percent" ? "percent" : "stock",
    gpPercent: r2(Math.max(0, Math.min(100, +(c.gpPercent ?? 10) || 0))),
    itcOpen: {
      cgst: r2(+(c.itcOpen?.cgst ?? 0) || 0),
      sgst: r2(+(c.itcOpen?.sgst ?? 0) || 0),
      igst: r2(+(c.itcOpen?.igst ?? 0) || 0),
    },
  });
