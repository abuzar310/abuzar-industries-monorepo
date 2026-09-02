// Self-check for the cash/UPI split in the daybook (pure, no DB).
// Run: npx tsx packages/core/src/lib/expenses.check.ts
import type { Expense } from "./types";
import { dayTotals, inBooks, inDaybook, isUpi } from "./expenses";
import { isAccountTransportPay, isPendingTransport } from "./pocket-spend";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

const E = (type: Expense["type"], amount: number, mode: Expense["mode"], account = ""): Expense => ({
  id: "E" + n, date: "01-07-26", type, mode, amount, account, note: "", enteredBy: "ajju",
  createdAt: "", updatedAt: "", synced: false,
});

export function demo() {
  const cashSale = E("sale", 5000, "cash");
  const upiSale = E("sale", 3000, "upi", "Afsar GPay");
  const salary = E("salary", 1000, "");

  ok(isUpi(upiSale), "upi sale is a UPI statement");
  ok(!isUpi(cashSale), "cash sale is NOT a UPI statement");
  ok(!isUpi(salary), "an outflow is never a UPI statement");

  // the cash daybook (what Ajju hands over) must EXCLUDE upi
  const cashBook = [cashSale, upiSale, salary].filter((e) => !isUpi(e));
  const t = dayTotals(cashBook);
  ok(t.cashIn === 5000, "cashIn counts only cash sales");
  ok(t.upiIn === 0, "upiIn is zero in the cash book (UPI lives in its own section)");
  ok(t.net === 4000, "in-hand = cash 5000 − spent 1000, UPI never touches it");

  const fromPocket = {
    ...E("custom", 800, ""),
    label: "Transport",
    account: "CS Kumar",
    pocketSpend: "transport" as const,
  };
  ok(isAccountTransportPay(fromPocket) && !inDaybook(fromPocket), "UPI-pocket transport is not till cash");
  const due = { ...fromPocket, account: "" };
  ok(isPendingTransport(due) && !inBooks(due) && !inDaybook(due), "transport due is off Books and till");

  console.log(`expenses.check OK (${n} assertions)`);
}

demo();
