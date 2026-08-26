// Self-check for per-account payment rollup + daily collect.
// Run: npx tsx packages/core/src/lib/accounts.check.ts
import type { Doc, Expense } from "./types";
import {
  accountDayLedger,
  accountLedger,
  accountOverview,
  holderPassbookLines,
  passbookRunning,
  type AccountCollection,
  type AcctBalance,
  type AcctStmtLine,
} from "./accounts";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

const Q = (id: string, cust: string, no: string): Doc =>
  ({ id, number: no, status: "Created", customerId: cust, customerName: cust, phone: "" } as unknown as Doc);

export function demo() {
  const quotes = [Q("q1", "Ramesh", "SF-1")];
  const expenses = [
    { id: "u1", type: "sale", sourceId: "q1", amount: 5000, mode: "upi", account: "Tabrez", date: "06-07-26", createdAt: "u1", enteredBy: "ajju" },
    { id: "u2", type: "sale", sourceId: "q1", amount: 3000, mode: "upi", account: "Current A", date: "06-07-26", createdAt: "u2", enteredBy: "ajju" },
    { id: "c1", type: "sale", custId: "c1", amount: 2000, mode: "cash", account: "Tabrez", date: "06-07-26", createdAt: "c1", enteredBy: "ajju" },
    { id: "d1", type: "sale", custId: "c1", amount: 1000, mode: "cash", date: "06-07-26", createdAt: "d1", enteredBy: "ajju" },
    { id: "old", type: "sale", custId: "c1", amount: 500, mode: "cash", account: "Tabrez", date: "05-07-26", createdAt: "old", enteredBy: "ajju" },
  ] as unknown as Expense[];

  const day = accountDayLedger(expenses, "06-07-26", quotes);
  ok(day.accounts.length === 2, "two accounts on 06-07-26");
  const tabrez = day.accounts.find((a) => a.name === "Tabrez")!;
  ok(tabrez.pending === 7000 && tabrez.total === 7000, "Tabrez pending = UPI + cash on that day");
  ok(day.pendingTotal === 10000, "day pending = Tabrez 7000 + Current A 3000");

  (expenses[0] as Expense).collectedAt = "2026-07-06T10:00:00Z";
  const after = accountDayLedger(expenses, "06-07-26", quotes);
  ok(after.accounts.find((a) => a.name === "Tabrez")!.pending === 2000, "after UPI collected, Tabrez cash still pending");
  ok(after.collectedTotal === 5000, "5000 marked collected");

  const ov = accountOverview(expenses);
  ok(ov.pendingTotal === 5500, "overall pending = 3000+2000 on 06-07 + 500 on 05-07");
  ok(ov.dates.length === 2, "two dates in navigator");
  ok(ov.byAccount.find((a) => a.name === "Tabrez")!.pending === 2500, "Tabrez overall pending");

  const { accounts, grandTotal } = accountLedger(expenses, quotes);
  ok(accounts.length === 2 && grandTotal === 10500, "lifetime total incl. older day");

  // Passbook: collect sits in the same stream; later UPI continues from the reduced balance.
  const sub: AcctBalance = {
    name: "TABREZ GT TRADER",
    received: 276200,
    ownerReceived: 0,
    collected: 0,
    balance: 276200,
    lines: [
      { id: "u-naik", kind: "in", amount: 6000, date: "19-08-26", at: "2026-08-19T10:00:00.000Z", by: "ajju", customer: "Naik" },
      { id: "u-manju", kind: "in", amount: 50000, date: "19-08-26", at: "2026-08-19T13:21:00.000Z", by: "ajju", customer: "MANJUNATH" },
    ],
  };
  const cols: AccountCollection[] = [
    {
      id: "COL-gafoor",
      account: "TABREZ",
      holderId: "h1",
      amount: 100000,
      date: "19-08-26",
      by: "ajju",
      note: "Cash From Gafoor",
      createdAt: "2026-08-19T11:21:00.000Z",
      updatedAt: "2026-08-19T11:21:00.000Z",
    },
    {
      id: "COL-tabrez",
      account: "TABREZ",
      holderId: "h1",
      amount: 150000,
      date: "20-08-26",
      by: "ajju",
      note: "from Tabrez",
      createdAt: "2026-08-20T06:36:00.000Z",
      updatedAt: "2026-08-20T06:36:00.000Z",
    },
  ];
  const book = holderPassbookLines([sub], cols);
  ok(book.length === 4, "UPI + holder collects share one passbook");
  ok(book.filter((l: AcctStmtLine) => l.kind === "collect").length === 2, "two collect lines in the same book");
  const run = passbookRunning(book, 220200); // already 2,20,200 before the 6k Naik line
  ok(run.after[0].id === "u-naik" && run.after[0].balance === 226200, "Naik 6k → 2,26,200");
  ok(run.after[1].id === "COL-gafoor" && run.after[1].balance === 126200, "same-day collect 1,00,000 drops the book to 1,26,200");
  ok(run.after[2].id === "u-manju" && run.after[2].balance === 176200, "Manjunath 50k continues from the new balance → 1,76,200");
  ok(run.after[3].id === "COL-tabrez" && run.after[3].balance === 26200, "next-day collect 1,50,000 → 26,200");
  ok(run.closing === 26200, "closing follows the last collect, not the old 2,76,200");

  console.log(`accounts.check OK (${n} assertions)`);
}

demo();
