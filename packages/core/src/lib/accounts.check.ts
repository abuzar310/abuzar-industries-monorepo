// Self-check for per-account payment rollup + daily collect.
// Run: npx tsx packages/core/src/lib/accounts.check.ts
import type { Doc, Expense } from "./types";
import {
  accountDayLedger,
  accountLedger,
  accountOverview,
  acctLedger,
  holderPassbookLines,
  isAccountTransportPay,
  isPendingTransport,
  isTransportPocket,
  isTransportPocketName,
  passbookRunning,
  stmtFromTransport,
  type AccountCollection,
  type AcctBalance,
  type AcctStmtLine,
} from "./accounts";
import { inBooks, inDaybook, spendCatKey } from "./expenses";

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
    spent: 0,
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

  // Pay transport from a UPI pocket: balance drops, Collected stays a hand-over, Books gets Transport, till does not.
  const pocket = {
    id: "tr1",
    type: "custom",
    label: "Transport",
    mode: "",
    amount: 2500,
    account: "CS Kumar",
    party: "Raju lorry",
    pocketSpend: "transport",
    date: "21-08-26",
    createdAt: "2026-08-21T09:00:00.000Z",
    enteredBy: "ajju",
  } as unknown as Expense;
  const due = { ...pocket, account: "", holderId: undefined } as unknown as Expense;
  ok(isPendingTransport(due) && !isAccountTransportPay(due), "due is locked, not paid");
  ok(!inBooks(due) && !inDaybook(due), "due stays off Books and the till until paid");
  ok(isAccountTransportPay(pocket), "flagged UPI-pocket transport");
  ok(!isPendingTransport(pocket), "paid row is not still due");
  ok(!inDaybook(pocket), "transport from a UPI pocket stays out of the cash till");
  ok(inBooks(pocket), "transport from a UPI pocket lands in Books");
  ok(spendCatKey(pocket) === "transport", "Books bucket is Transport");

  const tillTransport = { ...pocket, pocketSpend: undefined, account: "" } as unknown as Expense;
  ok(!isAccountTransportPay(tillTransport), "Daybook Transport without the pocket flag is not a pocket pay");
  ok(inDaybook(tillTransport), "ordinary Transport spend still hits the till");

  const led = acctLedger(
    [
      {
        id: "u-cs",
        type: "sale",
        mode: "upi",
        amount: 10000,
        account: "CS Kumar",
        date: "20-08-26",
        createdAt: "2026-08-20T10:00:00.000Z",
        enteredBy: "ajju",
      } as unknown as Expense,
      pocket,
    ],
    [],
  );
  const cs = led.accounts.find((a) => a.name === "CS Kumar")!;
  ok(cs.received === 10000 && cs.collected === 0 && cs.spent === 2500, "transport is spent, not collected");
  ok(cs.balance === 7500, "pocket balance drops by the lorry pay");
  ok(cs.lines.some((l) => l.kind === "transport" && l.customer === "Raju lorry"), "passbook names the transporter");

  const holderPay = { ...pocket, id: "tr-h", holderId: "h-cs", account: "CS Kumar" } as unknown as Expense;
  const holderLed = acctLedger(
    [
      {
        id: "u-cs2",
        type: "sale",
        mode: "upi",
        amount: 10000,
        account: "CS Kumar",
        date: "20-08-26",
        createdAt: "2026-08-20T10:00:00.000Z",
        enteredBy: "ajju",
      } as unknown as Expense,
      holderPay,
    ],
    [],
  );
  ok(holderLed.accounts.find((a) => a.name === "CS Kumar")!.spent === 0, "holder-level transport is not a sub-account debit");
  const hBook = holderPassbookLines(holderLed.accounts, [], [holderPay]);
  ok(hBook.some((l) => l.kind === "transport"), "holder passbook includes holder-level transport");
  const hRun = passbookRunning(hBook, 0);
  ok(hRun.closing === 7500, "holder running balance drops after transport");
  ok(stmtFromTransport(pocket).kind === "transport", "transport statement line");
  ok(isTransportPocketName("CS KUMAR(SVT TRANSPORT CHENNAI)"), "name with Transport is a transport pocket");
  ok(!isTransportPocketName("Tabrez GT Trader"), "ordinary UPI is not a transport pocket");
  ok(isTransportPocket({ kind: "transport", name: "CS Kumar", accounts: [] }), "kind=transport wins");
  ok(!isTransportPocket({ kind: "collect", name: "SVT Transport", accounts: [] }), "kind=collect overrides the name");

  console.log(`accounts.check OK (${n} assertions)`);
}

demo();
