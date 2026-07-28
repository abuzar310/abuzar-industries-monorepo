"use client";
// Payments received against an OFFICIAL invoice — internal record, never printed.
// Cash or a named bank account + the date; cash is capped at ₹10,000/customer/day.
import { useEffect, useState } from "react";
import { inr, todayStr } from "@/lib/calc";
import { addExpense } from "@/lib/expenses";
import { delRec } from "@/lib/data";
import { statementsForQuote, type PartyStatement } from "@/lib/payments";
import { addBankAccount, CASH_DAY_LIMIT, cashTakenFromCustomerOn, getBankAccounts } from "@/lib/vouchers";
import { USERS } from "@/lib/local-auth";
import { bumpData, toast } from "@/store/app-store";
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
  const [newBank, setNewBank] = useState("");
  const [payDate, setPayDate] = useState(""); // yyyy-mm-dd (blank = today)
  const [note, setNote] = useState("");

  useEffect(() => {
    getBankAccounts().then(setBanks);
  }, []);

  const lines = statementsForQuote(doc, expenses);
  const received = r2(lines.reduce((s, l) => s + l.amount, 0));
  const balance = r2(grand - received);
  const settled = balance <= 0.5;

  async function addBank() {
    const next = await addBankAccount(newBank);
    setBanks(next);
    const n = newBank.trim();
    if (n) setBank(next.find((x) => x.toLowerCase() === n.toLowerCase()) || n);
    setNewBank("");
  }

  async function addLine() {
    const a = Math.max(0, +amt || 0);
    if (a <= 0) return;
    if (via === "bank" && !bank.trim()) return toast("Pick the bank account");
    const dateStr = payDate ? toDmy(payDate) : todayStr();
    if (via === "cash") {
      // the ₹10k rule: cash from one customer is capped per day — the rest must come by bank
      const taken = await cashTakenFromCustomerOn(doc.customerId || "", dateStr, expenses);
      if (taken + a > CASH_DAY_LIMIT)
        return toast(
          "Cash limit — max ₹" + inr(CASH_DAY_LIMIT) + " from one customer per day. ₹" + inr(taken) +
            " already taken on " + dateStr + "; take the rest by bank.",
        );
    }
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
  }

  async function delLine(l: PartyStatement) {
    if (!l.synthetic) await delRec("expenses", l.id); // soft delete
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
                value={amt}
                onChange={(e) => setAmt(e.target.value)}
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
                <span className="pb-in" style={{ color: "var(--ink-faint)", fontSize: 13 }}>
                  max ₹{inr(CASH_DAY_LIMIT)}/day
                </span>
              )}
              <input
                className="pb-in"
                type="date"
                title="When was this received? (optional — defaults to today)"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
              />
              <button className="pb-plus" type="button" title="Record payment" onClick={addLine} disabled={!(+amt > 0)}>
                +
              </button>
            </div>
            {via === "bank" && (
              <div className="pb-r pb-note">
                <input
                  className="pb-in"
                  type="text"
                  placeholder="+ new bank account (e.g. HDFC Chitradurga)"
                  value={newBank}
                  onChange={(e) => setNewBank(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addBank()}
                  style={{ gridColumn: "1 / 4" }}
                />
                <button className="btn sm" type="button" onClick={addBank} disabled={!newBank.trim()} style={{ gridColumn: "4 / -1", justifySelf: "start" }}>
                  Add bank
                </button>
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
              title="Tap to fill this balance into the amount"
              style={{ border: "none", background: "transparent", cursor: "pointer" }}
              onClick={() => setAmt(String(balance))}
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
