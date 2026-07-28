"use client";
// Vouchers (official app): RECEIPT vouchers — every payment received against an invoice,
// date-wise like the daybook — and PAYMENT vouchers — money paid out by cash or bank.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec, delRec } from "@/lib/data";
import { dateSortKey, inr } from "@/lib/calc";
import { allExpenses } from "@/lib/expenses";
import { addBankAccount, getBankAccounts, isPaymentVoucher, recordPaymentVoucher, removeBankAccount } from "@/lib/vouchers";
import { USERS } from "@/lib/local-auth";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import type { Doc, Expense } from "@/lib/types";

const r2 = (n: number) => Math.round(n * 100) / 100;
const userName = (id: string) => USERS.find((u) => u.id === id)?.name || id || "—";
const toDmy = (v: string) => {
  const [y, m, d] = (v || "").split("-");
  return d && m && y ? `${d}-${m}-${y.slice(2)}` : "";
};

interface DayGroup {
  date: string;
  total: number;
  entries: Expense[];
}

/** newest day first; entries inside newest first */
function groupByDay(list: Expense[]): DayGroup[] {
  const m = new Map<string, Expense[]>();
  for (const e of list) {
    const arr = m.get(e.date) || [];
    arr.push(e);
    m.set(e.date, arr);
  }
  return [...m.entries()]
    .map(([date, entries]) => ({
      date,
      total: r2(entries.reduce((s, e) => s + (+e.amount || 0), 0)),
      entries: entries.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")),
    }))
    .sort((a, b) => (dateSortKey(b.date) || "").localeCompare(dateSortKey(a.date) || ""));
}

