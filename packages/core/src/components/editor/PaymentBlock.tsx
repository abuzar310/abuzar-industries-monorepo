"use client";
import { useState } from "react";
import { inr, nowIso } from "@/lib/calc";
import { addExpense } from "@/lib/expenses";
import { delRec, getRec, put } from "@/lib/db";
import { cloudDelete } from "@/lib/cloud";
import { statementsForQuote, type PartyStatement } from "@/lib/payments";
import { USERS } from "@/lib/local-auth";
import AccountPicker from "@/components/AccountPicker";
import { bumpData, toast } from "@/store/app-store";
import type { Doc, Expense } from "@/lib/types";

const userName = (id: string) => USERS.find((u) => u.id === id)?.name || id || "—";
const hhmm = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(+d) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};
// html date input value "yyyy-mm-dd" → the app's "dd-mm-yy"
const toDmy = (v: string) => {
  const [y, m, d] = (v || "").split("-");
  return d && m && y ? `${d}-${m}-${y.slice(2)}` : "";
};
// app's "dd-mm-yy" → html date input value "yyyy-mm-dd" (for pre-filling the picker on edit)
const fromDmy = (v: string) => {
  const [d, m, y] = (v || "").split("-");
  return d && m && y ? `20${y}-${m}-${d}` : "";
};
const r2 = (n: number) => Math.round(n * 100) / 100;

interface Props {
  doc: Doc;
  /** the itemised quote total, shown as the "(quote ₹…)" reference + placeholder */
  quoteGrand: number;
  expenses: Expense[];
  upiAccts: string[];
  by: string;
  /** current user is the owner — their cash never enters the manager's daybook */
  isOwner: boolean;
  onFinalPrice: (v: string) => void;
  /** persist new cash/UPI running totals onto the doc */
  setAggregates: (payCash: number, payUpi: number) => void;
  onClearAll: () => void;
  reload: () => void;
}

