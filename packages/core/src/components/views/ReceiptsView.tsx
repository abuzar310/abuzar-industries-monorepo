"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec, delRec, getRec, put } from "@/lib/db";
import { cloudDelete } from "@/lib/cloud";
import { inr, nowIso } from "@/lib/calc";
import { addExpense, upiAccounts } from "@/lib/expenses";
import { partyLedger } from "@/lib/payments";
import { applyCustomerReceipt } from "@/lib/receipts";
import { snapshotBefore } from "@/lib/autobackup";
import { USERS } from "@/lib/local-auth";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import AccountPicker from "@/components/AccountPicker";
import CustomerPicker from "@/components/editor/CustomerPicker";
import type { Customer, Doc, Expense } from "@/lib/types";

const userName = (id: string) => USERS.find((u) => u.id === id)?.name || id || "—";
const toDmy = (v: string) => {
  const [y, m, d] = (v || "").split("-");
  return d && m && y ? `${d}-${m}-${y.slice(2)}` : "";
};
const fromDmy = (v: string) => {
  const [d, m, y] = (v || "").split("-");
  return d && m && y ? `20${y}-${m}-${d}` : "";
};
const r2 = (n: number) => Math.round(n * 100) / 100;

type Kind = "received" | "due";

export default function ReceiptsView() {
  const { ready, dataVersion, user } = useApp();
  const router = useRouter();
  const isOwner = user?.role === "owner";
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [quotes, setQuotes] = useState<Doc[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [upiAccts, setUpiAccts] = useState<string[]>([]);
  const [picked, setPicked] = useState<Customer | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("received");
  const [amt, setAmt] = useState("");
  const [mode, setMode] = useState<"cash" | "owner" | "upi" | "uowner">("cash");
  const [acct, setAcct] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [openCust, setOpenCust] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);

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
  function resetForm() {
    setAmt("");
    setAcct("");
    setNote("");
    setDate("");
    setMode("cash");
    setEditId(null);
  }

  async function record() {
    if (!picked) return toast("Pick an existing customer");
    const a = Math.max(0, +amt || 0);
    if (a <= 0) return toast("Enter an amount");

    if (editId) {
      const e = await getRec<Expense>("expenses", editId);
      if (!e || e.custId !== picked.id) return resetForm();
      if (e.charge) {
        e.amount = a;
        e.label = note.trim() || picked.name;
        e.date = date ? toDmy(date) : e.date;
      } else {
        const isUpiMode = mode === "upi" || mode === "uowner";
        if (mode === "upi" && !acct.trim()) return toast("Pick the UPI account");
        const isCash = !isUpiMode;
        e.amount = a;
        e.mode = isUpiMode ? "upi" : "cash";
        e.account = mode === "upi" || (isCash && mode !== "owner") ? acct.trim() : "";
        e.toOwner = isUpiMode ? mode === "uowner" : mode === "owner" || isOwner;
        e.label = isCash ? note.trim() : "";
        e.date = date ? toDmy(date) : e.date;
      }
      e.updatedAt = nowIso();
      e.synced = false;
      await put("expenses", e);
      resetForm();
      load();
      bumpData();
      return toast("Updated ✓");
    }

    if (kind === "due") {
      await addExpense({
        type: "sale",
        amount: a,
        mode: "cash",
        charge: true,
        custId: picked.id,
        note: note.trim() || picked.name,
        date: date ? toDmy(date) : undefined,
        enteredBy: user?.id || "unknown",
      });
      resetForm();
      load();
      bumpData();
      return toast("₹" + inr(a) + " due added for " + picked.name);
    }

    const isUpiMode = mode === "upi" || mode === "uowner";
    if (mode === "upi" && !acct.trim()) return toast("Pick the UPI account");
    const isCash = !isUpiMode;
    const toOwner = isUpiMode ? mode === "uowner" : mode === "owner" || isOwner;
    // apply the receipt across the customer's open quotations (oldest first); leftover → account credit
    const { applied, leftover } = await applyCustomerReceipt({
      custId: picked.id,
      custName: picked.name,
      amount: a,
      mode: isUpiMode ? "upi" : "cash",
      // UPI → Owner needs no account (straight to the owner, not a collectable account)
      account: mode === "upi" || (isCash && mode !== "owner") ? acct.trim() : "",
      toOwner,
      note: isCash ? note.trim() : "",
      date: date ? toDmy(date) : undefined,
      enteredBy: user?.id || "unknown",
    });
    resetForm();
    load();
    bumpData();
    const nq = applied.length;
    const msg =
      nq > 0
        ? "₹" + inr(a) + " received from " + picked.name + " · applied to " + nq + " quote" + (nq === 1 ? "" : "s") +
          (leftover > 0.5 ? " · ₹" + inr(leftover) + " to account" : "")
        : "₹" + inr(a) + " received from " + picked.name +
          (isUpiMode
            ? (acct.trim() ? " · " + acct.trim() : "") + (mode === "uowner" ? " · to owner" : "")
            : toOwner
              ? " · to owner"
              : " · to account");
    toast(msg);
  }

  async function remove(e: Expense) {
    const label = e.charge ? "due" : "receipt";
    const ok = await confirmDialog({
      title: "Delete " + label + "?",
      message: custName(e.custId) + " — ₹" + inr(e.amount) + (e.charge ? "" : " · " + (e.mode === "upi" ? e.account || "UPI" : e.toOwner ? "Cash → Owner" : "Cash")),
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await snapshotBefore();
    await delRec("expenses", e.id);
    await cloudDelete("expenses", e.id);
    if (editId === e.id) resetForm();
    load();
    bumpData();
    toast(label.charAt(0).toUpperCase() + label.slice(1) + " removed");
  }

  function startEdit(e: Expense) {
    setEditId(e.id);
    setKind(e.charge ? "due" : "received");
    setAmt(String(e.amount));
    setMode(e.charge ? "cash" : e.mode === "upi" ? (e.toOwner ? "uowner" : "upi") : e.toOwner ? "owner" : "cash");
    setAcct(e.account || "");
    setNote(e.charge ? e.note || "" : e.label || "");
    setDate(e.date ? fromDmy(e.date) : "");
    const c = customers.find((x) => x.id === e.custId);
    if (c) {
      setPicked(c);
      setName(c.name);
    }
  }

  // group every money event under its customer: account receipts/dues (custId, editable here)
  // AND quote payments (sourceId → the quote's customer, shown read-only with a link to the quote,
  // so a receipt applied to quotations still appears under the customer here).
  const quoteById = new Map(quotes.map((q) => [q.id, q] as const));
  interface Entry {
    e: Expense;
    quoteNo?: string;
    quoteId?: string;
    locked: boolean;
  }
  const byCust = new Map<string, Entry[]>();
  expenses
    .filter((e) => e.type === "sale")
    .forEach((e) => {
      let cid = e.custId || "";
      let entry: Entry | null = null;
      if (cid) {
        entry = { e, locked: false };
      } else if (e.sourceId) {
        const q = quoteById.get(e.sourceId);
        if (q && q.customerId) {
          cid = q.customerId;
          entry = { e, quoteNo: q.number, quoteId: q.id, locked: true };
        }
      }
      if (!cid || !entry) return;
      const arr = byCust.get(cid) || [];
      arr.push(entry);
      byCust.set(cid, arr);
    });
  const groups = [...byCust.entries()]
    .map(([cid, list]) => {
      const sorted = list.sort((a, b) => (b.e.createdAt || "").localeCompare(a.e.createdAt || ""));
      const received = sorted.filter((x) => !x.e.charge);
      const dues = sorted.filter((x) => x.e.charge);
      return {
        cid,
        name: custName(cid),
        received: r2(received.reduce((s, x) => s + (+x.e.amount || 0), 0)),
        dueAdded: r2(dues.reduce((s, x) => s + (+x.e.amount || 0), 0)),
        list: sorted,
      };
    })
    .sort((a, b) => b.received + b.dueAdded - (a.received + a.dueAdded));

  const editing = !!editId;
  const showReceivedFields = kind === "received";

  return (
    <div>
      <div className="sectitle">
        Receipts <small>— record a payment or add a due</small>
      </div>

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
            {outstanding > 0.5 && kind === "received" && !editing && (
              <button className="btn sm" type="button" onClick={() => setAmt(String(r2(outstanding)))}>
                Pay full
              </button>
            )}
          </div>
        )}

        <div className="db-seg sm" style={{ margin: "12px 0 14px" }}>
          <button className={"seg-btn" + (kind === "received" ? " on" : "")} type="button" onClick={() => setKind("received")} disabled={editing}>
            Received
          </button>
          <button className={"seg-btn" + (kind === "due" ? " on" : "")} type="button" onClick={() => setKind("due")} disabled={editing}>
            Add due
          </button>
        </div>

        <div className={"rec-grid" + (showReceivedFields ? "" : " rec-grid-due")}>
          <label className="modal-field">
            <span>Amount ₹</span>
            <input type="number" inputMode="decimal" placeholder="0" value={amt} onChange={(e) => setAmt(e.target.value)} />
          </label>
          {showReceivedFields ? (
            <label className="modal-field">
              <span>Mode</span>
              <select value={mode} onChange={(e) => setMode(e.target.value as "cash" | "owner" | "upi" | "uowner")}>
                <option value="cash">Cash</option>
                <option value="owner">Cash → Owner</option>
                <option value="upi">UPI</option>
                <option value="uowner">UPI → Owner</option>
              </select>
            </label>
          ) : (
            <label className="modal-field">
              <span>Note (optional)</span>
              <input type="text" placeholder="e.g. timber order" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          )}
          <label className="modal-field">
            <span>Date (optional)</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>

        {showReceivedFields && mode === "upi" && (
          <div className="modal-field acct-field" style={{ marginTop: 12, width: "100%" }}>
            <span>UPI to which account?</span>
            <AccountPicker value={acct} onChange={setAcct} accounts={upiAccts} />
          </div>
        )}
        {showReceivedFields && mode === "cash" && (
          <>
            <div className="modal-field acct-field" style={{ marginTop: 12, width: "100%" }}>
              <span>Cash held by which account? <small style={{ color: "var(--ink-faint)" }}>(optional — blank = manager daybook)</small></span>
              <AccountPicker value={acct} onChange={setAcct} accounts={upiAccts} />
            </div>
            <label className="modal-field" style={{ marginTop: 12, width: "100%" }}>
              <span>Cash note (optional)</span>
              <input type="text" placeholder="e.g. partial payment" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </>
        )}
        {showReceivedFields && mode === "owner" && (
          <label className="modal-field" style={{ marginTop: 12, width: "100%" }}>
            <span>Note (optional)</span>
            <input type="text" placeholder="e.g. handed to owner" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        )}

        {editing && (
          <div className="pb-editbar no-print" style={{ marginTop: 12 }}>
            <span>Editing this {kind === "due" ? "due" : "receipt"}</span>
            <button type="button" onClick={resetForm}>
              Cancel
            </button>
          </div>
        )}

        <button className="btn primary" type="button" onClick={record} style={{ width: "100%", justifyContent: "center", marginTop: 14, padding: 12 }}>
          {editing ? "Save changes" : kind === "due" ? "Add due" : "Record receipt"}
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
                  <span className="um-caret" style={{ marginRight: 6 }}>
                    {open ? "▾" : "▸"}
                  </span>
                  {g.name}
                </span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 12, textTransform: "none", letterSpacing: 0 }}>
                  {g.received > 0 && <>₹{inr(g.received)} received</>}
                  {g.received > 0 && g.dueAdded > 0 && " · "}
                  {g.dueAdded > 0 && <span style={{ color: "var(--danger)" }}>₹{inr(g.dueAdded)} due</span>}
                  {" · "}
                  {g.list.length} {g.list.length === 1 ? "entry" : "entries"}
                </span>
              </div>
              {open &&
                g.list.map(({ e, quoteNo, quoteId, locked }) => (
                  <div className={"stmt" + (editId === e.id ? " pb-editing" : "")} key={e.id}>
                    <div className={"stmt-ic " + (e.charge ? "due" : e.mode === "upi" ? "upi" : "cash")}>{e.charge ? "Due" : e.mode === "upi" ? "UPI" : "₹"}</div>
                    <div className="stmt-main">
                      <div className="stmt-to">
                        {e.charge
                          ? e.note || "Due added"
                          : locked
                            ? "On quote #" + quoteNo + (e.mode === "upi" ? " · UPI" + (e.account ? " · " + e.account : "") : " · Cash")
                            : e.mode === "upi"
                              ? e.account || "UPI"
                              : e.account
                                ? e.account + (e.label ? " · " + e.label : "")
                                : e.toOwner
                                  ? "Cash → Owner"
                                  : e.label || "Cash · Daybook"}
                      </div>
                      <div className="stmt-sub">
                        {e.date} · by {userName(e.enteredBy)}
                      </div>
                    </div>
                    <div className={"stmt-amt" + (e.charge ? " due" : "")}>+₹{inr(e.amount)}</div>
                    <span className="pb-rowacts">
                      {locked ? (
                        <button className="pb-x" title="Open quotation" type="button" onClick={() => router.push("/editor/" + quoteId)}>
                          ↗
                        </button>
                      ) : (
                        <>
                          <button className="pb-x" title="Edit" type="button" onClick={() => startEdit(e)}>
                            ✎
                          </button>
                          <button className="pb-x" title="Delete" type="button" onClick={() => remove(e)}>
                            ×
                          </button>
                        </>
                      )}
                    </span>
                  </div>
                ))}
            </div>
          );
        })
      ) : (
        <div className="panel-card">
          <div className="empty">No receipts or dues recorded yet.</div>
        </div>
      )}
    </div>
  );
}