export default function VouchersView() {
  const { ready, dataVersion, user } = useApp();
  const router = useRouter();
  const [seg, setSeg] = useState<"receipts" | "payments">("receipts");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [invoices, setInvoices] = useState<Doc[]>([]);
  const [banks, setBanks] = useState<string[]>([]);
  // payment-voucher form
  const [payee, setPayee] = useState("");
  const [amt, setAmt] = useState("");
  const [via, setVia] = useState<"cash" | "bank">("cash");
  const [bank, setBank] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [newBank, setNewBank] = useState("");

  const load = useCallback(() => {
    Promise.all([allExpenses(), allRec<Doc>("invoices"), getBankAccounts()]).then(([es, is, bs]) => {
      setExpenses(es);
      setInvoices(is);
      setBanks(bs);
    });
  }, []);
  useEffect(() => {
    if (ready) load();
  }, [ready, dataVersion, load]);

  const invById = new Map(invoices.map((d) => [d.id, d] as const));
  // receipts: every payment recorded against an invoice
  const receipts = expenses.filter((e) => e.type === "sale" && !!e.sourceId && invById.has(e.sourceId!));
  const pvs = expenses.filter(isPaymentVoucher);
  const rGroups = groupByDay(receipts);
  const pGroups = groupByDay(pvs);
  const rTotal = r2(receipts.reduce((s, e) => s + (+e.amount || 0), 0));
  const pTotal = r2(pvs.reduce((s, e) => s + (+e.amount || 0), 0));

  async function addBank() {
    const next = await addBankAccount(newBank);
    setBanks(next);
    const n = newBank.trim();
    if (n) setBank(next.find((x) => x.toLowerCase() === n.toLowerCase()) || n);
    setNewBank("");
    bumpData();
  }

  async function recordPv() {
    const a = Math.max(0, +amt || 0);
    if (!payee.trim()) return toast("Who was paid?");
    if (a <= 0) return toast("Enter an amount");
    if (via === "bank" && !bank.trim()) return toast("Pick the bank account");
    await recordPaymentVoucher({
      payee: payee.trim(),
      amount: a,
      via,
      bank,
      date: date ? toDmy(date) : undefined,
      note: note.trim(),
      by: user?.id || "unknown",
    });
    setPayee("");
    setAmt("");
    setNote("");
    setDate("");
    load();
    bumpData();
    toast("₹" + inr(a) + " paid to " + payee.trim() + " · " + (via === "cash" ? "Cash" : bank));
  }

  async function removePv(e: Expense) {
    const ok = await confirmDialog({
      title: "Delete payment voucher?",
      message: (e.label || "—") + " — ₹" + inr(e.amount) + " · " + (e.account || "Cash"),
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await delRec("expenses", e.id); // soft delete
    load();
    bumpData();
    toast("Voucher removed");
  }

  const dayBlock = (g: DayGroup, kind: "in" | "out") => (
    <div className="db-day" key={g.date}>
      <div className="db-day-head">
        <span className="db-day-date">{g.date}</span>
        <span className="db-day-mini">
          {g.entries.length} {g.entries.length === 1 ? "entry" : "entries"} · {kind === "in" ? "received" : "paid"} ₹{inr(g.total)}
        </span>
      </div>
      {g.entries.map((e) => {
        const inv = e.sourceId ? invById.get(e.sourceId) : undefined;
        return (
          <div
            className="stmt"
            key={e.id}
            style={kind === "in" && inv ? { cursor: "pointer" } : undefined}
            onClick={kind === "in" && inv ? () => router.push("/editor/" + inv.id) : undefined}
            title={kind === "in" && inv ? "Open invoice #" + inv.number : undefined}
          >
            <div className={"stmt-ic " + (kind === "out" ? "due" : e.mode === "upi" ? "upi" : "cash")}>
              {kind === "out" ? "PV" : e.mode === "upi" ? "Bank" : "₹"}
            </div>
            <div className="stmt-main">
              <div className="stmt-to">
                {kind === "in"
                  ? (inv?.customerName || "Walk-in") + " · #" + (inv?.number || "—")
                  : e.label || "—"}
                {e.mode === "upi" || e.account ? <span className="acct-overall-hint"> · {e.account || "Bank"}</span> : <span className="acct-overall-hint"> · Cash</span>}
              </div>
              <div className="stmt-sub">
                {(kind === "in" ? e.label : e.note) ? (kind === "in" ? e.label : e.note) + " · " : ""}
                by {userName(e.enteredBy)}
              </div>
            </div>
            <div className={"stmt-amt" + (kind === "out" ? " due" : "")}>
              {kind === "in" ? "+" : "−"}₹{inr(e.amount)}
            </div>
            {kind === "out" && (
              <span className="pb-rowacts">
                <button className="pb-x" title="Delete voucher" onClick={(ev) => { ev.stopPropagation(); removePv(e); }}>×</button>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div>
      <div className="sectitle">
        Vouchers <small>— receipt &amp; payment books</small>
      </div>

      <div className="db-seg" style={{ marginBottom: 14 }}>
        <button className={"seg-btn" + (seg === "receipts" ? " on" : "")} type="button" onClick={() => setSeg("receipts")}>
          Receipt vouchers · ₹{inr(rTotal)}
        </button>
        <button className={"seg-btn" + (seg === "payments" ? " on" : "")} type="button" onClick={() => setSeg("payments")}>
          Payment vouchers · ₹{inr(pTotal)}
        </button>
      </div>

      {seg === "receipts" ? (
        <div className="panel-card" style={{ padding: "0 0 4px" }}>
          {rGroups.length ? (
            rGroups.map((g) => dayBlock(g, "in"))
          ) : (
            <div className="empty">
              <div className="empty-title">No receipts yet</div>
              <div className="empty-note">Record a payment inside an invoice — it shows up here date-wise.</div>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* bank accounts — managed HERE, one clean place */}
          <div className="panel-card" style={{ padding: 14 }}>
            <div className="pc-head" style={{ paddingLeft: 0 }}>
              Bank accounts
              <small style={{ marginLeft: 8, textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
                used for payment vouchers and invoice receipts
              </small>
            </div>
            {banks.length > 0 && (
              <div className="vch-banks">
                {banks.map((b) => (
                  <span className="vch-bank" key={b}>
                    {b}
                    <button
                      className="pb-x"
                      type="button"
                      title={"Remove " + b + " from the pick list (old vouchers keep it)"}
                      onClick={async () => {
                        setBanks(await removeBankAccount(b));
                        if (bank === b) setBank("");
                        bumpData();
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="acct-add-row" style={{ alignItems: "flex-end", marginTop: banks.length ? 10 : 4 }}>
              <label className="modal-field" style={{ flex: "2 1 220px" }}>
                <span>Add a bank account</span>
                <input
                  type="text"
                  placeholder="e.g. HDFC Chitradurga · 50200006429458"
                  value={newBank}
                  onChange={(e) => setNewBank(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addBank()}
                />
              </label>
              <button className="btn primary sm" type="button" onClick={addBank} disabled={!newBank.trim()}>
                Add bank
              </button>
            </div>
          </div>

          <div className="panel-card" style={{ padding: 14, marginTop: 14 }}>
            <div className="pc-head" style={{ paddingLeft: 0 }}>New payment voucher</div>
            <div className="rec-grid">
              <label className="modal-field">
                <span>Paid to</span>
                <input type="text" placeholder="e.g. KSRTC transport" value={payee} onChange={(e) => setPayee(e.target.value)} />
              </label>
              <label className="modal-field">
                <span>Amount ₹</span>
                <input type="number" inputMode="decimal" placeholder="0" value={amt} onChange={(e) => setAmt(e.target.value)} />
              </label>
              <label className="modal-field">
                <span>Date (optional)</span>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
            </div>
            <div className="att-paidby" style={{ marginTop: 10 }}>
              <span className="att-paidby-lbl">Via</span>
              <div className="db-seg sm">
                <button className={"seg-btn" + (via === "cash" ? " on" : "")} type="button" onClick={() => setVia("cash")}>
                  Cash
                </button>
                <button className={"seg-btn" + (via === "bank" ? " on" : "")} type="button" onClick={() => setVia("bank")}>
                  Bank
                </button>
              </div>
              {via === "bank" && (
                <select className="pb-sel" value={bank} onChange={(e) => setBank(e.target.value)} style={{ minWidth: 160 }}>
                  <option value="">— bank account —</option>
                  {banks.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
              )}
            </div>
            <label className="modal-field" style={{ marginTop: 10, width: "100%" }}>
              <span>Note (optional)</span>
              <input type="text" placeholder="e.g. lorry freight for teak load" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <button className="btn primary" type="button" onClick={recordPv} style={{ width: "100%", justifyContent: "center", marginTop: 12, padding: 12 }}>
              Record payment voucher
            </button>
          </div>

          <div className="panel-card" style={{ padding: "0 0 4px", marginTop: 14 }}>
            {pGroups.length ? (
              pGroups.map((g) => dayBlock(g, "out"))
            ) : (
              <div className="empty">
                <div className="empty-title">No payment vouchers yet</div>
                <div className="empty-note">Money you pay out — freight, labour, purchases — recorded cash or bank.</div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
