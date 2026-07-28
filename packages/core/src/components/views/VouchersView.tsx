"use client";
// Vouchers (official app): RECEIPT vouchers — every payment received (against invoices,
// or as customer ADVANCES that auto-clear onto future invoices) — and PAYMENT vouchers —
// money paid out by cash or bank. Filterable date-wise books + a printable table.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec, delRec } from "@/lib/data";
import { dateSortKey, inr, todayStr } from "@/lib/calc";
import { allExpenses } from "@/lib/expenses";
import { brandFor } from "@/lib/brand";
import { generatePdf, printOrSavePdf } from "@/lib/pdf";
import {
  addBankAccount,
  CASH_DAY_LIMIT,
  cashTakenFromCustomerOn,
  getBankAccounts,
  isPaymentVoucher,
  recordAdvanceReceipt,
  recordPaymentVoucher,
  removeBankAccount,
} from "@/lib/vouchers";
import { USERS } from "@/lib/local-auth";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import CustomerPicker from "@/components/editor/CustomerPicker";
import type { Customer, Doc, Expense } from "@/lib/types";

const r2 = (n: number) => Math.round(n * 100) / 100;
const userName = (id: string) => USERS.find((u) => u.id === id)?.name || id || "—";
const toDmy = (v: string) => {
  const [y, m, d] = (v || "").split("-");
  return d && m && y ? `${d}-${m}-${y.slice(2)}` : "";
};
const pad2 = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) => d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());

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
  const { ready, dataVersion, user, brandMode } = useApp();
  const router = useRouter();
  const [seg, setSeg] = useState<"receipts" | "payments">("receipts");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [invoices, setInvoices] = useState<Doc[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [banks, setBanks] = useState<string[]>([]);
  // ---- filters (shared by the screen books and the printable table) ----
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [viaF, setViaF] = useState<"all" | "cash" | "bank">("all");
  const [bankF, setBankF] = useState("");
  const [q, setQ] = useState("");
  // ---- payment-voucher form ----
  const [payee, setPayee] = useState("");
  const [amt, setAmt] = useState("");
  const [via, setVia] = useState<"cash" | "bank">("cash");
  const [bank, setBank] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [newBank, setNewBank] = useState("");
  // ---- advance-receipt form (Receipts tab) ----
  const [advName, setAdvName] = useState("");
  const [advCust, setAdvCust] = useState<Customer | null>(null);
  const [advAmt, setAdvAmt] = useState("");
  const [advVia, setAdvVia] = useState<"cash" | "bank">("cash");
  const [advBank, setAdvBank] = useState("");
  const [advDate, setAdvDate] = useState("");
  const [advNote, setAdvNote] = useState("");
  const [advTaken, setAdvTaken] = useState(0);
  const printRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    Promise.all([allExpenses(), allRec<Doc>("invoices"), allRec<Customer>("customers"), getBankAccounts()]).then(
      ([es, is, cs, bs]) => {
        setExpenses(es);
        setInvoices(is);
        setCustomers(cs);
        setBanks(bs);
      },
    );
  }, []);
  useEffect(() => {
    if (ready) load();
  }, [ready, dataVersion, load]);

  // structural cash cap on the advance form — same rule as the invoice block
  const advDateStr = advDate ? toDmy(advDate) : todayStr();
  useEffect(() => {
    let alive = true;
    if (!advCust) return;
    cashTakenFromCustomerOn(advCust.id, advDateStr, expenses).then((taken) => {
      if (alive) setAdvTaken(taken);
    });
    return () => {
      alive = false;
    };
  }, [advCust, advDateStr, expenses]);
  const advRoom = advCust ? Math.max(0, r2(CASH_DAY_LIMIT - advTaken)) : CASH_DAY_LIMIT;
  function onAdvAmt(v: string) {
    const n = +v || 0;
    if (advVia === "cash" && n > advRoom) {
      setAdvAmt(String(advRoom));
      toast("Cash cap: only ₹" + inr(advRoom) + " more allowed from this customer on " + advDateStr + " — take the rest by bank");
      return;
    }
    setAdvAmt(v);
  }

  const invById = useMemo(() => new Map(invoices.map((d) => [d.id, d] as const)), [invoices]);
  const custName = (id?: string) => customers.find((c) => c.id === id)?.name || "—";

  // ---- filter machinery ----
  const inRange = (e: Expense) => {
    const k = dateSortKey(e.date) || "";
    if (from && k < from) return false;
    if (to && k > to) return false;
    return true;
  };
  const viaOk = (e: Expense) =>
    viaF === "all" ? true : viaF === "cash" ? e.mode !== "upi" && !e.account : e.mode === "upi" || !!e.account;
  const bankOk = (e: Expense) => !bankF || (e.account || "") === bankF;
  const textOf = (e: Expense, kind: "in" | "out") => {
    const inv = e.sourceId ? invById.get(e.sourceId) : undefined;
    return kind === "in"
      ? [inv?.customerName, inv?.number, e.custId ? custName(e.custId) : "", e.account, e.label].filter(Boolean).join(" ")
      : [e.label, e.account, e.note].filter(Boolean).join(" ");
  };
  const qOk = (e: Expense, kind: "in" | "out") => !q.trim() || textOf(e, kind).toLowerCase().includes(q.trim().toLowerCase());

  // receipts: invoice payments + customer advances (custId, not yet absorbed)
  const receipts = expenses.filter(
    (e) =>
      e.type === "sale" && !e.charge &&
      ((!!e.sourceId && invById.has(e.sourceId)) || !!e.custId) &&
      inRange(e) && viaOk(e) && bankOk(e) && qOk(e, "in"),
  );
  const pvs = expenses.filter((e) => isPaymentVoucher(e) && inRange(e) && viaOk(e) && bankOk(e) && qOk(e, "out"));
  const rGroups = groupByDay(receipts);
  const pGroups = groupByDay(pvs);
  const rTotal = r2(receipts.reduce((s, e) => s + (+e.amount || 0), 0));
  const pTotal = r2(pvs.reduce((s, e) => s + (+e.amount || 0), 0));

  const shown = seg === "receipts" ? receipts : pvs;
  const shownOldestFirst = [...shown].sort(
    (a, b) =>
      (dateSortKey(a.date) || "").localeCompare(dateSortKey(b.date) || "") ||
      (a.createdAt || "").localeCompare(b.createdAt || ""),
  );

  function preset(p: "thisMonth" | "lastMonth" | "fy" | "all") {
    const now = new Date();
    if (p === "all") {
      setFrom("");
      setTo("");
    } else if (p === "thisMonth") {
      setFrom(isoOf(new Date(now.getFullYear(), now.getMonth(), 1)));
      setTo(isoOf(now));
    } else if (p === "lastMonth") {
      setFrom(isoOf(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
      setTo(isoOf(new Date(now.getFullYear(), now.getMonth(), 0)));
    } else {
      const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
      setFrom(isoOf(new Date(fyStart, 3, 1)));
      setTo(isoOf(now));
    }
  }
  const periodLabel = from || to ? (from ? toDmy(from) : "start") + " — " + (to ? toDmy(to) : "today") : "All time";
  const brand = brandFor(brandMode);
  const today = new Date();
  const genOn = `${pad2(today.getDate())}-${pad2(today.getMonth() + 1)}-${today.getFullYear()}`;

  // ---- bank accounts ----
  async function addBank() {
    const next = await addBankAccount(newBank);
    setBanks(next);
    const n = newBank.trim();
    if (n) setBank(next.find((x) => x.toLowerCase() === n.toLowerCase()) || n);
    setNewBank("");
    bumpData();
  }

  // ---- record: advance receipt ----
  async function recordAdvance() {
    if (!advCust) return toast("Pick an existing customer");
    const a = Math.max(0, +advAmt || 0);
    if (a <= 0) return toast("Enter an amount");
    if (advVia === "bank" && !advBank.trim()) return toast("Pick the bank account");
    if (advVia === "cash") {
      const taken = await cashTakenFromCustomerOn(advCust.id, advDateStr, expenses);
      if (taken + a > CASH_DAY_LIMIT + 0.005)
        return toast("Cash limit — max ₹" + inr(CASH_DAY_LIMIT) + " from one customer per day");
    }
    await recordAdvanceReceipt({
      custId: advCust.id,
      custName: advCust.name,
      amount: a,
      via: advVia,
      bank: advBank,
      date: advDate ? toDmy(advDate) : undefined,
      note: advNote,
      by: user?.id || "unknown",
    });
    setAdvAmt("");
    setAdvNote("");
    setAdvDate("");
    load();
    bumpData();
    toast("₹" + inr(a) + " advance from " + advCust.name + " — it will clear onto their next invoice");
  }

  // ---- record: payment voucher ----
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
        const isAdvance = kind === "in" && !inv && !!e.custId;
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
                  ? isAdvance
                    ? (e.note || custName(e.custId)) + " · Advance"
                    : (inv?.customerName || "Walk-in") + " · #" + (inv?.number || "—")
                  : e.label || "—"}
                <span className="acct-overall-hint"> · {e.account || "Cash"}</span>
                {isAdvance && <span className="acct-overall-hint"> · clears onto their next invoice</span>}
              </div>
              <div className="stmt-sub">
                {(kind === "in" ? e.label : e.note) ? (kind === "in" ? e.label : e.note) + " · " : ""}
                by {userName(e.enteredBy)}
              </div>
            </div>
            <div className={"stmt-amt" + (kind === "out" ? " due" : "")}>
              {kind === "in" ? "+" : "−"}₹{inr(e.amount)}
            </div>
            {(kind === "out" || isAdvance) && (
              <span className="pb-rowacts">
                <button
                  className="pb-x"
                  title={kind === "out" ? "Delete voucher" : "Delete advance"}
                  onClick={async (ev) => {
                    ev.stopPropagation();
                    if (kind === "out") return removePv(e);
                    const ok = await confirmDialog({
                      title: "Delete advance?",
                      message: (e.note || "—") + " — ₹" + inr(e.amount),
                      confirmLabel: "Delete",
                      danger: true,
                    });
                    if (!ok) return;
                    await delRec("expenses", e.id);
                    load();
                    bumpData();
                    toast("Advance removed");
                  }}
                >
                  ×
                </button>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div>
      <div className="cd-screen">
      <div className="sectitle" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span>Vouchers <small>— receipt &amp; payment books</small></span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button
            className="btn primary sm"
            onClick={async () => {
              if ((await printOrSavePdf(printRef.current, seg + "-vouchers-" + genOn)) === "pdf") toast("PDF downloaded ✓");
            }}
          >
            Print
          </button>
          <button
            className="btn sm"
            onClick={async () => {
              toast("Preparing PDF…");
              await generatePdf(printRef.current!, seg + "-vouchers-" + genOn);
              toast("PDF downloaded ✓");
            }}
          >
            Save PDF
          </button>
        </div>
      </div>

      <div className="db-seg" style={{ marginBottom: 12 }}>
        <button className={"seg-btn" + (seg === "receipts" ? " on" : "")} type="button" onClick={() => setSeg("receipts")}>
          Receipt vouchers · ₹{inr(rTotal)}
        </button>
        <button className={"seg-btn" + (seg === "payments" ? " on" : "")} type="button" onClick={() => setSeg("payments")}>
          Payment vouchers · ₹{inr(pTotal)}
        </button>
      </div>

      {/* filters — same controls as Reports */}
      <div className="rep-controls">
        <div className="rep-presets">
          <button className="btn sm" onClick={() => preset("thisMonth")}>This month</button>
          <button className="btn sm" onClick={() => preset("lastMonth")}>Last month</button>
          <button className="btn sm" onClick={() => preset("fy")}>This FY</button>
          <button className="btn sm" onClick={() => preset("all")}>All time</button>
        </div>
        <div className="rep-range">
          <label>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <label>
            Via
            <select value={viaF} onChange={(e) => { setViaF(e.target.value as "all" | "cash" | "bank"); if (e.target.value !== "bank") setBankF(""); }}>
              <option value="all">All</option>
              <option value="cash">Cash</option>
              <option value="bank">Bank</option>
            </select>
          </label>
          {viaF === "bank" && (
            <label>
              Bank
              <select value={bankF} onChange={(e) => setBankF(e.target.value)}>
                <option value="">All banks</option>
                {banks.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            Search
            <input type="text" placeholder={seg === "receipts" ? "customer / invoice no…" : "payee / note…"} value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
      </div>

      {seg === "receipts" ? (
        <>
          {/* direct advance receipt — no invoice yet; clears onto their next invoice */}
          <div className="panel-card" style={{ padding: 14 }}>
            <div className="pc-head" style={{ paddingLeft: 0 }}>
              Receive from a customer
              <small style={{ marginLeft: 8, textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
                advance — auto-clears when their next invoice is made
              </small>
            </div>
            <div className="rec-grid">
              <label className="modal-field" style={{ gridColumn: "1 / -1" }}>
                <span>Customer</span>
                <CustomerPicker
                  value={advName}
                  customers={customers}
                  onType={(v) => { setAdvName(v); setAdvCust(null); }}
                  onPick={(c) => { setAdvCust(c); setAdvName(c.name); }}
                  placeholder="Search an existing customer…"
                />
              </label>
              <label className="modal-field">
                <span>Amount ₹ {advVia === "cash" && advCust ? <small style={{ color: advRoom <= 0 ? "var(--danger)" : "var(--ink-faint)" }}>(cash room ₹{inr(advRoom)} today)</small> : null}</span>
                <input type="number" inputMode="decimal" placeholder="0" value={advAmt} onChange={(e) => onAdvAmt(e.target.value)} />
              </label>
              <label className="modal-field">
                <span>Date (optional)</span>
                <input type="date" value={advDate} onChange={(e) => setAdvDate(e.target.value)} />
              </label>
              <label className="modal-field">
                <span>Note (optional)</span>
                <input type="text" placeholder="e.g. advance for teak order" value={advNote} onChange={(e) => setAdvNote(e.target.value)} />
              </label>
            </div>
            <div className="att-paidby" style={{ marginTop: 10 }}>
              <span className="att-paidby-lbl">Via</span>
              <div className="db-seg sm">
                <button className={"seg-btn" + (advVia === "cash" ? " on" : "")} type="button" onClick={() => setAdvVia("cash")}>Cash</button>
                <button className={"seg-btn" + (advVia === "bank" ? " on" : "")} type="button" onClick={() => setAdvVia("bank")}>Bank</button>
              </div>
              {advVia === "bank" && (
                <select className="pb-sel" value={advBank} onChange={(e) => setAdvBank(e.target.value)} style={{ minWidth: 160 }}>
                  <option value="">— bank account —</option>
                  {banks.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
              )}
            </div>
            <button className="btn primary" type="button" onClick={recordAdvance} style={{ width: "100%", justifyContent: "center", marginTop: 12, padding: 12 }}>
              Record receipt
            </button>
          </div>

          <div className="panel-card" style={{ padding: "0 0 4px", marginTop: 14 }}>
            {rGroups.length ? (
              rGroups.map((g) => dayBlock(g, "in"))
            ) : (
              <div className="empty">
                <div className="empty-title">No receipts{from || to || q || viaF !== "all" ? " in this filter" : " yet"}</div>
                <div className="empty-note">Payments recorded inside invoices — and advances taken above — show here date-wise.</div>
              </div>
            )}
          </div>
        </>
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
                <div className="empty-title">No payment vouchers{from || to || q || viaF !== "all" ? " in this filter" : " yet"}</div>
                <div className="empty-note">Money you pay out — freight, labour, purchases — recorded cash or bank.</div>
              </div>
            )}
          </div>
        </>
      )}
      </div>

      {/* ---- printable voucher register (matches the active tab + filters) ---- */}
      <div className="cd-print rep-doc" ref={printRef}>
        <div className="rep-head">
          <div className="rep-brand">
            <h1>{brand.name || "Vouchers"}</h1>
            {brand.addr && <div>{brand.addr}</div>}
            {brand.gstin && <div>GSTIN: {brand.gstin}</div>}
          </div>
          <div className="rep-meta">
            <div className="rep-title">{seg === "receipts" ? "Receipt Vouchers" : "Payment Vouchers"}</div>
            <div className="rep-period">
              {periodLabel}
              {viaF !== "all" ? " · " + (viaF === "cash" ? "Cash only" : bankF || "Bank only") : ""}
            </div>
          </div>
        </div>

        <div className="rep-summary cols3">
          <div><b>{shownOldestFirst.length}</b><span>Vouchers</span></div>
          <div><b>₹{inr(seg === "receipts" ? rTotal : pTotal)}</b><span>{seg === "receipts" ? "Received" : "Paid"}</span></div>
          <div><b>{periodLabel}</b><span>Period</span></div>
        </div>

        <table className="rep-table">
          <colgroup>
            <col style={{ width: "5%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "30%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "16%" }} />
          </colgroup>
          <thead>
            <tr>
              <th className="c-n">#</th>
              <th>Date</th>
              <th>{seg === "receipts" ? "Customer · Invoice" : "Paid to"}</th>
              <th>Via</th>
              <th>{seg === "receipts" ? "Note" : "Note"}</th>
              <th className="amt">Amount ₹</th>
            </tr>
          </thead>
          <tbody>
            {shownOldestFirst.map((e, i) => {
              const inv = e.sourceId ? invById.get(e.sourceId) : undefined;
              const who =
                seg === "receipts"
                  ? inv
                    ? (inv.customerName || "Walk-in") + " · #" + inv.number
                    : (e.note || custName(e.custId)) + " · Advance"
                  : e.label || "—";
              return (
                <tr key={e.id}>
                  <td className="c-n">{i + 1}</td>
                  <td className="c-date">{e.date}</td>
                  <td className="c-cust">{who}</td>
                  <td>{e.account || "Cash"}</td>
                  <td className="c-cust">{seg === "receipts" ? e.label || "—" : e.note || "—"}</td>
                  <td className="amt">{inr(e.amount)}</td>
                </tr>
              );
            })}
            <tr className="rep-tot">
              <td colSpan={5}>Total — {shownOldestFirst.length} voucher{shownOldestFirst.length === 1 ? "" : "s"}</td>
              <td className="amt">{inr(seg === "receipts" ? rTotal : pTotal)}</td>
            </tr>
          </tbody>
        </table>

        <div className="rep-foot">Generated {genOn} · {brand.name}</div>
      </div>
    </div>
  );
}
