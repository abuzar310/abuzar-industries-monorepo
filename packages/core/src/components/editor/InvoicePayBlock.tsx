"use client";
// Payments received against an OFFICIAL invoice — internal record, never printed.
// Cash or a named bank account + the date; cash is capped at ₹10,000/customer/day.
import { useEffect, useState } from "react";
import { inr, todayStr } from "@/lib/calc";
import { addExpense } from "@/lib/expenses";
import { delRec, getRec } from "@/lib/data";
import { statementsForQuote, type PartyStatement } from "@/lib/payments";
import { advanceBalance, applyAdvancesToInvoice, CASH_DAY_LIMIT, cashTakenFromCustomerOn, getBankAccounts, restoreAdvanceFromApply } from "@/lib/vouchers";
import { USERS } from "@/lib/local-auth";
import { bumpData, toast } from "@/store/app-store";
import { showReviewQr } from "@/store/review-qr-store";
import type { Doc, Expense } from "@/lib/types";

const r2 = (n: number) => Math.round(n * 100) / 100;
// html date input "yyyy-mm-dd" → app "dd-mm-yy"
const toDmy = (v: string) => {
  const [y, m, d] = (v || "").split("-");
  return d && m && y ? `${d}-${m}-${y.slice(2)}` : "";
};
const userName = (id: string) => USERS.find((u) => u.id === id)?.name || id || "—";

interface Props {
  doc: Doc;
  /** the invoice's grand total (what "settled" means) */
  grand: number;
  expenses: Expense[];
  by: string;
  /** persist new cash/bank running totals onto the doc */
  setAggregates: (payCash: number, payUpi: number) => void;
  reload: () => void;
}

