// Self-check for the party-balance rollup (pure, no DB).
// Run: npx tsx packages/core/src/lib/payments.check.ts
import type { Doc, Expense } from "./types";
import { partyLedger, quoteLedger } from "./payments";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

const Q = (id: string, cust: string, no: string, bill: number, paid: number, cash: number, upi: number, status = "Created"): Doc =>
  ({ id, number: no, status, customerId: cust, customerName: cust, phone: "", finalPrice: bill, amountPaid: paid, payCash: cash, payUpi: upi } as unknown as Doc);
const E = (id: string, src: string, amount: number, mode: Expense["mode"], account = ""): Expense =>
  ({ id, type: "sale", sourceId: src, amount, mode, account, date: "01-07-26", createdAt: id, enteredBy: "ajju" } as unknown as Expense);

export function demo() {
  const quotes = [
    Q("q1", "Ramesh", "SF-1", 200000, 140000, 90000, 50000), // 2L bill, paid 90k cash + 50k upi
    Q("q2", "Suresh", "SF-2", 80000, 80000, 80000, 0), // fully settled
    Q("q3", "Ramesh", "SF-3", 50000, 0, 0, 0), // another Ramesh quote, nothing paid
    Q("q4", "Draft Co", "SF-4", 99999, 0, 0, 0, "Draft"), // draft = not a bill, ignored
  ];
  const expenses = [
    E("e1", "q1", 50000, "upi", "Afsar GPay"),
    E("e2", "q1", 90000, "cash"),
    E("e3", "q2", 80000, "cash"),
  ];
  const { parties, totalBilled, totalPaid, totalPending } = partyLedger(quotes, expenses);

  ok(parties.length === 2, "drafts excluded → 2 parties (Ramesh, Suresh)");
  const ramesh = parties.find((p) => p.name === "Ramesh")!;
  ok(ramesh.billed === 250000, "Ramesh billed = 200000 + 50000");
  ok(ramesh.paid === 140000, "Ramesh paid = 140000");
  ok(ramesh.balance === 110000, "Ramesh balance = 250000 − 140000");
  ok(ramesh.cashPaid === 90000 && ramesh.upiPaid === 50000, "Ramesh cash/UPI split");
  ok(ramesh.statements.length === 2, "Ramesh has 2 statements");
  ok(ramesh.statements[0].at === "e2" && ramesh.statements[1].at === "e1", "statements sorted newest-first by createdAt");
  ok(ramesh.quoteCount === 2, "Ramesh has 2 quotes");

  ok(parties[0].name === "Ramesh", "sorted by balance desc → Ramesh first (settled Suresh last)");
  ok(totalBilled === 330000, "total billed = 250000 + 80000");
  ok(totalPaid === 220000, "total paid = 140000 + 80000");
  ok(totalPending === 110000, "total pending = only Ramesh's positive balance (Suresh settled)");

  console.log(`payments.check OK (${n} assertions)`);
}

/** Per-quotation statement rollup (the Statements tab). */
export function demoQuotes() {
  const quotes = [
    Q("q1", "Ramesh", "SF-1", 200000, 140000, 90000, 50000),
    Q("q2", "Suresh", "SF-2", 80000, 80000, 80000, 0),
    Q("q3", "Ramesh", "SF-3", 50000, 0, 0, 0), // created, no payment yet
    Q("q4", "Draft Co", "SF-4", 99999, 0, 0, 0, "Draft"), // draft = not billed, excluded
  ];
  const expenses = [
    E("e1", "q1", 50000, "upi", "Afsar GPay"),
    E("e2", "q1", 90000, "cash"),
    E("e3", "q2", 80000, "cash"),
    E("ex", "q4", 100, "cash"), // against a draft → ignored
  ];
  const { quotes: rows, quoteCount, payCount, totalReceived } = quoteLedger(quotes, expenses);

  ok(quoteCount === 3, "drafts excluded → 3 created quotations");
  ok(payCount === 3, "3 payments counted (draft's ignored)");
  ok(totalReceived === 220000, "total received = 50000 + 90000 + 80000");

  const r1 = rows.find((r) => r.number === "SF-1")!;
  ok(r1.bill === 200000 && r1.paid === 140000 && r1.balance === 60000, "SF-1 bill/paid/balance");
  ok(r1.statements.length === 2, "SF-1 has 2 statements");
  ok(r1.statements[0].at === "e2" && r1.statements[1].at === "e1", "statements newest-first by createdAt");
  ok(r1.statements[1].account === "Afsar GPay", "UPI account carried onto the statement");

  const r3 = rows.find((r) => r.number === "SF-3")!;
  ok(r3.statements.length === 0, "SF-3 (unpaid) shows no statements");

  console.log(`payments.check quotes OK (${n} assertions)`);
}

/** Legacy quote: cash paid on the doc but never itemised → surfaced as a synthetic statement. */
export function demoReconcile() {
  const quotes = [Q("qL", "Legacy", "SF-9", 184000, 184000, 54000, 130000)]; // 54k cash + 130k UPI
  const expenses = [E("u1", "qL", 130000, "upi", "Afsar GPay")]; // only UPI was recorded
  const { quotes: rows, payCount, totalReceived } = quoteLedger(quotes, expenses);
  const r = rows[0];
  ok(r.statements.length === 2, "legacy quote → UPI statement + reconstructed cash statement");
  const cash = r.statements.find((s) => s.mode === "cash")!;
  ok(!!cash && cash.synthetic === true, "missing cash surfaced as a synthetic statement");
  ok(cash.amount === 54000, "synthetic cash = payCash − already-itemised cash = 54000");
  ok(payCount === 2 && totalReceived === 184000, "reconciled total received = full 184000");

  console.log(`payments.check reconcile OK (${n} assertions)`);
}

demo();
demoQuotes();
demoReconcile();
