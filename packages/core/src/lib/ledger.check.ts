// Self-check for ledger balance math (pure functions, no DB).
// Run: node src/lib/ledger.check.ts
import assert from "node:assert/strict";
import { gstOf, partyLedger, accountBook, dmyToIso, isoToDmy, dmyToSort } from "./ledger-calc.ts";
import type { LedgerEntry, VoucherKind } from "./types.ts";

let seq = 0;
function v(kind: VoucherKind, amount: number, extra: Partial<LedgerEntry> = {}): LedgerEntry {
  seq++;
  return {
    id: "VCH-" + seq,
    date: extra.date || "0" + seq + "-01-26",
    kind,
    partyKind: extra.partyKind ?? "",
    partyId: extra.partyId ?? "",
    amount,
    taxable: amount,
    gstRate: 0,
    account: extra.account ?? "",
    fromAccount: extra.fromAccount ?? "",
    ref: "",
    note: "",
    enteredBy: "test",
    createdAt: "2026-01-0" + seq,
    updatedAt: "2026-01-0" + seq,
    synced: false,
  };
}

// GST split
assert.deepEqual(gstOf(10000, 18), { gstAmount: 1800, total: 11800 });
assert.deepEqual(gstOf(8000, 0), { gstAmount: 0, total: 8000 });

// Debtor: opening 1000 + sale 8000 − receipt 3000 = 6000 receivable
const deb = [
  v("opening", 1000, { partyKind: "debtor", partyId: "C1" }),
  v("sale", 8000, { partyKind: "debtor", partyId: "C1" }),
  v("receipt", 3000, { partyKind: "debtor", partyId: "C1", account: "ACC-h" }),
];
const dl = partyLedger("debtor", "C1", deb);
assert.equal(dl.opening, 1000);
assert.equal(dl.charges, 8000);
assert.equal(dl.settled, 3000);
assert.equal(dl.balance, 6000);
assert.equal(dl.rows[dl.rows.length - 1].running, 6000);

// Creditor: purchase 11800 − payment 4000 = 7800 payable
const cred = [
  v("purchase", 11800, { partyKind: "creditor", partyId: "V1" }),
  v("payment", 4000, { partyKind: "creditor", partyId: "V1", account: "ACC-h" }),
];
const cl = partyLedger("creditor", "V1", cred);
assert.equal(cl.charges, 11800);
assert.equal(cl.settled, 4000);
assert.equal(cl.balance, 7800);

// Bank book for ACC-h: opening 50000 −4000 (pay) +3000 (recv) −2000 (contra out) = 47000
const bank = [
  v("payment", 4000, { account: "ACC-h" }),
  v("receipt", 3000, { account: "ACC-h" }),
  v("contra", 2000, { account: "ACC-c", fromAccount: "ACC-h" }),
];
assert.equal(accountBook("ACC-h", bank, 50000).closing, 47000);
// the contra lands +2000 in ACC-c
assert.equal(accountBook("ACC-c", bank, 0).closing, 2000);

// date conversions round-trip and sort correctly
assert.equal(dmyToIso("05-03-26"), "2026-03-05");
assert.equal(isoToDmy("2026-03-05"), "05-03-26");
assert.ok(dmyToSort("01-02-26") < dmyToSort("01-03-26"));
assert.ok(dmyToSort("31-12-25") < dmyToSort("01-01-26"));

console.log("ledger.check: all assertions passed ✓");
