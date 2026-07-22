"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec, getRec, put } from "@/lib/data";
import { inr, nowIso } from "@/lib/calc";
import { addExpense, upiAccounts } from "@/lib/expenses";
import { listWorkers, payWorker, repayWorker, type Worker } from "@/lib/attendance";
import { partyLedger } from "@/lib/payments";
import { applyCustomerReceipt, unwindReceiptPieces } from "@/lib/receipts";
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
  /** editing a whole receipt (possibly split across quotes): its pieces get unwound + re-applied on save */
  const [editRcpt, setEditRcpt] = useState<{ id: string; pieces: Expense[] } | null>(null);
  /** where a received amount goes: waterfall over open quotations, or straight onto the account (old dues) */
  const [applyTo, setApplyTo] = useState<"quotes" | "account">("quotes");
  // worker salary-account quick panel
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [showWkr, setShowWkr] = useState(false);
  const [wkrId, setWkrId] = useState("");
  const [wKind, setWKind] = useState<"give" | "repay">("give");
  const [wAmt, setWAmt] = useState("");
  const [wDate, setWDate] = useState("");
  const [wNote, setWNote] = useState("");
  /** whose cash moved (null = default to the logged-in role) */
  const [wBy, setWBy] = useState<"owner" | "manager" | null>(null);

  const load = useCallback(() => {
    Promise.all([allRec<Customer>("customers"), allRec<Doc>("quotations"), allRec<Expense>("expenses")]).then(
      ([c, q, e]) => {
        setCustomers(c);
        setQuotes(q);
        setExpenses(e);
      },
    );
    upiAccounts().then(setUpiAccts);
    listWorkers().then(setWorkers);
  }, []);
  useEffect(() => {
    if (ready) load();
  }, [ready, dataVersion, load]);

  // arrived from Accounts (a receipt line) → auto-open that customer's group
  useEffect(() => {
    const cust = new URLSearchParams(window.location.search).get("cust");
    if (cust) setOpenCust(cust);
  }, []);

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
    setEditRcpt(null);
    setApplyTo("quotes");
  }

  async function record() {
    if (!picked) return toast("Pick an existing customer");
    const a = Math.max(0, +amt || 0);
    if (a <= 0) return toast("Enter an amount");

    if (editRcpt) {
      // safest edit of a receipt: unwind every old piece (rolling quote totals back),
      // then re-apply the corrected amount fresh — money can never be double-counted
      const isUpiMode = mode === "upi" || mode === "uowner";
      if (mode === "upi" && !acct.trim()) return toast("Pick the UPI account");
      const isCash = !isUpiMode;
      await unwindReceiptPieces(editRcpt.pieces);
      await applyCustomerReceipt({
        custId: picked.id,
        custName: picked.name,
        amount: a,
        mode: isUpiMode ? "upi" : "cash",
        account: mode === "upi" || (isCash && mode !== "owner") ? acct.trim() : "",
        toOwner: isUpiMode ? mode === "uowner" : mode === "owner" || isOwner,
        note: note.trim(),
        date: date ? toDmy(date) : editRcpt.pieces[0]?.date,
        toAccount: applyTo === "account",
        enteredBy: user?.id || "unknown",
      });
      resetForm();
      load();
      bumpData();
      return toast("Receipt updated ✓");
    }

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
        e.label = note.trim();
        e.date = date ? toDmy(date) : e.date;
      }
      e.updatedAt = nowIso();
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
      note: note.trim(),
      date: date ? toDmy(date) : undefined,
      toAccount: applyTo === "account",
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

  async function remove(entry: Entry) {
    const { e, pieces, settled } = entry;
    const label = e.charge ? "due" : "receipt";
    const total = pieces ? r2(pieces.reduce((s, x) => s + (+x.amount || 0), 0)) : +e.amount || 0;
    const ok = await confirmDialog({
      title: "Delete " + label + "?",
      message:
        custName(entry.cid) + " — ₹" + inr(total) +
        (e.charge ? "" : " · " + (e.mode === "upi" ? e.account || "UPI" : e.toOwner ? "Cash → Owner" : "Cash")) +
        (settled ? "\nThis receipt " + settled + " — those quotations go back to due." : ""),
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    // pieces linked to quotations roll the quote's paid totals back before the soft delete
    await unwindReceiptPieces(pieces || [e]);
    if (editId === e.id || (editRcpt && pieces && editRcpt.id === entry.key)) resetForm();
    load();
    bumpData();
    toast(label.charAt(0).toUpperCase() + label.slice(1) + " removed");
  }

  function startEdit(entry: Entry) {
    const { e, pieces } = entry;
    if (pieces) {
      // a whole receipt (possibly split over quotes): edit re-applies it fresh on save
      setEditRcpt({ id: entry.key, pieces });
      setEditId(null);
      setKind("received");
      setAmt(String(r2(pieces.reduce((s, x) => s + (+x.amount || 0), 0))));
      setApplyTo(pieces.some((x) => !!x.sourceId) ? "quotes" : "account");
    } else {
      setEditId(e.id);
      setEditRcpt(null);
      setKind(e.charge ? "due" : "received");
      setAmt(String(e.amount));
    }
    setMode(e.charge ? "cash" : e.mode === "upi" ? (e.toOwner ? "uowner" : "upi") : e.toOwner ? "owner" : "cash");
    setAcct(e.account || "");
    setNote(e.charge ? e.note || "" : e.label || "");
    setDate(e.date ? fromDmy(e.date) : "");
    const c = customers.find((x) => x.id === entry.cid);
    if (c) {
      setPicked(c);
      setName(c.name);
    }
  }

  // group every money event under its customer: account receipts/dues (custId, editable here)
  // AND quote payments (sourceId → the quote's customer). Pieces of ONE receipt (same rcptId)
  // are shown merged as the single amount the customer handed over — editable/deletable as a whole.
  const quoteById = new Map(quotes.map((q) => [q.id, q] as const));
  interface Entry {
    key: string; // stable render key: rcptId for merged receipts, expense id otherwise
    cid: string;
    e: Expense; // representative piece (display: mode/account/note/date/by)
    amount: number;
    /** all pieces of a merged receipt — present ⇒ editable via unwind + re-apply */
    pieces?: Expense[];
    /** "settled #12, #14 + account" text for merged receipts */
    settled?: string;
    quoteNo?: string;
    quoteId?: string;
    locked: boolean;
  }
  const byCust = new Map<string, Entry[]>();
  const rcptGroups = new Map<string, { cid: string; pieces: Expense[] }>();
  expenses
    .filter((e) => e.type === "sale")
    .forEach((e) => {
      const q = e.sourceId ? quoteById.get(e.sourceId) : undefined;
      const cid = e.custId || q?.customerId || "";
      if (!cid) return;
      if (e.rcptId && !e.charge) {
        // piece of a receipt recorded on this tab — collect, merge below
        const g = rcptGroups.get(e.rcptId) || { cid, pieces: [] };
        g.pieces.push(e);
        rcptGroups.set(e.rcptId, g);
        return;
      }
      const entry: Entry = e.custId
        ? { key: e.id, cid, e, amount: +e.amount || 0, locked: false }
        : { key: e.id, cid, e, amount: +e.amount || 0, quoteNo: q!.number, quoteId: q!.id, locked: true };
      const arr = byCust.get(cid) || [];
      arr.push(entry);
      byCust.set(cid, arr);
    });
  for (const [rid, g] of rcptGroups) {
    const pieces = g.pieces.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    const quoteNos = pieces.map((x) => (x.sourceId ? quoteById.get(x.sourceId)?.number || "" : "")).filter(Boolean);
    const onAccount = pieces.some((x) => !x.sourceId);
    const settled =
      (quoteNos.length ? "settled #" + quoteNos.join(", #") : "") +
      (onAccount ? (quoteNos.length ? " + account" : "on account") : "");
    const arr = byCust.get(g.cid) || [];
    arr.push({
      key: rid,
      cid: g.cid,
      e: pieces.find((x) => !x.sourceId) || pieces[0],
      amount: r2(pieces.reduce((s, x) => s + (+x.amount || 0), 0)),
      pieces,
      settled,
      locked: false,
    });
    byCust.set(g.cid, arr);
  }
  const groups = [...byCust.entries()]
    .map(([cid, list]) => {
      const sorted = list.sort((a, b) => (b.e.createdAt || "").localeCompare(a.e.createdAt || ""));
      const received = sorted.filter((x) => !x.e.charge);
      const dues = sorted.filter((x) => x.e.charge);
      return {
        cid,
        name: custName(cid),
        received: r2(received.reduce((s, x) => s + x.amount, 0)),
        dueAdded: r2(dues.reduce((s, x) => s + x.amount, 0)),
        list: sorted,
      };
    })
    .sort((a, b) => b.received + b.dueAdded - (a.received + a.dueAdded));

  const editing = !!editId || !!editRcpt;
  const showReceivedFields = kind === "received";
  const activeWorkers = workers.filter((w) => w.active).sort((a, b) => a.name.localeCompare(b.name));

  async function recordWorker() {
    const w = activeWorkers.find((x) => x.id === wkrId);
    if (!w) return toast("Pick a worker");
    const a = Math.max(0, +wAmt || 0);
    if (a <= 0) return toast("Enter an amount");
    // explicit cash side: whoever's money actually moved, regardless of who's logged in
    const by = wBy ?? (isOwner ? "owner" : "manager");
    const fields = { worker: w, amount: a, date: wDate ? toDmy(wDate) : undefined, by: user?.id || "unknown", note: wNote.trim(), toOwner: by === "owner" };
    if (wKind === "give") await payWorker(fields);
    else await repayWorker(fields);
    setWAmt("");
    setWNote("");
    setWDate("");
    load();
    bumpData();
    toast(
      "₹" + inr(a) + (wKind === "give" ? " given to " : " received back from ") + w.name + " — " +
        (by === "owner"
          ? "Owner's cash (not in Daybook)"
          : wKind === "give"
            ? "cut from the Manager's Daybook"
            : "added to the Manager's Daybook"),
    );
  }

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
          <div className="modal-field acct-field" style={{ marginTop: 12, width: "100%" }}>
            <span>Cash held by which account? <small style={{ color: "var(--ink-faint)" }}>(optional — blank = manager daybook)</small></span>
            <AccountPicker value={acct} onChange={setAcct} accounts={upiAccts} />
          </div>
        )}
        {showReceivedFields && (
          <label className="modal-field" style={{ marginTop: 12, width: "100%" }}>
            <span>Note (optional) <small style={{ color: "var(--ink-faint)" }}>— shows on the customer&apos;s statement PDF</small></span>
            <input
              type="text"
              placeholder={mode === "upi" || mode === "uowner" ? "e.g. paid to Afsar's account" : "e.g. partial payment"}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        )}

        {showReceivedFields && (
          <div className="modal-field" style={{ marginTop: 12, width: "100%" }}>
            <span>Use this money for</span>
            <div className="db-seg sm" style={{ marginTop: 4 }}>
              <button className={"seg-btn" + (applyTo === "quotes" ? " on" : "")} type="button" onClick={() => setApplyTo("quotes")}>
                Settle quotations (oldest first)
              </button>
              <button className={"seg-btn" + (applyTo === "account" ? " on" : "")} type="button" onClick={() => setApplyTo("account")}>
                Account only (old dues)
              </button>
            </div>
            <small style={{ color: "var(--ink-faint)", marginTop: 4, display: "block" }}>
              {applyTo === "quotes"
                ? "The amount clears their open quotations oldest-first; anything beyond stays on the account."
                : "Nothing is linked to any quotation — the whole amount pays down their account balance (e.g. an opening balance from before the app)."}
            </small>
          </div>
        )}

        {editing && (
          <div className="pb-editbar no-print" style={{ marginTop: 12 }}>
            <span>
              Editing this {kind === "due" ? "due" : "receipt"}
              {editRcpt && editRcpt.pieces.some((x) => !!x.sourceId) ? " — saving re-applies it fresh (linked quotations adjust)" : ""}
            </span>
            <button type="button" onClick={resetForm}>
              Cancel
            </button>
          </div>
        )}

        <button className="btn primary" type="button" onClick={record} style={{ width: "100%", justifyContent: "center", marginTop: 14, padding: 12 }}>
          {editing ? "Save changes" : kind === "due" ? "Add due" : "Record receipt"}
        </button>
      </div>

      {activeWorkers.length > 0 && (
        <div className="panel-card">
          <div className="pc-head" style={{ cursor: "pointer" }} onClick={() => setShowWkr((v) => !v)}>
            <span className="um-caret" style={{ marginRight: 6 }}>{showWkr ? "▾" : "▸"}</span>
            Worker salary account
            <small style={{ marginLeft: 8, textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
              give / take back money against a worker&apos;s account without opening Attendance
            </small>
          </div>
          {showWkr && (
            <div style={{ padding: "0 14px 14px" }}>
              <div className="db-seg sm" style={{ margin: "10px 0 2px" }}>
                <button className={"seg-btn" + (wKind === "give" ? " on" : "")} type="button" onClick={() => setWKind("give")}>
                  Give
                </button>
                <button className={"seg-btn" + (wKind === "repay" ? " on" : "")} type="button" onClick={() => setWKind("repay")}>
                  Received back
                </button>
              </div>
              <div className="acct-add-row" style={{ alignItems: "flex-end", flexWrap: "wrap", marginTop: 10 }}>
                <label className="modal-field" style={{ flex: "2 1 140px", minWidth: 0 }}>
                  <span>Worker</span>
                  <select value={wkrId} onChange={(e) => setWkrId(e.target.value)}>
                    <option value="">— pick —</option>
                    {activeWorkers.map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </label>
                <label className="modal-field" style={{ flex: "1 1 100px", minWidth: 0 }}>
                  <span>Amount ₹</span>
                  <input type="number" inputMode="decimal" placeholder="0" value={wAmt} onChange={(e) => setWAmt(e.target.value)} />
                </label>
                <label className="modal-field" style={{ flex: "1 1 130px", minWidth: 0 }}>
                  <span>Date (optional)</span>
                  <input type="date" value={wDate} onChange={(e) => setWDate(e.target.value)} />
                </label>
                <label className="modal-field" style={{ flex: "2 1 150px", minWidth: 0 }}>
                  <span>Note (optional)</span>
                  <input type="text" placeholder="e.g. advance" value={wNote} onChange={(e) => setWNote(e.target.value)} />
                </label>
                <button className="btn primary" type="button" onClick={recordWorker} style={{ alignSelf: "flex-end" }}>
                  {wKind === "give" ? "Give" : "Record"}
                </button>
              </div>
              <div className="att-paidby">
                <span className="att-paidby-lbl">{wKind === "give" ? "Paid by" : "Received by"}</span>
                <div className="db-seg sm">
                  <button
                    className={"seg-btn" + ((wBy ?? (isOwner ? "owner" : "manager")) === "owner" ? " on" : "")}
                    type="button"
                    title="The Owner's own cash — the Daybook is untouched"
                    onClick={() => setWBy("owner")}
                  >
                    Owner
                  </button>
                  <button
                    className={"seg-btn" + ((wBy ?? (isOwner ? "owner" : "manager")) === "manager" ? " on" : "")}
                    type="button"
                    title="The Manager's cash — moves the Daybook"
                    onClick={() => setWBy("manager")}
                  >
                    Manager
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

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
                g.list.map((entry) => {
                  const { e, quoteNo, quoteId, locked, settled, amount } = entry;
                  const editingThis = editId === e.id || (!!editRcpt && editRcpt.id === entry.key);
                  return (
                    <div className={"stmt" + (editingThis ? " pb-editing" : "")} key={entry.key}>
                      <div className={"stmt-ic " + (e.charge ? "due" : e.mode === "upi" ? "upi" : "cash")}>{e.charge ? "Due" : e.mode === "upi" ? "UPI" : "₹"}</div>
                      <div className="stmt-main">
                        <div className="stmt-to">
                          {e.charge
                            ? e.note || "Due added"
                            : locked
                              ? "On quote #" + quoteNo + (e.mode === "upi" ? " · UPI" + (e.account ? " · " + e.account : "") : " · Cash")
                              : e.mode === "upi"
                                ? (e.account || "UPI") + (e.label ? " · " + e.label : "")
                                : e.account
                                  ? e.account + (e.label ? " · " + e.label : "")
                                  : e.toOwner
                                    ? "Cash → Owner" + (e.label ? " · " + e.label : "")
                                    : e.label || "Cash · Daybook"}
                        </div>
                        <div className="stmt-sub">
                          {settled ? settled + " · " : ""}
                          {e.date} · by {userName(e.enteredBy)}
                        </div>
                      </div>
                      <div className={"stmt-amt" + (e.charge ? " due" : "")}>+₹{inr(amount)}</div>
                      <span className="pb-rowacts">
                        {locked ? (
                          <button className="pb-x" title="Open quotation" type="button" onClick={() => router.push("/editor/" + quoteId)}>
                            ↗
                          </button>
                        ) : (
                          <>
                            <button className="pb-x" title="Edit" type="button" onClick={() => startEdit(entry)}>
                              ✎
                            </button>
                            <button className="pb-x" title="Delete" type="button" onClick={() => remove(entry)}>
                              ×
                            </button>
                          </>
                        )}
                      </span>
                    </div>
                  );
                })}
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
