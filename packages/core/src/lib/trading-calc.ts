import { dateSortKey } from "./calc";

// Pure trading-account math (no db imports → unit-testable in plain node).
// Mirrors the owner's Excel trading sheet:
//   Opening (value + CFT) + Purchases → goods available.
//   Avg Rate = available value ÷ available CFT.
//   Closing Stock = closing CFT × Avg Rate   (closing CFT = physical count, or auto = avail − sold).
//   COGS = available value − closing value.   Gross Profit = Sales − COGS.

export interface TradeLine {
  cft: number;
  taxable: number; // pre-GST value (Karnataka / Sell)
  gst: number; // GST amount
  grand: number; // taxable + gst (Total P.K / Total Sell)
  buy: boolean; // true = purchase, false = sale
}
export interface Opening {
  value: number;
  cft: number;
}
export interface Trading {
  openValue: number;
  openCft: number;
  purchaseValue: number;
  purchaseGst: number;
  purchaseTotal: number;
  purchaseCft: number;
  saleValue: number;
  saleGst: number;
  saleTotal: number;
  saleCft: number;
  availValue: number; // opening + purchases (at cost)
  availCft: number;
  avgRate: number; // availValue / availCft
  closingCft: number;
  closingValue: number; // closingCft * avgRate
  cogs: number; // availValue - closingValue
  grossProfit: number; // saleValue - cogs
  totalAmount: number; // availValue + grossProfit  (= saleValue + closingValue)
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** closingCftOverride: physical stock count (from the sheet). null = auto (avail − sold). */
export function computeTrading(lines: TradeLine[], opening: Opening, closingCftOverride: number | null): Trading {
  let purchaseValue = 0,
    purchaseGst = 0,
    purchaseTotal = 0,
    purchaseCft = 0,
    saleValue = 0,
    saleGst = 0,
    saleTotal = 0,
    saleCft = 0;
  for (const l of lines) {
    if (l.buy) {
      purchaseValue += +l.taxable || 0;
      purchaseGst += +l.gst || 0;
      purchaseTotal += +l.grand || 0;
      purchaseCft += +l.cft || 0;
    } else {
      saleValue += +l.taxable || 0;
      saleGst += +l.gst || 0;
      saleTotal += +l.grand || 0;
      saleCft += +l.cft || 0;
    }
  }
  const openValue = +opening.value || 0;
  const openCft = +opening.cft || 0;
  const availValue = openValue + purchaseValue;
  const availCft = openCft + purchaseCft;
  const avgRate = availCft > 0 ? availValue / availCft : 0;
  const closingCft = closingCftOverride != null ? closingCftOverride : availCft - saleCft;
  const closingValue = closingCft * avgRate;
  const cogs = availValue - closingValue;
  const grossProfit = saleValue - cogs;
  return {
    openValue: r2(openValue),
    openCft: r2(openCft),
    purchaseValue: r2(purchaseValue),
    purchaseGst: r2(purchaseGst),
    purchaseTotal: r2(purchaseTotal),
    purchaseCft: r2(purchaseCft),
    saleValue: r2(saleValue),
    saleGst: r2(saleGst),
    saleTotal: r2(saleTotal),
    saleCft: r2(saleCft),
    availValue: r2(availValue),
    availCft: r2(availCft),
    avgRate: r2(avgRate),
    closingCft: r2(closingCft),
    closingValue: r2(closingValue),
    cogs: r2(cogs),
    grossProfit: r2(grossProfit),
    totalAmount: r2(availValue + grossProfit),
  };
}

/** "dd-mm-yy" (or any parseable date) -> "mm-yy" bucket for the month-wise breakdown.
 *  Uses the robust date parser first so slash/ISO/loose dates still bucket correctly
 *  instead of collapsing to "??". */
export function monthKey(date: string): string {
  const iso = dateSortKey(date); // "yyyy-mm-dd" or ""
  if (iso) return iso.slice(5, 7) + "-" + iso.slice(2, 4);
  const [, mm, yy] = (date || "").split("-");
  return mm && yy ? mm + "-" + yy : "??";
}

export const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
export const MONTH_NAMES: Record<string, string> = {
  "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr", "05": "May", "06": "Jun",
  "07": "Jul", "08": "Aug", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec",
};
