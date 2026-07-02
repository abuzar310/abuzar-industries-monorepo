// Self-check for the pure double-entry math (no DB).
// Run: npx tsx packages/core/src/lib/ledger.check.ts
import type { Ledger, Voucher } from "./types";
import { gstSplit, isBalanced, ledgerBalance, ledgerStatement, trialBalance } from "./ledger-calc";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

const L = (id: string, name: string, group: Ledger["group"], opening = 0): Ledger => ({
  id, name, group, opening, gstin: "", phone: "", address: "", notes: "",
  createdAt: "", updatedAt: "", synced: false,
});
const V = (id: string, type: Voucher["type"], date: string, legs: Voucher["legs"]): Voucher => ({
  id, no: 1, date, type, legs, narration: "", enteredBy: "t",
  createdAt: id, updatedAt: "", synced: false,
});

export function demo() {
  const cash = L("cash", "Cash", "Cash-in-hand", 100000);
  const cap = L("cap", "Capital", "Capital Account", -100000);
  const party = L("p", "ARADHYA", "Sundry Debtors");
  const sales = L("s", "Sales @ 18%", "Sales Accounts");
  const cgst = L("cg", "CGST", "Duties & Taxes");
  const sgst = L("sg", "SGST", "Duties & Taxes");
  const hdfc = L("h", "HDFC", "Bank Accounts");
  const ledgers = [cash, cap, party, sales, cgst, sgst, hdfc];

  // GST split: 120285 @ 18% split → 21651.30 gst, 10825.65 each
  const g = gstSplit(120285, 18, "split");
  ok(g.total === 141936.3 && g.cgst === 10825.65 && g.sgst === 10825.65, "gst split 18% on 120285");

  const sale = V("v1", "Sales", "03-05-26", [
    { ledgerId: "p", dr: g.total, cr: 0 },
    { ledgerId: "s", dr: 0, cr: g.taxable },
    { ledgerId: "cg", dr: 0, cr: g.cgst },
    { ledgerId: "sg", dr: 0, cr: g.sgst },
  ]);
  const rcpt = V("v2", "Receipt", "09-05-26", [
    { ledgerId: "h", dr: 43000, cr: 0 },
    { ledgerId: "p", dr: 0, cr: 43000 },
  ]);
  const contra = V("v3", "Contra", "10-05-26", [
    { ledgerId: "h", dr: 20000, cr: 0 },
    { ledgerId: "cash", dr: 0, cr: 20000 },
  ]);
  const vouchers = [sale, rcpt, contra];

  ok(vouchers.every(isBalanced), "every voucher balances Dr=Cr");
  ok(ledgerBalance(party, vouchers) === 98936.3, "debtor 141936.30 − 43000 = 98936.30 Dr");
  ok(ledgerBalance(hdfc, vouchers) === 63000, "bank 43000 + 20000 contra = 63000 Dr");
  ok(ledgerBalance(cash, vouchers) === 80000, "cash 100000 − 20000 = 80000");
  ok(ledgerBalance(sales, vouchers) === -120285, "sales credit −120285 (Cr)");

  const st = ledgerStatement(party, vouchers, (id) => ledgers.find((x) => x.id === id)!.name);
  ok(st.closing === 98936.3, "statement closing = balance");
  ok(st.rows[0].particulars.startsWith("Sales @ 18%"), "sale particulars = sales head");
  ok(st.rows[1].particulars === "HDFC", "receipt particulars = bank");

  const tb = trialBalance(ledgers, vouchers);
  ok(tb.balanced, "trial balance Dr = Cr (" + tb.totalDr + " vs " + tb.totalCr + ")");

  return n;
}

if (typeof process !== "undefined" && process.argv?.[1]?.includes("ledger.check")) {
  console.log("ledger.check: " + demo() + " assertions passed ✓");
}
