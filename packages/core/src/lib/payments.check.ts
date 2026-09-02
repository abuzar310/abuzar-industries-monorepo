// Self-check for the party-balance rollup (pure, no DB).
// Run: npx tsx packages/core/src/lib/payments.check.ts
import type { Doc, Expense } from "./types";
import { floorQuotePaidFromExpenses, partyLedger, priorDueOf, quoteLedger } from "./payments";

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
    Q("q4", "Draft Co", "SF-4", 99999, 0, 0, 0, "Draft"), // UNPAID draft = not a bill, ignored
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
    Q("q4", "Draft Co", "SF-4", 99999, 0, 0, 0, "Draft"), // draft, but has an advance → still shows
    Q("q5", "Empty Draft", "SF-5", 5000, 0, 0, 0, "Draft"), // draft, no payment → hidden
  ];
  const expenses = [
    E("e1", "q1", 50000, "upi", "Afsar GPay"),
    E("e2", "q1", 90000, "cash"),
    E("e3", "q2", 80000, "cash"),
    E("ex", "q4", 100, "cash"), // advance on a draft → shows under its quote
  ];
  const { quotes: rows, quoteCount, payCount, totalReceived } = quoteLedger(quotes, expenses);

  ok(quoteCount === 4, "3 created + 1 draft-with-payment shown (empty draft hidden)");
  ok(payCount === 4, "every recorded payment counted, incl. the draft's advance");
  ok(totalReceived === 220100, "total received = 50000 + 90000 + 80000 + 100");
  ok(!!rows.find((r) => r.number === "SF-4"), "a draft quote with an advance appears in the ledger");
  ok(!rows.find((r) => r.number === "SF-5"), "a draft with no payment stays out");

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

/** Trashed (soft-deleted) quotes must not appear in the Statements ledger. */
export function demoTrash() {
  const live = Q("qa", "Live", "SF-A", 1000, 0, 0, 0);
  const gone = Q("qb", "Gone", "SF-B", 1000, 0, 0, 0);
  (gone as unknown as { deletedAt?: string }).deletedAt = "2026-07-05T00:00:00Z";
  const { quotes: rows } = quoteLedger([live, gone], []);
  ok(rows.length === 1 && rows[0].number === "SF-A", "a trashed quote is excluded from the ledger");
  console.log(`payments.check trash OK (${n} assertions)`);
}

/** A standalone receipt (Receipts tab) credited to a customer reduces their balance. */
export function demoReceipts() {
  const quotes = [Q("q1", "Ramesh", "SF-1", 1000, 0, 0, 0)]; // Ramesh owes 1000
  const receipt = {
    id: "r1", type: "sale", custId: "Ramesh", amount: 400, mode: "cash", date: "01-07-26", createdAt: "r1", enteredBy: "ajju",
  } as unknown as Expense;
  const p = partyLedger(quotes, [receipt]).parties.find((x) => x.custId === "Ramesh")!;
  ok(p.paid === 400, "receipt credited to paid");
  ok(p.balance === 600, "receipt reduces the balance to 600");
  ok(p.statements.length === 1, "receipt shows as a statement");
  console.log(`payments.check receipts OK (${n} assertions)`);
}

/** A charge (due added from Receipts tab) increases what the customer owes; not a payment statement. */
export function demoCharge() {
  const quotes = [Q("q1", "Ramesh", "SF-1", 1000, 0, 0, 0)];
  const charge = {
    id: "c1", type: "sale", custId: "Ramesh", amount: 500, charge: true, mode: "", date: "02-07-26", createdAt: "c1", enteredBy: "ajju",
  } as unknown as Expense;
  const receipt = {
    id: "r1", type: "sale", custId: "Ramesh", amount: 200, mode: "cash", date: "03-07-26", createdAt: "r1", enteredBy: "ajju",
  } as unknown as Expense;
  const p = partyLedger(quotes, [charge, receipt]).parties.find((x) => x.custId === "Ramesh")!;
  ok(p.billed === 1500, "charge adds to billed (1000 quote + 500 due)");
  ok(p.paid === 200, "receipt credited to paid");
  ok(p.balance === 1300, "balance = 1500 − 200");
  ok(p.statements.length === 1, "only the receipt is a statement, not the charge");
  console.log(`payments.check charge OK (${n} assertions)`);
}

/** A draft quote that already took an advance must appear in Balances too — otherwise money
 *  shown in Statements would go missing from Balances (the bug this guards against). */
export function demoPaidDraft() {
  const quotes = [
    Q("q1", "Ramesh", "SF-1", 50000, 10000, 10000, 0, "Draft"), // draft, but 10k advance taken
    Q("q2", "Empty", "SF-2", 5000, 0, 0, 0, "Draft"), // draft, no money → still ignored
  ];
  const expenses = [E("e1", "q1", 10000, "cash")];
  const { parties, totalBilled, totalPaid, totalPending } = partyLedger(quotes, expenses);
  ok(parties.length === 1, "only the paid draft becomes a party (empty draft ignored)");
  const p = parties.find((x) => x.name === "Ramesh")!;
  ok(p.billed === 50000 && p.paid === 10000 && p.balance === 40000, "paid draft billed/paid/balance");
  ok(totalBilled === 50000 && totalPaid === 10000 && totalPending === 40000, "paid draft counts in totals");
  console.log(`payments.check paid-draft OK (${n} assertions)`);
}

