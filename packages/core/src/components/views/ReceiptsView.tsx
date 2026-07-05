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
const r2 = (n: number) => Math.round(n * 100) / 100;

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
  const [openCust, setOpenCust] = useState<string | null>(null);

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
  const custName = (id?: string) => customers.find((c) => c.id === id)?.name || "—";

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

  // group every receipt under its customer
  const byCust = new Map<string, Expense[]>();
  expenses
    .filter((e) => e.type === "sale" && !!e.custId)
    .forEach((e) => {
      const arr = byCust.get(e.custId!) || [];
      arr.push(e);
      byCust.set(e.custId!, arr);
    });
  const groups = [...byCust.entries()]
    .map(([cid, list]) => ({
      cid,
      name: custName(cid),
      total: r2(list.reduce((s, e) => s + (+e.amount || 0), 0)),
      list: list.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")),
    }))
    .sort((a, b) => b.total - a.total);

  return (
    <div>
      <div className="sectitle">
        Receipts <small>— record a payment from a customer</small>
      </div>

      {/* record form — one field per line group, roomy */}
      <div className="panel-card" style={{ padding: 16 }}>
        <label className="modal-field" style={{ width: "100%" }}>
          <span>Customer</span>
          <CustomerPicker value={name} customers={customers} onType={onType} onPick={pickCustomer} placeholder="Search an existing customer…" />
        </label>

        {picked && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "10px 0 4px" }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 13 }}>
              Outstanding: <b style={{ color: outstanding > 0.5 ? "var(--danger)" : "var(--green)" }}>₹ {inr(outstanding)}</b>
            </span>
            {outstanding > 0.5 && (
              <button className="btn sm" type="button" onClick={() => setAmt(String(r2(outstanding)))}>
                Pay full
              </button>
            )}
          </div>
        )}

        <div className="rec-grid">
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
          <label className="modal-field">
            <span>Date (optional)</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>

        {mode === "upi" && (
          <div className="modal-field acct-field" style={{ marginTop: 12, width: "100%" }}>
            <span>UPI to which account?</span>
            <AccountPicker value={acct} onChange={setAcct} accounts={upiAccts} />
          </div>
        )}

        <button className="btn primary" type="button" onClick={record} style={{ width: "100%", justifyContent: "center", marginTop: 14, padding: 12 }}>
          Record receipt
        </button>
      </div>

      <div className="sectitle" style={{ marginTop: 24, fontSize: 22 }}>
        By customer <small>— {groups.length}</small>
      </div>
      {groups.length ? (
        groups.map((g) => {
          const open = openCust === g.cid;
          return (
            <div className="panel-card" key={g.cid}>
              <div
                className="pc-head"
                style={{ justifyContent: "space-between", cursor: "pointer" }}
                onClick={() => setOpenCust(open ? null : g.cid)}
              >
                <span>
                  <span className="um-caret" style={{ marginRight: 6 }}>{open ? "▾" : "▸"}</span>
                  {g.name}
                </span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 12, textTransform: "none", letterSpacing: 0 }}>
                  ₹{inr(g.total)} · {g.list.length} receipt{g.list.length === 1 ? "" : "s"}
                </span>
              </div>
              {open &&
                g.list.map((e) => (
                  <div className="stmt" key={e.id}>
                    <div className={"stmt-ic " + (e.mode === "upi" ? "upi" : "cash")}>{e.mode === "upi" ? "UPI" : "₹"}</div>
                    <div className="stmt-main">
                      <div className="stmt-to">{e.mode === "upi" ? e.account || "UPI" : e.toOwner ? "Cash → Owner" : "Cash"}</div>
                      <div className="stmt-sub">
                        {e.date} · by {userName(e.enteredBy)}
                      </div>
                    </div>
                    <div className="stmt-amt">+₹{inr(e.amount)}</div>
                  </div>
                ))}
            </div>
          );
        })
      ) : (
        <div className="panel-card">
          <div className="empty">No receipts recorded yet.</div>
        </div>
      )}
    </div>
  );
}
