// Applying a customer receipt (Receipts tab) against their open quotations.
//
// A payment must live in exactly ONE place or it double-counts: either as a quote
// payment (expense with sourceId + the quote's own payCash/payUpi) or as an
// account-level receipt (expense with custId). Historically the Receipts tab only
// wrote custId receipts, so the money cleared the customer's overall balance in
// Balances but never touched any quotation — leaving Statements still showing "Due".
//
// applyCustomerReceipt fixes that: it waterfalls the amount across the customer's
// outstanding quotes (oldest first) as real quote payments, and only the leftover
// (beyond every quote's due — e.g. paying down an opening balance) is kept as an
// account receipt. Result: Statements, Balances, the quotation and the Daybook all
// move together.
import { allRec, delRec, getRec, put } from "./data";
import { nowIso, uid } from "./calc";
import { addExpense } from "./expenses";
import { quoteBill } from "./payments";
import type { Doc, Expense } from "./types";

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface ReceiptInput {
  custId: string;
  custName: string;
  amount: number;
  mode: "cash" | "upi";
  /** UPI account, or the named cash account ("" = manager daybook). */
  account?: string;
  /** cash handed straight to the owner. */
  toOwner?: boolean;
  /** free-text note (any mode) — shows on lists and the customer's statement PDF. */
  note?: string;
  /** dd-mm-yy; defaults to today. */
  date?: string;
  /** true = keep the whole amount on the customer's account (old/opening dues) —
   *  never allocate it onto open quotations. */
  toAccount?: boolean;
  /** settle this one quotation only (still leftover → account if overpay). */
  quoteId?: string;
  enteredBy: string;
}

export interface ReceiptResult {
  applied: { id: string; number: string; amount: number }[];
  leftover: number;
}

/** A quote counts for allocation once it's Created or already carries money — same rule as partyLedger. */
const isBillable = (d: Doc) =>
  !d.deletedAt &&
  (d.status === "Created" ||
    (+(d.payCash || 0)) > 0 ||
    (+(d.payUpi || 0)) > 0 ||
    (+(d.amountPaid || 0)) > 0);

/** Record a received payment for a customer, applying it to their open quotations
 *  (oldest first) and keeping any remainder as an account-level receipt. */
export async function applyCustomerReceipt(inp: ReceiptInput): Promise<ReceiptResult> {
  let remaining = r2(Math.max(0, +inp.amount || 0));
  const applied: ReceiptResult["applied"] = [];
  // one receipt id across every piece, so lists show the ONE amount the customer handed over
  const rcptId = "RCP-" + uid();

  // "account only" (e.g. paying down an opening balance whose bills predate the app):
  // skip the quote waterfall entirely — the whole amount stays an account receipt.
  // Optional quoteId → only that quotation (manual pick on the Receipts tab).
  const want = (inp.quoteId || "").trim();
  const open = inp.toAccount
    ? []
    : (await allRec<Doc>("quotations"))
        .filter((d) => d.customerId === inp.custId && isBillable(d) && (!want || d.id === want))
        .map((d) => ({ d, bal: r2(quoteBill(d) - (+d.amountPaid || 0)) }))
        .filter((x) => x.bal > 0.5)
        .sort((a, b) => (a.d.createdAt || "").localeCompare(b.d.createdAt || "")); // oldest first

  for (const { d, bal } of open) {
    if (remaining <= 0.5) break;
    const apply = r2(Math.min(remaining, bal));

    // 1) record the payment as this quote's payment (mirrors the editor's PaymentBlock)
    await addExpense({
      type: "sale",
      amount: apply,
      mode: inp.mode,
      account: (inp.account || "").trim(),
      toOwner: inp.mode === "cash" ? !!inp.toOwner : false,
      sourceId: d.id,
      rcptId,
      label: inp.note || "",
      date: inp.date,
      enteredBy: inp.enteredBy,
    });

    // 2) bump the quote's running cash/UPI totals so its due reflects the payment
    const fresh = (await getRec<Doc>("quotations", d.id)) || d;
    const payCash = r2((+(fresh.payCash || 0) || 0) + (inp.mode === "cash" ? apply : 0));
    const payUpi = r2((+(fresh.payUpi || 0) || 0) + (inp.mode === "upi" ? apply : 0));
    fresh.payCash = payCash;
    fresh.payUpi = payUpi;
    fresh.amountPaid = r2(payCash + payUpi);
    const fp = quoteBill(fresh);
    fresh.paymentStatus = fresh.amountPaid <= 0 ? "Pending" : fresh.amountPaid + 0.001 >= fp ? "Paid" : "Partial";
    fresh.paidLogged = fresh.amountPaid > 0;
    fresh.updatedAt = nowIso();
    await put("quotations", fresh);

    applied.push({ id: d.id, number: fresh.number, amount: apply });
    remaining = r2(remaining - apply);
  }

  // leftover (paid beyond every quote's due, e.g. clearing an opening balance) → account receipt
  if (remaining > 0.5) {
    await addExpense({
      type: "sale",
      amount: remaining,
      mode: inp.mode,
      account: (inp.account || "").trim(),
      toOwner: inp.mode === "cash" ? !!inp.toOwner : false,
      custId: inp.custId,
      rcptId,
      note: inp.custName,
      label: inp.note || "",
      date: inp.date,
      enteredBy: inp.enteredBy,
    });
  }

  return { applied, leftover: remaining };
}