/** Wood taken against carpenter commission pays the quote without cash/UPI. */
export function demoCommission() {
  const q = Q("q1", "Ramesh", "SF-1", 15000, 10000, 0, 0);
  q.payCommission = 10000;
  const e = {
    id: "c1",
    type: "custom",
    label: "Carpenter commission",
    sourceId: "q1",
    amount: 10000,
    mode: "",
    carpenter: "Ravi",
    party: "Ramesh",
    date: "01-08-26",
    createdAt: "c1",
    enteredBy: "ajju",
  } as unknown as Expense;
  const { quotes: rows } = quoteLedger([q], [e]);
  const r = rows[0];
  ok(r.paid === 10000, "commission counts as paid on the quote");
  ok(r.balance === 5000, "balance after commission = 15000 − 10000");
  ok(r.statements.length === 1 && r.statements[0].commission === true, "commission statement");
  const p = partyLedger([q], [e]).parties.find((x) => x.name === "Ramesh")!;
  ok(p.paid === 10000 && p.cashPaid === 0 && p.upiPaid === 0, "party paid via commission, not cash/UPI");
  console.log(`payments.check commission OK (${n} assertions)`);
}

/** Manager recorded UPI on the daybook but the quote's payUpi was never bumped (Patil Sir). */
export function demoExpenseWithoutQuoteTotals() {
  const quotes = [Q("2026-27-258", "PATIL SIR", "2026-27-258", 27000, 0, 0, 0)];
  const expenses = [E("e-upi", "2026-27-258", 27000, "upi", "Tabrez GT Trader")];
  const p = partyLedger(quotes, expenses).parties.find((x) => x.name === "PATIL SIR")!;
  ok(p.paid === 27000, "itemised UPI counts as paid even when payUpi on the quote is 0");
  ok(p.balance === 0, "₹27,000 bill fully covered by the UPI line → not outstanding");
  ok(p.upiPaid === 27000, "UPI split comes from the expense");
  const { quotes: rows } = quoteLedger(quotes, expenses);
  ok(rows[0].paid === 27000 && rows[0].balance === 0, "Statements tab matches Balances");
  console.log(`payments.check expense-without-totals OK (${n} assertions)`);
}

/** Stale editor save must not drop payUpi below an existing UPI line. */
export function demoPaidFloor() {
  const q = Q("q1", "PATIL SIR", "258", 27000, 0, 0, 0);
  const expenses = [E("e1", "q1", 27000, "upi", "Tabrez GT Trader")];
  floorQuotePaidFromExpenses(q, expenses);
  ok(q.payUpi === 27000 && q.amountPaid === 27000, "floor lifts payUpi from the UPI line");
  ok(q.paymentStatus === "Paid", "status follows the floor");
  q.payUpi = 0;
  q.amountPaid = 0;
  floorQuotePaidFromExpenses(q, []);
  ok(q.payUpi === 0, "with no lines, zeros stay (Clear payments)");
  const inv = Q("inv1", "X", "1", 1000, 500, 0, 0);
  (inv as { kind?: string }).kind = "invoice";
  inv.payUpi = 0;
  floorQuotePaidFromExpenses(inv, [E("e2", "inv1", 500, "upi")]);
  ok(inv.payUpi === 0 && inv.amountPaid === 500, "invoices are not floored");
  console.log(`payments.check paid-floor OK (${n} assertions)`);
}

/** Carrying old dues onto a new quote must not inflate party billed (those rupees are already on the old quote). */
export function demoOldBalance() {
  const oldQ = Q("q1", "Annu", "SF-1", 10000, 0, 0, 0);
  const next = Q("q2", "Annu", "SF-2", 5000, 0, 0, 0);
  (next as { oldBalance?: number }).oldBalance = 10000;
  const p = partyLedger([oldQ, next], []).parties.find((x) => x.name === "Annu")!;
  ok(p.billed === 15000, "old balance on the new quote is not billed twice");
  ok(p.balance === 15000, "they still owe old 10k + new 5k");
  ok(priorDueOf([oldQ, next], [], [], next) === 10000, "prior due on the new quote is the old 10k");
  ok(priorDueOf([oldQ, next], [], [], oldQ) === 5000, "prior due on the old quote is the new 5k");
  const paidNext = Q("q2p", "Annu", "SF-2", 5000, 15000, 15000, 0);
  (paidNext as { oldBalance?: number }).oldBalance = 10000;
  const pay = E("e1", "q2p", 15000, "cash");
  const after = partyLedger([oldQ, paidNext], [pay]).parties.find((x) => x.name === "Annu")!;
  ok(after.billed === 15000, "billed stays own sales after they pay the paper");
  ok(after.paid === 15000 && after.balance === 0, "paying the paper (5k + 10k old) clears the party");
  console.log(`payments.check old-balance OK (${n} assertions)`);
}

demo();
demoQuotes();
demoReconcile();
demoTrash();
demoReceipts();
demoCharge();
demoPaidDraft();
demoCommission();
demoExpenseWithoutQuoteTotals();
demoPaidFloor();
demoOldBalance();
