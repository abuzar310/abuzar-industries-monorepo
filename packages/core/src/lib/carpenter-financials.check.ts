// Run: npx tsx packages/core/src/lib/carpenter-financials.check.ts
import type { Carpenter, Customer, Doc, Expense } from "./types";
import { inDaybook, isQuoteCommissionPay } from "./expenses";
import {
  carpenterCommissionHistory,
  carpenterDashboard,
  carpenterHref,
  carpenterKey,
  carpenterPendingAll,
  commissionGivenOnQuote,
  commissionPendingOnQuote,
  findCarpenterRollup,
  isCarpenterCommission,
  parseCarpenterParam,
  pendingPayHref,
  rollupCarpenters,
} from "./carpenter-financials";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

const cust = (id: string, name: string, site: string, phone = ""): Customer =>
  ({ id, name, phone, site, address: "", notes: "", createdAt: "" }) as Customer;

const carp = (id: string, name: string, phone = ""): Carpenter =>
  ({ id, name, phone, createdAt: "" }) as Carpenter;

const quote = (id: string, customerId: string, site: string, number = "1"): Doc =>
  ({
    id,
    kind: "quotation",
    number,
    status: "Created",
    customerId,
    customerName: "",
    phone: "",
    site,
    address: "",
    notes: "",
    date: "01-08-26",
    sections: [],
    gst: 0,
    quotationId: "",
    paymentStatus: "",
    amountPaid: 0,
    createdAt: "2026-08-01",
    updatedAt: "2026-08-01",
    stockDeducted: false,
  }) as Doc;

const pay = (partial: Partial<Expense> & Pick<Expense, "id" | "amount">): Expense =>
  ({
    date: "10-08-26",
    type: "custom",
    label: "Carpenter commission",
    mode: "",
    note: "",
    enteredBy: "ajju",
    createdAt: "2026-08-10",
    updatedAt: "2026-08-10",
    ...partial,
  }) as Expense;

