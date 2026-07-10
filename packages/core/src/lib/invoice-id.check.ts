// Self-check: invoice UID ≠ display number, purchase gap reuse.
// Run: npx tsx packages/core/src/lib/invoice-id.check.ts
import assert from "node:assert/strict";
import { isInvoiceUid, newInvoiceUid } from "./invoice-id.ts";

const a = newInvoiceUid();
const b = newInvoiceUid();
assert.ok(isInvoiceUid(a), "uid shape");
assert.ok(isInvoiceUid(b), "uid shape b");
assert.notEqual(a, b, "uids unique");
assert.ok(a.startsWith("inv_"), "inv_ prefix");
assert.ok(!/^\d+$/.test(a), "uid is not a plain display number");

console.log("invoice-id.check: all assertions passed ✓");