export default function InvoicePayBlock({ doc, grand, expenses, by, setAggregates, reload }: Props) {
  const [amt, setAmt] = useState("");
  const [via, setVia] = useState<"cash" | "bank">("cash");
  const [bank, setBank] = useState("");
  const [banks, setBanks] = useState<string[]>([]);
  const [payDate, setPayDate] = useState(""); // yyyy-mm-dd (blank = today)
  const [note, setNote] = useState("");

  useEffect(() => {
    getBankAccounts().then(setBanks);
  }, []);

  const lines = statementsForQuote(doc, expenses);
  const received = r2(lines.reduce((s, l) => s + l.amount, 0));
  const balance = r2(grand - received);
  const settled = balance <= 0.5;

  // STRUCTURAL cash cap: how much cash room this customer has left for the chosen day.
  // The input itself is clamped to this — an over-limit amount can never be typed in.
  const [cashRoom, setCashRoom] = useState(CASH_DAY_LIMIT);
  const dateStr = payDate ? toDmy(payDate) : todayStr();
  useEffect(() => {
    let alive = true;
    cashTakenFromCustomerOn(doc.customerId || "", dateStr, expenses).then((taken) => {
      if (alive) setCashRoom(Math.max(0, r2(CASH_DAY_LIMIT - taken)));
    });
    return () => {
      alive = false;
    };
  }, [doc.customerId, dateStr, expenses]);

  function onAmt(v: string) {
    const n = +v || 0;
    if (via === "cash" && n > cashRoom) {
      setAmt(String(cashRoom)); // hard clamp — the rest must come by bank
      toast("Cash cap: only ₹" + inr(cashRoom) + " more allowed from this customer on " + dateStr + " — take the rest by bank");
      return;
    }
    setAmt(v);
  }

  // advance sitting on this customer's account — one tap clears it onto this invoice
  const advBal = advanceBalance(expenses, doc.customerId || "");
  async function applyAdv() {
    const firstPay = (doc.payCash || 0) + (doc.payUpi || 0) <= 0.005;
    const r = await applyAdvancesToInvoice(doc);
    if (r.applied <= 0) return toast("Nothing to apply — the invoice may already be settled");
    setAggregates(r.payCash, r.payUpi);
    reload();
    bumpData();
    toast("₹" + inr(r.applied) + " advance applied to this invoice ✓");
    if (firstPay) showReviewQr({ docId: doc.id });
  }

  async function addLine() {
    const a = Math.max(0, +amt || 0);
    if (a <= 0) return;
    if (via === "bank" && !bank.trim()) return toast("Pick the bank account");
    if (via === "cash") {
      // re-check against the live figure (belt and braces on top of the clamped input)
      const taken = await cashTakenFromCustomerOn(doc.customerId || "", dateStr, expenses);
      if (taken + a > CASH_DAY_LIMIT + 0.005)
        return toast(
          "Cash limit — max ₹" + inr(CASH_DAY_LIMIT) + " from one customer per day. ₹" + inr(taken) +
            " already taken on " + dateStr + "; take the rest by bank.",
        );
    }
    const firstPay = (doc.payCash || 0) + (doc.payUpi || 0) <= 0.005;
    await addExpense({
      type: "sale",
      amount: a,
      mode: via === "cash" ? "cash" : "upi", // bank rides the upi slot; `account` = the bank
      account: via === "bank" ? bank.trim() : "",
      label: note.trim(),
      note: (doc.customerName || "Walk-in") + " · " + doc.number,
      sourceId: doc.id,
      date: dateStr,
      enteredBy: by,
    });
    setAggregates(r2((doc.payCash || 0) + (via === "cash" ? a : 0)), r2((doc.payUpi || 0) + (via === "bank" ? a : 0)));
    setAmt("");
    setNote("");
    setPayDate("");
    reload();
    bumpData();
    toast("₹" + inr(a) + " received · " + (via === "cash" ? "Cash" : bank.trim()) + " · " + dateStr);
    if (firstPay) showReviewQr({ docId: doc.id });
  }

  async function delLine(l: PartyStatement) {
    if (!l.synthetic) {
      const e = await getRec<Expense>("expenses", l.id);
      if (e) await restoreAdvanceFromApply(e);
      await delRec("expenses", l.id); // soft delete
    }
    setAggregates(
      Math.max(0, r2((doc.payCash || 0) - (l.mode === "cash" ? l.amount : 0))),
      Math.max(0, r2((doc.payUpi || 0) - (l.mode === "upi" ? l.amount : 0))),
    );
    reload();
    bumpData();
    toast("Payment removed");
  }

  return (
    <div className="panel-card no-print" style={{ marginTop: 12, padding: 14 }}>
      <div className="pc-head" style={{ paddingLeft: 0 }}>
        Payments received
        <small style={{ marginLeft: 8, textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
          internal record — never printed on the invoice
        </small>
      </div>

      {advBal > 0.5 && !settled && (
        <div className="pb-editbar" style={{ marginBottom: 10 }}>
          <span>
            ₹{inr(advBal)} advance is sitting on {doc.customerName || "this customer"}&apos;s account
          </span>
          <button type="button" onClick={applyAdv}>Apply to this invoice</button>
        </div>
      )}

      <div className="paybook">
        <div className="pb-r pb-h">
          <span>Amount</span>
          <span>Via</span>
          <span>Account</span>
          <span>When · by</span>
          <span />
        </div>

        {lines.map((l) => (
          <div className="pb-r" key={l.id}>
            <span className="pb-amt">₹ {inr(l.amount)}</span>
            <span className="pb-mode">{l.mode === "upi" ? "Bank" : "Cash"}</span>
            <span className="pb-acct">{l.mode === "upi" ? l.account || "—" : l.note || "—"}</span>
            <span className="pb-when">{l.synthetic ? "from invoice record" : l.date + " · " + userName(l.by)}</span>
            <span className="pb-rowacts">
              <button className="pb-x" title="Delete payment" onClick={() => delLine(l)}>×</button>
            </span>
          </div>
        ))}

        {!settled && (
          <>
            <div className="pb-r pb-add">
              <input
                className="pb-in"
                type="number"
                inputMode="decimal"
                placeholder="0"
                max={via === "cash" ? cashRoom : undefined}
                value={amt}
                onChange={(e) => onAmt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addLine();
                  }
                }}
              />
              <select className="pb-sel" value={via} onChange={(e) => setVia(e.target.value as "cash" | "bank")}>
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
              </select>
              {via === "bank" ? (
                <select className="pb-sel" value={bank} onChange={(e) => setBank(e.target.value)}>
                  <option value="">— bank —</option>
                  {banks.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
              ) : (
                <span className="pb-in" style={{ color: cashRoom <= 0 ? "var(--danger)" : "var(--ink-faint)", fontSize: 13 }}>
                  {cashRoom <= 0 ? "cash cap reached today" : "cash room ₹" + inr(cashRoom) + " today"}
                </span>
              )}
              <input
                className="pb-in"
                type="date"
                title="When was this received? (optional — defaults to today)"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
              />
              <button
                className="pb-plus"
                type="button"
                title="Record payment"
                onClick={addLine}
                disabled={!(+amt > 0) || (via === "cash" && +amt > cashRoom + 0.005)}
              >
                +
              </button>
            </div>
            {via === "bank" && banks.length === 0 && (
              <div className="pb-r pb-note">
                <span className="pb-in" style={{ color: "var(--ink-faint)", fontSize: 12.5, gridColumn: "1 / -1" }}>
                  No bank accounts yet — add them on the Vouchers tab → Payment vouchers.
                </span>
              </div>
            )}
            <div className="pb-r pb-note">
              <input
                className="pb-in"
                type="text"
                placeholder="Note (optional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                style={{ gridColumn: "1 / -1" }}
              />
            </div>
          </>
        )}

        <div className="pb-r pb-foot">
          <span className="pb-amt">₹ {inr(received)}</span>
          <span className="pb-mode" style={{ gridColumn: "2 / 4", color: "var(--ink-faint)" }}>
            received of ₹{inr(grand)}
          </span>
          {settled ? (
            <span className="pb-bal ok">Settled ✓</span>
          ) : (
            <button
              className="pb-bal due"
              type="button"
              title="Tap to fill this balance into the amount (cash: capped to today's room)"
              style={{ border: "none", background: "transparent", cursor: "pointer" }}
              onClick={() => setAmt(String(via === "cash" ? Math.min(balance, cashRoom) : balance))}
            >
              Bal ₹{inr(balance)}
            </button>
          )}
          <span />
        </div>
      </div>
    </div>
  );
}
