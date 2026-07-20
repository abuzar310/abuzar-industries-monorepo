// Self-check: sales + purchase serial hole reuse.
// Run: npx tsx packages/core/src/lib/invoice-id.check.ts
import assert from "node:assert/strict";
import { isInvoiceUid, newInvoiceUid, nextFreeLiveDisplay } from "./invoice-id.ts";

const a = newInvoiceUid();
const b = newInvoiceUid();
assert.ok(isInvoiceUid(a) && isInvoiceUid(b) && a !== b);

// Purchases: 1,2,3 with hole reuse
assert.equal(nextFreeLiveDisplay(new Set([1, 2, 4]), "buy"), 3);
assert.equal(nextFreeLiveDisplay(new Set([1, 2, 3]), "buy"), 4);
assert.equal(nextFreeLiveDisplay(new Set(), "buy"), 1);

// Sales: fill tip hole between 2718 and 2721 → 2719 (not 2722)
assert.equal(nextFreeLiveDisplay(new Set([1, 2718, 2721]), "sell"), 2719);
// Delete the top (2721 gone) → next is 2719
assert.equal(nextFreeLiveDisplay(new Set([1, 2718]), "sell"), 2719);
// Contiguous tip → max+1
assert.equal(nextFreeLiveDisplay(new Set([1, 2717, 2718]), "sell"), 2719);
// Ancient big gap under tip — do NOT rewind to 2700; continue 2722
assert.equal(nextFreeLiveDisplay(new Set([1, 2699, 2721]), "sell"), 2722);
// Small tip gap still fills
assert.equal(nextFreeLiveDisplay(new Set([2635, 2636, 2638]), "sell"), 2637);

console.log("invoice-id.check: all assertions passed ✓");
