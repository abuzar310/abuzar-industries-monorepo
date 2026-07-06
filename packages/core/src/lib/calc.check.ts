// Self-check for the money / CFT / words logic. Run: node src/lib/calc.check.ts
import assert from "node:assert/strict";
import { cftOf, computeDoc, rupeesInWords, inr, splitHandover } from "./calc.ts";
import type { Doc } from "./types.ts";

// CFT = (L × W × T × Pcs) ÷ 144
assert.equal(cftOf({ l: 12, w: 12, t: 12, pcs: 1 }), 12);
assert.equal(cftOf({ l: "7", w: "6", t: "4", pcs: "3" }), 3.5);
assert.equal(cftOf({ l: "", w: "", t: "", pcs: "" }), 0);

// Indian rupees in words
assert.equal(rupeesInWords(0), "Rupees Zero only");
assert.equal(
  rupeesInWords(1234567),
  "Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven only",
);
assert.equal(rupeesInWords(100.5), "Rupees One Hundred and Fifty Paise only");
assert.equal(rupeesInWords(10000000), "Rupees One Crore only");

// computeDoc: one section, rate 100, one 12-CFT line, 18% GST
const d = {
  sections: [{ name: "Teak", rate: 100, rows: [{ l: 12, w: 12, t: 12, pcs: 1 }] }],
  gst: 18,
} as unknown as Doc;
const t = computeDoc(d);
assert.equal(t.sub, 1200);
assert.equal(t.gstAmt, 216);
assert.equal(t.grand, 1416);
assert.deepEqual(t.secCft, [12]);

// direct-CFT mode: type CFT directly (5) × rate 100 = 500
const dd = { sections: [{ name: "Bulk", rate: 100, calcMode: "direct", rows: [{ l: "", w: "", t: "", pcs: "", cft: 5 }] }], gst: 0 } as unknown as Doc;
assert.equal(computeDoc(dd).sub, 500);

// CBM mode: type CBM directly (2.5) × ₹/CBM rate 40000 = 100000
const dc = { sections: [{ name: "Logs", rate: 40000, calcMode: "cbm", rows: [{ l: "", w: "", t: "", pcs: "", cft: 2.5 }] }], gst: 0 } as unknown as Doc;
assert.equal(computeDoc(dc).sub, 100000);
assert.deepEqual(computeDoc(dc).secCft, [2.5]);

// running-ft mode: L 7 × Pcs 3 = 21 ft × rate 10 = 210
const dr = { sections: [{ name: "Ply", rate: 10, calcMode: "rft", rows: [{ l: 7, w: 0, t: 0, pcs: 3 }] }], gst: 0 } as unknown as Doc;
assert.equal(computeDoc(dr).sub, 210);

// flat GST: gst is a rupee amount, not a percent
const df = { sections: [{ name: "Teak", rate: 100, rows: [{ l: 12, w: 12, t: 12, pcs: 1 }] }], gst: 500, gstMode: "flat" } as unknown as Doc;
assert.equal(computeDoc(df).gstAmt, 500);
assert.equal(computeDoc(df).grand, 1700);

// session handover split: 5500 in hand, give 5000 → 500 carries forward
assert.deepEqual(splitHandover(0, 5500, 5000), { inHand: 5500, given: 5000, carried: 500 });
assert.deepEqual(splitHandover(500, 5000, 5000), { inHand: 5500, given: 5000, carried: 500 }); // opening folds in
assert.deepEqual(splitHandover(0, 5500), { inHand: 5500, given: 5500, carried: 0 }); // omit → give all
assert.deepEqual(splitHandover(0, 5500, 9999), { inHand: 5500, given: 5500, carried: 0 }); // clamped to in-hand
assert.deepEqual(splitHandover(0, 5500, -50), { inHand: 5500, given: 0, carried: 5500 }); // clamped ≥ 0

// formatting
assert.equal(inr(1416), "1,416.00");

console.log("calc.check: all assertions passed ✓");