export default function PaymentBlock({ doc, quoteGrand, expenses, upiAccts, by, isOwner, onFinalPrice, setAggregates, onClearAll, reload }: Props) {
  const [amt, setAmt] = useState("");
  const [mode, setMode] = useState<"cash" | "owner" | "upi" | "uowner">("cash");
  const [acct, setAcct] = useState("");
  const [note, setNote] = useState(""); // free-text note on a cash payment (shown in Statements)
  const [payDate, setPayDate] = useState(""); // optional: when the payment actually happened (yyyy-mm-dd)
  const [editId, setEditId] = useState<string | null>(null); // a recorded payment being edited (its expense id)

  const finalPrice = doc.finalPrice != null && doc.finalPrice > 0 ? doc.finalPrice : quoteGrand;
  const lines = statementsForQuote(doc, expenses); // this quote's payments, newest first (incl. legacy)
  const received = r2(lines.reduce((s, l) => s + l.amount, 0));
  const balance = r2(finalPrice - received);
  const settled = balance <= 0.5;

  async function addLine() {
    const a = Math.max(0, +amt || 0);
    if (a <= 0) return;
    const isUpiMode = mode === "upi" || mode === "uowner";
    if (mode === "upi" && !acct.trim()) return toast("Pick the UPI account");
    const isCash = !isUpiMode;
    // "to owner" = money that leaves the manager's daybook / collectable balance:
    // Cash → Owner, UPI → Owner, or any cash the owner records themselves.
    const toOwner = isUpiMode ? mode === "uowner" : mode === "owner" || isOwner;
    await addExpense({
      type: "sale",
      amount: a,
      mode: isUpiMode ? "upi" : "cash",
      // UPI → Owner needs no account (goes straight to the owner, not a collectable account)
      account: mode === "upi" || (isCash && mode !== "owner") ? acct.trim() : "",
      toOwner,
      note: (doc.customerName || "Walk-in") + " · " + doc.number,
      label: isCash ? note.trim() : "",
      date: payDate ? toDmy(payDate) : undefined,
      enteredBy: by,
      sourceId: doc.id,
    });
    setAggregates(r2((doc.payCash || 0) + (isCash ? a : 0)), r2((doc.payUpi || 0) + (isUpiMode ? a : 0)));
    setAmt("");
    setAcct("");
    setNote("");
    setPayDate("");
    reload();
    bumpData();
    const acctLbl = acct.trim() ? " · " + acct.trim() : "";
    toast(
      "₹" +
        inr(a) +
        " recorded" +
        (isUpiMode
          ? acctLbl + (mode === "uowner" ? " · to owner" : "")
          : toOwner
            ? " · to owner"
            : acct.trim()
              ? acctLbl + " (Accounts)"
              : " · cash → Daybook"),
    );
  }

  async function delLine(l: PartyStatement) {
    // synthetic lines ("from quote record") have no backing expense — they live only in the quote's
    // payCash/payUpi totals, so just reduce those aggregates (no expense to delete).
    if (!l.synthetic) {
      await delRec("expenses", l.id);
      await cloudDelete("expenses", l.id);
    }
    setAggregates(
      Math.max(0, r2((doc.payCash || 0) - (l.mode === "cash" ? l.amount : 0))),
      Math.max(0, r2((doc.payUpi || 0) - (l.mode === "upi" ? l.amount : 0))),
    );
    reload();
    bumpData();
    toast("Payment removed");
  }

  // load a recorded payment into the row form for editing
  function startEdit(l: PartyStatement) {
    setEditId(l.id);
    setAmt(String(l.amount));
    setMode(l.mode === "upi" ? (l.toOwner ? "uowner" : "upi") : l.toOwner ? "owner" : "cash");
    setAcct(l.account || "");
    setNote(l.note || "");
    setPayDate(l.date ? fromDmy(l.date) : "");
  }
  function cancelEdit() {
    setEditId(null);
    setAmt("");
    setAcct("");
    setNote("");
    setPayDate("");
    setMode("cash");
  }
  async function saveEdit() {
    const old = lines.find((l) => l.id === editId);
    if (!old) return cancelEdit();
    const a = Math.max(0, +amt || 0);
    if (a <= 0) return;
    const isUpiMode = mode === "upi" || mode === "uowner";
    if (mode === "upi" && !acct.trim() && !old.synthetic) return toast("Pick the UPI account");
    const isCash = !isUpiMode;
    const e = await getRec<Expense>("expenses", old.id);
    if (!e) {
      // synthetic line (from the quote's own payCash/payUpi, no expense) — adjust the aggregates directly
      const nextCash = Math.max(0, r2((doc.payCash || 0) - (old.mode === "cash" ? old.amount : 0) + (isCash ? a : 0)));
      const nextUpi = Math.max(0, r2((doc.payUpi || 0) - (old.mode === "upi" ? old.amount : 0) + (isUpiMode ? a : 0)));
      setAggregates(nextCash, nextUpi);
      cancelEdit();
      reload();
      bumpData();
      toast("Payment updated");
      return;
    }
    e.amount = a;
    e.mode = isUpiMode ? "upi" : "cash";
    e.account = mode === "upi" || (isCash && mode !== "owner") ? acct.trim() : "";
    e.toOwner = isUpiMode ? mode === "uowner" : mode === "owner" || isOwner;
    e.label = isCash ? note.trim() : "";
    e.date = payDate ? toDmy(payDate) : e.date;
    e.updatedAt = nowIso();
    e.synced = false;
    await put("expenses", e);
    // aggregate delta: drop the old contribution, add the new
    const nextCash = Math.max(0, r2((doc.payCash || 0) - (old.mode === "cash" ? old.amount : 0) + (isCash ? a : 0)));
    const nextUpi = Math.max(0, r2((doc.payUpi || 0) - (old.mode === "upi" ? old.amount : 0) + (isUpiMode ? a : 0)));
    setAggregates(nextCash, nextUpi);
    cancelEdit();
    reload();
    bumpData();
    toast("Payment updated");
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
          <div className={"pb-r" + (editId === l.id ? " pb-editing" : "")} key={l.id}>
            <span className="pb-amt">₹ {inr(l.amount)}</span>
            <span className="pb-mode">{l.mode === "upi" ? (l.toOwner ? "UPI → Owner" : "UPI") : l.toOwner ? "Cash → Owner" : "Cash"}</span>
            <span className="pb-acct">
              {l.mode === "upi" ? l.account || "—" : l.account ? l.account + (l.note ? " · " + l.note : "") : l.note || "Daybook"}
            </span>
            <span className="pb-when">
              {l.synthetic ? "from quote record" : l.date + (hhmm(l.at) ? " " + hhmm(l.at) : "") + " · " + userName(l.by)}
            </span>
            <span className="pb-rowacts">
              <button className="pb-x" title="Edit payment" onClick={() => startEdit(l)}>✎</button>
              <button className="pb-x" title="Delete payment" onClick={() => delLine(l)}>×</button>
            </span>
          </div>
        ))}

        {editId && (
          <div className="pb-editbar no-print">
            <span>Editing this payment</span>
            <button type="button" onClick={cancelEdit}>Cancel</button>
          </div>
        )}

        {(!settled || editId) && (
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
                  editId ? saveEdit() : addLine();
                }
              }}
            />
            <select className="pb-sel" value={mode} onChange={(e) => setMode(e.target.value as "cash" | "owner" | "upi" | "uowner")}>
              <option value="cash">Cash</option>
              <option value="owner">Cash → Owner</option>
              <option value="upi">UPI</option>
              <option value="uowner">UPI → Owner</option>
            </select>
            {mode === "owner" || mode === "uowner" ? (
              <span className="pb-in" style={{ color: "var(--ink-faint)", fontSize: 13 }}>—</span>
            ) : (
              <AccountPicker value={acct} onChange={setAcct} accounts={upiAccts} />
            )}
            <input
              className="pb-in"
              type="date"
              title="When did this payment happen? (optional — defaults to today)"
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
            />
            <button
              className="pb-plus"
              type="button"
              title={editId ? "Save changes" : "Add payment"}
              onClick={editId ? saveEdit : addLine}
              disabled={!(+amt > 0)}
            >
              {editId ? "✓" : "+"}
            </button>
          </div>
        )}
        {(!settled || editId) && mode === "cash" && (
          <div className="pb-r pb-note">
            <input
              className="pb-in"
              type="text"
              placeholder="Cash note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ gridColumn: "1 / -1" }}
            />
          </div>
        )}

        <div className="pb-r pb-foot">
          <span className="pb-amt">₹ {inr(received)}</span>
          <span className="pb-mode" style={{ gridColumn: "2 / 4", color: "var(--ink-faint)" }}>
            received of ₹{inr(finalPrice)}
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