function demo() {
  ok(carpenterKey("  Ravi ") === "ravi", "name key is trimmed lower");
  ok(isCarpenterCommission(pay({ id: "e1", amount: 200 })), "commission label matches");
  ok(!isCarpenterCommission(pay({ id: "e2", amount: 200, label: "Food", type: "food" })), "food is not commission");

  const href = carpenterHref("ravi kumar");
  const parsed = parseCarpenterParam(href.replace("/carpenters/", ""));
  ok(parsed.key === "ravi kumar", "virtual href round-trips");
  ok(parseCarpenterParam("CARP-1").recordId === "CARP-1", "saved id parses");

  const directory = [carp("CARP-1", "Ravi", "999")];
  directory[0].phoneAlt = "888";
  directory[0].photo = "data:image/jpeg;base64,QQ==";
  const customers = [cust("C1", "Imran", "ravi", "111"), cust("C2", "Salim", "Ravi")];
  const quotes = [quote("Q1", "C1", "Ravi", "12")];
  quotes[0].commLock = {
    amount: 10000,
    carpenter: "Ravi",
    party: "Imran",
    partyId: "C1",
    lockedBy: "afsar",
    lockedAt: "2026-08-01T10:00:00.000Z",
  };
  const paidOff = quote("QLOCK", "C1", "Ravi", "99");
  paidOff.commLock = {
    amount: 500,
    carpenter: "Ravi",
    party: "Imran",
    partyId: "C1",
    lockedBy: "ajju",
    lockedAt: "2026-08-22T10:00:00.000Z",
  };
  const dead = quote("QDEAD", "C1", "Ravi", "00");
  dead.deletedAt = "2026-08-23T00:00:00.000Z";
  dead.commLock = {
    amount: 9999,
    carpenter: "Ravi",
    lockedBy: "afsar",
    lockedAt: "2026-08-23T00:00:00.000Z",
  };
  const otherCarp = quote("QK", "C2", "Ravi", "14");
  otherCarp.commLock = {
    amount: 4000,
    carpenter: "Kumar",
    party: "Salim",
    partyId: "C2",
    lockedBy: "afsar",
    lockedAt: "2026-08-21T10:00:00.000Z",
  };
  quotes.push(paidOff, dead, otherCarp);
  const expenses = [
    pay({ id: "e3", amount: 500, carpenter: "RAVI", party: "Imran", refQuoteId: "Q1", quoteNo: "12", date: "12-08-26" }),
    pay({ id: "e4", amount: 300, carpenter: "", party: "Salim" }),
    pay({ id: "e5", amount: 1000, carpenter: "Ravi", party: "Imran", sourceId: "Q-WOOD", refQuoteId: "Q1", quoteNo: "12" }),
    pay({ id: "e7", amount: 500, carpenter: "Ravi", party: "Imran", refQuoteId: "QLOCK", quoteNo: "99", createdAt: "2026-08-23T00:00:00.000Z" }),
    pay({ id: "e8", amount: 1000, carpenter: "Kumar", party: "Salim", refQuoteId: "QK", quoteNo: "14", createdAt: "2026-08-22T00:00:00.000Z" }),
  ];

  const rows = rollupCarpenters(directory, customers, quotes, expenses);
  ok(rows.length === 2, "Ravi + lock carpenter Kumar");
  const r = rows.find((x) => x.key === "ravi")!;
  ok(!!r, "Ravi rollup present");
  ok(r.record?.id === "CARP-1", "directory record kept");
  ok(r.phone === "999", "directory phone wins");
  ok(r.phoneAlt === "888", "directory alt phone rides on rollup");
  ok(r.photo === "data:image/jpeg;base64,QQ==", "photo rides on rollup");
  ok(r.customerCount === 2, "two customers under Ravi");
  ok(r.quoteCount === 3, "live quotes on Ravi site (deleted excluded)");
  ok(r.payoutCount === 4, "named + inferred + wood-against-commission + paid-off lock");
  ok(r.commissionTotal === 2300, "cash record + quote commission pay both count as given");
  ok(r.pendingTotal === 8500, "lock 10000 minus 1500 given on Q1");
  ok(r.pendingCount === 1, "fully given lock is not pending");
  ok(isCarpenterCommission(expenses[2]), "wood-against-commission (sourceId) still counts");
  ok(isQuoteCommissionPay(expenses[2]), "sourceId marks quote commission pay");
  ok(!inDaybook(expenses[2]), "quote commission pay stays out of Daybook cash");
  ok(inDaybook(expenses[0]), "cash Record commission still hits Daybook");
  ok(r.lastPaid === "12-08-26", "latest payout date");
  ok(commissionPendingOnQuote(quotes[0], expenses) === 8500, "quote pending helper");
  ok(commissionPendingOnQuote(paidOff, expenses) === 0, "given >= lock → pending 0");
  ok(commissionPendingOnQuote(dead, expenses) === 0, "deleted quote has no pending");
  ok(commissionGivenOnQuote("Q1", expenses) === 1500, "sourceId + refQuoteId on same row counts once");
  ok(commissionGivenOnQuote("Q1", expenses, "2026-08-20T00:00:00.000Z") === 0, "commission given before the lock does not eat pending");
  const both = pay({ id: "e9", amount: 100, carpenter: "Ravi", sourceId: "QX", refQuoteId: "QX" });
  ok(commissionGivenOnQuote("QX", [both]) === 100, "one expense with both ids counts once");

  const kumar = rows.find((x) => x.key === "kumar")!;
  ok(!!kumar, "lock carpenter can differ from quote site");
  ok(kumar.pendingTotal === 3000, "Kumar lock 4000 minus 1000 given");
  ok(kumar.quoteCount === 0, "lock does not steal the quote from site carpenter");

  const hit = findCarpenterRollup(directory, customers, quotes, expenses, "CARP-1");
  ok(hit?.key === "ravi", "find by saved id");
  ok(findCarpenterRollup(directory, customers, quotes, expenses, "n--ravi")?.payoutCount === 4, "find by name slug");

  const dash = carpenterDashboard(rows);
  ok(dash.carpenterCount === 2, "dashboard carpenter count");
  ok(dash.customerCount === 2, "dashboard unique customers");
  ok(dash.commissionTotal === 3300, "dashboard commission total");
  ok(dash.payoutCount === 5, "dashboard payout count");
  ok(dash.pendingTotal === 11500, "dashboard pending 8500 + 3000");
  ok(dash.pendingCount === 2, "dashboard pending quotes");

  const hist = carpenterCommissionHistory(rows);
  ok(hist.length === 5, "history is commission only");
  ok(hist.some((h) => h.amount === 500 && h.party === "Imran"), "history includes cash record");
  ok(hist.filter((h) => h.carpenter === "Ravi").length === 4, "history names the carpenter");

  const pending = carpenterPendingAll(rows);
  ok(pending.length === 2, "pending list skips paid-off and deleted");
  ok(pending[0].pending === 3000 && pending[0].carpenter === "Kumar", "newest lock first");
  const payUrl = pendingPayHref(pending[1]);
  ok(payUrl.includes("paid=carpenter") && payUrl.includes("amt=8500") && payUrl.includes("quote=Q1"), "Pay URL prefills Receipts");

  console.log("carpenter-financials.check OK (" + n + " assertions)");
}

demo();
