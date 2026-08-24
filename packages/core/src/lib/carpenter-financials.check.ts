// Run: npx tsx packages/core/src/lib/carpenter-financials.check.ts
import type { Carpenter, Customer, Doc, Expense } from "./types";
import {
  carpenterCommissionHistory,
  carpenterDashboard,
  carpenterHref,
  carpenterKey,
  findCarpenterRollup,
  isCarpenterCommission,
  parseCarpenterParam,
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
  const customers = [cust("C1", "Imran", "ravi", "111"), cust("C2", "Salim", "Ravi")];
  const quotes = [quote("Q1", "C1", "Ravi", "12")];
  const expenses = [
    pay({ id: "e3", amount: 500, carpenter: "RAVI", party: "Imran", refQuoteId: "Q1", quoteNo: "12", date: "12-08-26" }),
    pay({ id: "e4", amount: 300, carpenter: "", party: "Salim" }),
  ];

  const rows = rollupCarpenters(directory, customers, quotes, expenses);
  ok(rows.length === 1, "same carpenter name merges");
  const r = rows[0];
  ok(r.record?.id === "CARP-1", "directory record kept");
  ok(r.phone === "999", "directory phone wins");
  ok(r.customerCount === 2, "two customers under Ravi");
  ok(r.quoteCount === 1, "one matching quote");
  ok(r.payoutCount === 2, "named + inferred commission");
  ok(r.commissionTotal === 800, "commission sums");
  ok(r.lastPaid === "12-08-26", "latest payout date");

  const hit = findCarpenterRollup(directory, customers, quotes, expenses, "CARP-1");
  ok(hit?.key === "ravi", "find by saved id");
  ok(findCarpenterRollup(directory, customers, quotes, expenses, "n--ravi")?.payoutCount === 2, "find by name slug");

  const dash = carpenterDashboard(rows);
  ok(dash.carpenterCount === 1, "dashboard carpenter count");
  ok(dash.customerCount === 2, "dashboard unique customers");
  ok(dash.commissionTotal === 800, "dashboard commission total");
  ok(dash.payoutCount === 2, "dashboard payout count");

  const hist = carpenterCommissionHistory(rows);
  ok(hist.length === 2, "history is commission only");
  ok(hist[0].amount === 500 && hist[0].party === "Imran", "history newest first");
  ok(hist.every((h) => h.carpenter === "Ravi"), "history names the carpenter");

  console.log("carpenter-financials.check OK (" + n + " assertions)");
}

demo();
