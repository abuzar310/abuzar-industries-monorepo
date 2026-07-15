// Self-check for the trading-account math (pure, no DB).
// Run: node src/lib/trading.check.ts
import assert from "node:assert/strict";
import { computeTrading, monthKey } from "./trading-calc.ts";

const buy = { cft: 100, taxable: 100000, gst: 18000, grand: 118000, buy: true };
const sale = { cft: 50, taxable: 60000, gst: 7200, grand: 67200, buy: false };

// Opening 90,000 @ 100 CFT. Avail = 190,000 / 200 CFT -> avg 950.
// Auto closing CFT = 200 - 50 = 150 -> closing 142,500. COGS 47,500. GP 12,500.
const t = computeTrading([buy, sale], { value: 90000, cft: 100 }, null);
assert.equal(t.purchaseValue, 100000);
assert.equal(t.purchaseGst, 18000);
assert.equal(t.saleValue, 60000);
assert.equal(t.availCft, 200);
assert.equal(t.avgRate, 950);
assert.equal(t.closingCft, 150);
assert.equal(t.closingValue, 142500);
assert.equal(t.cogs, 47500);
assert.equal(t.grossProfit, 12500);
assert.equal(t.totalAmount, 202500); // = sale 60000 + closing 142500

// Physical closing-count override changes closing + gross profit.
const p = computeTrading([buy, sale], { value: 90000, cft: 100 }, 140);
assert.equal(p.closingCft, 140);
assert.equal(p.closingValue, 133000); // 140 * 950
assert.equal(p.grossProfit, 3000); // 60000 - (190000 - 133000)

// Empty -> no NaN.
const z = computeTrading([], { value: 0, cft: 0 }, null);
assert.equal(z.avgRate, 0);
assert.equal(z.closingValue, 0);
assert.equal(z.grossProfit, 0);

// "% of sales" mode reproduces the accountant's TRADING A/C 2026-27 sheet exactly:
// Opening 44,99,771.16 + Purchase 65,76,037.13 + G/P (10% of sell) = Sell 42,12,813.44 + Closing 72,84,276.19,
// both sides totalling 1,14,97,089.63.
const acct = computeTrading(
  [
    { cft: 0, taxable: 6576037.13, gst: 0, grand: 6576037.13, buy: true },
    { cft: 0, taxable: 4212813.44, gst: 0, grand: 4212813.44, buy: false },
  ],
  { value: 4499771.16, cft: 0 },
  null,
  { mode: "percent", percent: 10 },
);
assert.equal(acct.grossProfit, 421281.34); // 10% of sell
assert.equal(acct.closingValue, 7284276.19); // balancing figure
assert.equal(acct.totalAmount, 11497089.63); // Opening + Purchase + GP
assert.equal(Math.round((acct.saleValue + acct.closingValue) * 100) / 100, 11497089.63); // = other side

assert.equal(monthKey("05-06-26"), "06-26");

console.log("trading.check: all assertions passed ✓");
