"use client";
import { useCallback, useEffect, useState } from "react";
import { allRec } from "@/lib/db";
import { inr } from "@/lib/calc";
import { addExpense, upiAccounts } from "@/lib/expenses";
import { partyLedger } from "@/lib/payments";
import { USERS } from "@/lib/local-auth";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import AccountPicker from "@/components/AccountPicker";
import CustomerPicker from "@/components/editor/CustomerPicker";
import type { Customer, Doc, Expense } from "@/lib/types";

const userName = (id: string) => USERS.find((u) => u.id === id)?.name || id || "—";
const toDmy = (v: string) => {
  const [y, m, d] = (v || "").split("-");
  return d && m && y ? `${d}-${m}-${y.slice(2)}` : "";
};

export default function ReceiptsView() {
  const { ready, dataVersion, user } = useApp();
  const isOwner = user?.role === "owner";
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [quotes, setQuotes] = useState<Doc[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [upiAccts, setUpiAccts] = useState<string[]>([]);
  const [picked, setPicked] = useState<Customer | null>(null);
  const [name, setName] = useState("");
  const [amt, setAmt] = useState("");
  const [mode, setMode] = useState<"cash" | "owner" | "upi">("cash");
  const [acct, setAcct] = useState("");
  const [date, setDate] = useState("");

  const load = useCallback(() => {
    Promise.all([allRec<Customer>("customers"), allRec<Doc>("quotations"), allRec<Expense>("expenses")]).then(
      ([c, q, e]) => {
        setCustomers(c);
        setQuotes(q);
        setExpenses(e);
      },
    );
    upiAccounts().then(setUpiAccts);
  }, []);
  useEffect(() => {
    if (ready) load();
  }, [ready, dataVersion, load]);

  const ledger = partyLedger(quotes, expenses, customers);
  const party = picked ? ledger.parties.find((p) => p.custId === picked.id) : null;
  const outstanding = party ? party.balance : picked?.opening || 0;

  function pickCustomer(c: Customer) {
    setPicked(c);
    setName(c.name);
  }
  function onType(v: string) {
    setName(v);
    setPicked(null);
  }

  async function record() {
    if (!picked) return toast("Pick an existing customer");
    const a = Math.max(0, +amt || 0);
    if (a <= 0) return toast("Enter an amount");
    if (mode === "upi" && !acct.trim()) return toast("Pick the UPI account");
    const isCash = mode !== "upi";
    const toOwner = isCash && (mode === "owner" || isOwner);
    await addExpense({
      type: "sale",
      amount: a,
      mode: isCash ? "cash" : "upi",
      account: mode === "upi" ? acct.trim() : "",
      toOwner,
      custId: picked.id,
      note: picked.name,
      date: date ? toDmy(date) : undefined,
      enteredBy: user?.id || "unknown",
    });
    setAmt("");
    setAcct("");
    setDate("");
    load();
    bumpData();
    toast(
      "₹" + inr(a) + " received from " + picked.name + (mode === "upi" ? " · " + acct.trim() : toOwner ? " · to owner" : " · cash → Daybook"),
    );
  }

  const recent = expenses
    .filter((e) => e.type === "sale" && !!e.custId)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    .slice(0, 10);
  const custName = (id?: string) => customers.find((c) => c.id === id)?.name || "—";

  return (
    <div>
      <div className="sectitle">
        Receipts <small>— record a payment from a customer</small>
      </div>

      <div className="panel-card db-entry">
        <label className="modal-field" style={{ flexBasis: "100%" }}>
          <span>Customer</span>
          <CustomerPicker value={name} customers={customers} onType={onType} onPick={pickCustomer} placeholder="Search an existing customer…" />
        </label>

        {picked && (
          <div style={{ flexBasis: "100%", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 13 }}>
              Outstanding:{" "}
              <b style={{ color: outstanding > 0.5 ? "var(--danger)" : "var(--green)" }}>₹ {inr(outstanding)}</b>
            </span>
            {outstanding > 0.5 && (
              <button className="btn sm" type="button" onClick={() => setAmt(String(Math.round(outstanding * 100) / 100))}>
                Pay full
              </button>
            )}
          </div>
        )}

        <label className="modal-field">
          <span>Amount ₹</span>
          <input type="number" inputMode="decimal" placeholder="0" value={amt} onChange={(e) => setAmt(e.target.value)} />
        </label>
        <label className="modal-field">
          <span>Mode</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as "cash" | "owner" | "upi")}>
            <option value="cash">Cash</option>
            <option value="owner">Cash → Owner</option>
            <option value="upi">UPI</option>
          </select>
        </label>
        {mode === "upi" && (
          <div className="modal-field acct-field">
            <span>UPI to which account?</span>
            <AccountPicker value={acct} onChange={setAcct} accounts={upiAccts} />
          </div>
        )}
        <label className="modal-field">
          <span>Date (optional)</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button className="btn primary" type="button" onClick={record}>
          Record receipt
        </button>
      </div>

      <div className="sectitle" style={{ marginTop: 24, fontSize: 22 }}>
        Recent receipts <small>— {recent.length}</small>
      </div>
      <div className="panel-card">
        {recent.length ? (
          recent.map((e) => (
            <div className="stmt" key={e.id}>
              <div className={"stmt-ic " + (e.mode === "upi" ? "upi" : "cash")}>{e.mode === "upi" ? "UPI" : "₹"}</div>
              <div className="stmt-main">
                <div className="stmt-to">{custName(e.custId)}</div>
                <div className="stmt-sub">
                  {e.mode === "upi" ? e.account || "UPI" : e.toOwner ? "Cash → Owner" : "Cash"} · {e.date} · by {userName(e.enteredBy)}
                </div>
              </div>
              <div className="stmt-amt">+₹{inr(e.amount)}</div>
            </div>
          ))
        ) : (
          <div className="empty">No receipts recorded yet.</div>
        )}
      </div>
    </div>
  );
}