/** Safely remove receipt pieces: every piece that was applied onto a quotation rolls the
 *  quote's payCash/payUpi/paid totals back first, then the expense is soft-deleted.
 *  Money is conserved — nothing is left half-deleted with a quote still showing "paid". */
export async function unwindReceiptPieces(pieces: Expense[]): Promise<void> {
  for (const e of pieces) {
    if (e.sourceId) {
      const d = await getRec<Doc>("quotations", e.sourceId);
      if (d) {
        const amt = r2(+e.amount || 0);
        const isCash = e.mode !== "upi";
        d.payCash = r2(Math.max(0, (+(d.payCash || 0) || 0) - (isCash ? amt : 0)));
        d.payUpi = r2(Math.max(0, (+(d.payUpi || 0) || 0) - (!isCash ? amt : 0)));
        d.amountPaid = r2(d.payCash + d.payUpi);
        const fp = quoteBill(d);
        d.paymentStatus = d.amountPaid <= 0 ? "Pending" : d.amountPaid + 0.001 >= fp ? "Paid" : "Partial";
        d.paidLogged = d.amountPaid > 0;
        d.updatedAt = nowIso();
        await put("quotations", d);
      }
    }
    await delRec("expenses", e.id); // soft delete — recoverable in the database
  }
}

export interface MigrationResult {
  /** account receipts examined (type sale, custId, not a due). */
  scanned: number;
  /** receipts fully or partly moved onto quotes. */
  receiptsConverted: number;
  /** quote-payment lines created. */
  payments: number;
  /** quotations whose paid total changed. */
  quotesUpdated: number;
  /** total ₹ that stayed as an account credit (no open quote to absorb it). */
  leftover: number;
}

/**
 * One-time repair: re-apply legacy account-level receipts (custId, no quote link) onto each
 * customer's open quotations, so historical Receipts-tab entries update the quotations and
 * Statements — exactly what applyCustomerReceipt now does for new receipts.
 *
 * Safe by design:
 *  - money is conserved: each receipt is split into quote payments; the original is reduced by the
 *    same amount (deleted when fully absorbed), so totals never change.
 *  - Daybook-neutral: new payment lines copy the receipt's date / mode / account / session, so the
 *    Daybook and any closed sessions keep the same figures.
 *  - idempotent: once a quote's due is covered, re-running finds nothing left to allocate.
 *  Take a backup snapshot before calling (the caller does).
 */
