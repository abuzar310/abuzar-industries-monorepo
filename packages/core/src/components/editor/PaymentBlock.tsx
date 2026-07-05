"use client";
import { useState } from "react";
import { inr } from "@/lib/calc";
import { addExpense, allExpenses } from "@/lib/expenses";
import { delRec } from "@/lib/db";
import { cloudDelete } from "@/lib/cloud";
import { statementsForQuote, type PartyStatement } from "@/lib/payments";
import { USERS } from "@/lib/local-auth";
import AccountPicker from "@/components/AccountPicker";
import { bumpData, toast } from "@/store/app-store";
import type { Doc, Expense } from "@/lib/types";

const userName = (id: string) => USERS.find((u) => u.id === id)?.name || id || "—";
const when = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(+d) ? "" : d.toLocaleString([], { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};
const r2 = (n: number) => Math.round(n * 100) / 100;

interface Props {
  doc: Doc;
  /** the itemised quote total, shown as the "(quote ₹…)" reference + placeholder */
  quoteGrand: number;
  expenses: Expense[];
  upiAccts: string[];
  by: string;
  onFinalPrice: (v: string) => void;
  /** persist new cash/UPI running totals onto the doc */
  setAggregates: (payCash: number, payUpi: number) => void;
  onClearAll: () => void;
  reload: () => void;
}

export default function PaymentBlock({ doc, quoteGrand, expenses, upiAccts, by, onFinalPrice, setAggregates, onClearAll, reload }: Props) {
  const [amt, setAmt] = useState("");
  const [mode, setMode] = useState<"cash" | "upi">("cash");
  const [acct, setAcct] = useState("");
  const [note, setNote] = useState(""); // free-text note on a cash payment (shown in Statements)

  const finalPrice = doc.finalPrice != null && doc.finalPrice > 0 ? doc.finalPrice : quoteGrand;
  const lines = statementsForQuote(doc, expenses); // this quote's payments, newest first (incl. legacy)
  const received = r2(lines.reduce((s, l) => s + l.amount, 0));
  const balance = r2(finalPrice - received);
  const settled = balance <= 0.5;

  async function addLine() {
    const a = Math.max(0, +amt || 0);
    if (a <= 0) return;
    if (mode === "upi" && !acct.trim()) return toast("Pick the UPI account");
    await addExpense({
      type: "sale",
      amount: a,
      mode,
      account: mode === "upi" ? acct.trim() : "",
      note: (doc.customerName || "Walk-in") + " · " + doc.number,
      label: mode === "cash" ? note.trim() : "", // custom cash note → shows on the statement
      enteredBy: by,
      sourceId: doc.id,
    });
    setAggregates(r2((doc.payCash || 0) + (mode === "cash" ? a : 0)), r2((doc.payUpi || 0) + (mode === "upi" ? a : 0)));
    setAmt("");
    setAcct("");
    setNote("");
    reload();
    bumpData();
    toast("₹" + inr(a) + " recorded" + (mode === "upi" ? " · " + acct.trim() : " · cash → Daybook"));
  }

  async function delLine(l: PartyStatement) {
    await delRec("expenses", l.id);
    await cloudDelete("expenses", l.id);
    setAggregates(
      Math.max(0, r2((doc.payCash || 0) - (l.mode === "cash" ? l.amount : 0))),
      Math.max(0, r2((doc.payUpi || 0) - (l.mode === "upi" ? l.amount : 0))),
    );
    reload();
    bumpData();
  }

  return (
    <div className="panel-card no-print" style={{ marginTop: 12, padding: 14 }}>
      <label className="modal-field" style={{ marginBottom: 12 }}>
        <span>
          Final price ₹ <small style={{ color: "var(--ink-faint)" }}>(quote ₹{inr(quoteGrand)})</small>
        </span>
        <input
          type="number"
          inputMode="decimal"
          placeholder={inr(quoteGrand)}
          value={doc.finalPrice != null ? doc.finalPrice : ""}
          onChange={(e) => onFinalPrice(e.target.value)}
        />
      </label>

      <div className="paybook">
        <div className="pb-r pb-h">
          <span>Amount</span>
          <span>Mode</span>
          <span>Account</span>
          <span>When · by</span>
          <span />
        </div>

        {lines.map((l) => (
          <div className="pb-r" key={l.id}>
            <span className="pb-amt">₹ {inr(l.amount)}</span>
            <span className="pb-mode">{l.mode === "upi" ? "UPI" : "Cash"}</span>
            <span className="pb-acct">{l.mode === "upi" ? l.account || "—" : l.note || "—"}</span>
            <span className="pb-when">{l.synthetic ? "from quote record" : when(l.at) + " · " + userName(l.by)}</span>
            {l.synthetic ? (
              <span />
            ) : (
              <button className="pb-x" title="Delete payment" onClick={() => delLine(l)}>
                ×
              </button>
            )}
          </div>
        ))}

        {!settled && (
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
            <select className="pb-sel" value={mode} onChange={(e) => setMode(e.target.value === "upi" ? "upi" : "cash")}>
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
            </select>
            {mode === "upi" ? (
              <AccountPicker value={acct} onChange={setAcct} accounts={upiAccts} />
            ) : (
              <input
                className="pb-in"
                type="text"
                placeholder="cash note (optional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addLine();
                  }
                }}
              />
            )}
            <button className="pb-fill" type="button" title={"Fill balance ₹" + inr(balance)} onClick={() => setAmt(String(balance))}>
              balance ₹{inr(balance)}
            </button>
            <button className="pb-plus" type="button" title="Add payment" onClick={addLine} disabled={!(+amt > 0)}>
              +
            </button>
          </div>
        )}

        <div className="pb-r pb-foot">
          <span className="pb-amt">₹ {inr(received)}</span>
          <span className="pb-mode" style={{ gridColumn: "2 / 4", color: "var(--ink-faint)" }}>
            received of ₹{inr(finalPrice)}
          </span>
          <span className={"pb-bal " + (settled ? "ok" : "due")}>{settled ? "Settled ✓" : "Bal ₹" + inr(balance)}</span>
          {received > 0 ? (
            <button className="pb-x" title="Clear all payments" onClick={onClearAll}>
              ⌫
            </button>
          ) : (
            <span />
          )}
        </div>
      </div>
    </div>
  );
}