export async function migrateAccountReceiptsToQuotes(): Promise<MigrationResult> {
  const allQuotes = await allRec<Doc>("quotations");
  const expenses = await allRec<Expense>("expenses");

  interface QState {
    d: Doc;
    payCash: number;
    payUpi: number;
    amountPaid: number;
    bill: number;
    touched: boolean;
  }
  const byCust = new Map<string, QState[]>();
  for (const d of allQuotes) {
    if (!d.customerId || !isBillable(d)) continue;
    const s: QState = {
      d,
      payCash: +(d.payCash || 0) || 0,
      payUpi: +(d.payUpi || 0) || 0,
      amountPaid: +(d.amountPaid || 0) || 0,
      bill: quoteBill(d),
      touched: false,
    };
    const arr = byCust.get(d.customerId) || [];
    arr.push(s);
    byCust.set(d.customerId, arr);
  }
  for (const arr of byCust.values()) arr.sort((a, b) => (a.d.createdAt || "").localeCompare(b.d.createdAt || ""));

  const receipts = expenses
    .filter((e) => e.type === "sale" && !!e.custId && !e.charge)
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));

  const newPayments: Expense[] = [];
  const updatedReceipts: Expense[] = [];
  const deletedReceiptIds: string[] = [];
  let leftover = 0;

  for (const rc of receipts) {
    const original = r2(+rc.amount || 0);
    if (original <= 0.5) continue;
    const quotesForCust = byCust.get(rc.custId!) || [];
    let remaining = original;
    const isCash = rc.mode !== "upi";
    for (const st of quotesForCust) {
      if (remaining <= 0.5) break;
      const bal = r2(st.bill - st.amountPaid);
      if (bal <= 0.5) continue;
      const apply = r2(Math.min(remaining, bal));
      newPayments.push({
        id: "EXP-" + uid(),
        date: rc.date,
        type: "sale",
        label: rc.label || "",
        mode: rc.mode,
        amount: apply,
        note: "",
        account: rc.account || "",
        toOwner: !!rc.toOwner,
        enteredBy: rc.enteredBy,
        sourceId: st.d.id,
        sessionId: rc.sessionId,
        collectedAt: rc.collectedAt,
        collectedBy: rc.collectedBy,
        createdAt: rc.createdAt || nowIso(),
        updatedAt: nowIso(),
      } as Expense);
      st.payCash = r2(st.payCash + (isCash ? apply : 0));
      st.payUpi = r2(st.payUpi + (!isCash ? apply : 0));
      st.amountPaid = r2(st.amountPaid + apply);
      st.touched = true;
      remaining = r2(remaining - apply);
    }
    if (remaining <= 0.5) {
      deletedReceiptIds.push(rc.id);
    } else if (remaining < original - 0.005) {
      updatedReceipts.push({ ...rc, amount: remaining, updatedAt: nowIso() });
      leftover = r2(leftover + remaining);
    } else {
      leftover = r2(leftover + original); // untouched — no open quote to absorb it
    }
  }

  const receiptsConverted = deletedReceiptIds.length + updatedReceipts.length;
  if (!newPayments.length && !updatedReceipts.length && !deletedReceiptIds.length) {
    return { scanned: receipts.length, receiptsConverted: 0, payments: 0, quotesUpdated: 0, leftover };
  }

  for (const e of newPayments) await put("expenses", e);

  let quotesUpdated = 0;
  for (const arr of byCust.values()) {
    for (const st of arr) {
      if (!st.touched) continue;
      const d = st.d;
      d.payCash = st.payCash;
      d.payUpi = st.payUpi;
      d.amountPaid = st.amountPaid;
      const fp = quoteBill(d);
      d.paymentStatus = d.amountPaid <= 0 ? "Pending" : d.amountPaid + 0.001 >= fp ? "Paid" : "Partial";
      d.paidLogged = d.amountPaid > 0;
      d.updatedAt = nowIso();
      await put("quotations", d);
      quotesUpdated++;
    }
  }

  for (const e of updatedReceipts) await put("expenses", e);
  for (const id of deletedReceiptIds) await delRec("expenses", id);

  return { scanned: receipts.length, receiptsConverted, payments: newPayments.length, quotesUpdated, leftover };
}
