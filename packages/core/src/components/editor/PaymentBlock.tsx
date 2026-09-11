"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { inr, nowIso } from "@/lib/calc";
import { addExpense, liveSpendCategories } from "@/lib/expenses";
import { delRec, getRec, put } from "@/lib/data";
import { quoteBill, quotePaid, statementsForQuote, type PartyStatement } from "@/lib/payments";
import { advanceBalance, applyAdvancesToQuote, restoreAdvanceFromApply } from "@/lib/vouchers";
import { USERS } from "@/lib/local-auth";
import AccountPicker from "@/components/AccountPicker";
import { bumpData, toast } from "@/store/app-store";
import { showReviewQr } from "@/store/review-qr-store";
import type { Customer, Doc, Expense } from "@/lib/types";
import CustomerPicker from "./CustomerPicker";

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

type Mode = "cash" | "owner" | "upi" | "uowner" | "commission";

function carpCat() {
  return liveSpendCategories({ hidden: true }).find((c) => c.id === "carpenter");
}

function modeLabel(l: PartyStatement) {
  if (l.commission) return "Commission";
  if (l.mode === "upi") return l.toOwner ? "UPI → Owner" : "UPI";
  return l.toOwner ? "Cash → Owner" : "Cash";
}

interface Props {
  doc: Doc;
  /** the itemised quote total, shown as the "(quote ₹…)" reference + placeholder */
  quoteGrand: number;
  expenses: Expense[];
  customers: Customer[];
  quotes: Doc[];
  upiAccts: string[];
  by: string;
  /** current user is the owner — their cash never enters the manager's daybook */
  isOwner: boolean;
  onFinalPrice: (v: string) => void;
  /** toggle printing the agreed final price on the quotation sheet (default off) */
  onShowFinalOnPrint: (v: boolean) => void;
  /** persist cash / UPI / commission running totals onto the doc */
  setAggregates: (payCash: number, payUpi: number, payCommission?: number) => void;
  onClearAll: () => void;
  reload: () => void;
  /** payment line to scroll to + flash on open (arriving from a Statements click) */
  highlightId?: string;
  /**
   * Ensure the typed customer name is a real customer record (creates if new).
   * Returns customerId, or null if there's no name to use.
   */
  ensureCustomer: () => Promise<string | null>;
}

export default function PaymentBlock({
  doc,
  quoteGrand,
  expenses,
  customers,
  quotes,
  upiAccts,
  by,
  isOwner,
  onFinalPrice,
  onShowFinalOnPrint,
  setAggregates,
  onClearAll,
  reload,
  highlightId,
  ensureCustomer,
}: Props) {
  const [amt, setAmt] = useState("");
  const [mode, setMode] = useState<Mode>("cash");
  const [acct, setAcct] = useState("");
  const [note, setNote] = useState(""); // free-text note on a cash payment (shown in Statements)
  const [payDate, setPayDate] = useState(""); // optional: when the payment actually happened (yyyy-mm-dd)
  const [editId, setEditId] = useState<string | null>(null); // a recorded payment being edited (its expense id)
  /** Hold money on the customer account for a future quotation (not this quote's paid total). */
  const [forNext, setForNext] = useState(false);
  const [commParty, setCommParty] = useState("");
  const [commCustId, setCommCustId] = useState("");
  const [commQuoteId, setCommQuoteId] = useState("");
  const [commCarpenter, setCommCarpenter] = useState("");

  const bill = quoteBill(doc);
  const lines = statementsForQuote(doc, expenses); // this quote's payments, newest first (incl. legacy)
  const received = r2(lines.reduce((s, l) => s + l.amount, 0));
  const balance = r2(bill - received);
  const settled = balance <= 0.5;
  const advBal = advanceBalance(expenses, doc.customerId || "");
  const cashOf = () => +(doc.payCash || 0);
  const upiOf = () => +(doc.payUpi || 0);
  const commOf = () => +(doc.payCommission || 0);
  const isComm = mode === "commission";

  const quoteIndex = useMemo(() => {
    const m = new Map<string, Doc>();
    for (const q of quotes) {
      if (!q.deletedAt && !q.purgedAt) m.set(q.id, q);
    }
    m.set(doc.id, doc);
    return [...m.values()];
  }, [quotes, doc]);

  const commCustQuotes = useMemo(() => {
    const name = commParty.trim();
    const list = commCustId
      ? quoteIndex.filter((d) => d.customerId === commCustId)
      : name
        ? quoteIndex.filter((d) => (d.customerName || "").trim() === name)
        : [];
    return list
      .map((d) => ({
        d,
        no: d.displayNumber || d.number || d.id,
        carpenter: (d.site || "").trim(),
        total: quoteBill(d),
      }))
      .sort((a, b) => (b.d.createdAt || "").localeCompare(a.d.createdAt || ""));
  }, [quoteIndex, commCustId, commParty]);

  const commCust =
    (commCustId && customers.find((c) => c.id === commCustId)) ||
    customers.find((c) => (c.name || "").trim() === commParty.trim()) ||
    null;

  function seedCommission() {
    setCommParty((doc.customerName || "").trim());
    setCommCustId(doc.customerId || "");
    setCommQuoteId(doc.id);
    setCommCarpenter((doc.site || "").trim());
  }

  function pickMode(v: Mode) {
    setMode(v);
    if (v === "commission") {
      setForNext(false);
      if (!commParty.trim()) seedCommission();
    }
  }

  // arriving from a Statements click: scroll to the exact payment line and flash it
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashed = useRef(false);
  const hasLine = !!highlightId && lines.some((l) => l.id === highlightId);
  useEffect(() => {
    if (!highlightId || !hasLine || flashed.current) return;
    flashed.current = true;
    setFlashId(highlightId);
    const el = document.getElementById("payline-" + highlightId);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setFlashId(null), 3200);
    return () => clearTimeout(t);
  }, [highlightId, hasLine]);

  async function resolveCustId(): Promise<string | null> {
    const id = await ensureCustomer();
    if (!id) {
      toast("Enter a customer name first — advance sits on their account");
      return null;
    }
    return id;
  }

  async function applyAdv() {
    const custId = await resolveCustId();
    if (!custId) return;
    const firstPay = quotePaid(doc) <= 0.005;
    // apply against a doc copy that has the resolved customerId (typed-new names)
    const r = await applyAdvancesToQuote({ ...doc, customerId: custId });
    if (r.applied <= 0) return toast("Nothing to apply — this quote may already be settled");
    setAggregates(r.payCash, r.payUpi, commOf());
    reload();
    bumpData();
    toast("₹" + inr(r.applied) + " advance applied to this quotation ✓");
    if (firstPay) showReviewQr({ docId: doc.id });
  }

  async function writeCommission(a: number, existing?: Expense) {
    const party = commParty.trim();
    if (!party) {
      toast("Enter the party / customer for this commission");
      return false;
    }
    const cat = carpCat();
    if (!cat) {
      toast("Carpenter commission category is missing");
      return false;
    }
    const q = commQuoteId ? commCustQuotes.find((x) => x.d.id === commQuoteId) : null;
    const fields = {
      type: cat.type,
      amount: a,
      mode: "" as const,
      label: cat.label,
      party,
      carpenter: commCarpenter.trim() || undefined,
      refQuoteId: q?.d.id || undefined,
      quoteNo: q ? q.no : undefined,
      sourceId: doc.id,
      toOwner: false,
      note: note.trim(),
      date: payDate ? toDmy(payDate) : undefined,
      enteredBy: by,
    };
    if (existing) {
      existing.amount = a;
      existing.type = cat.type;
      existing.label = cat.label;
      existing.mode = "";
      existing.party = party;
      existing.carpenter = commCarpenter.trim() || undefined;
      existing.refQuoteId = q?.d.id || undefined;
      existing.quoteNo = q ? q.no : undefined;
      existing.sourceId = doc.id;
      existing.toOwner = false;
      existing.account = "";
      existing.note = note.trim();
      existing.date = payDate ? toDmy(payDate) : existing.date;
      existing.updatedAt = nowIso();
      await put("expenses", existing);
    } else {
      await addExpense(fields);
    }
    return true;
  }

  async function addLine() {
    const a = Math.max(0, +amt || 0);
    if (a <= 0) return;
    if (isComm) {
      if (forNext) return toast("Commission pays this quotation — not an advance");
      const firstPay = quotePaid(doc) <= 0.005;
      const ok = await writeCommission(a);
      if (!ok) return;
      setAggregates(cashOf(), upiOf(), r2(commOf() + a));
      setAmt("");
      setNote("");
      setPayDate("");
      reload();
      bumpData();
      toast("₹" + inr(a) + " commission on this quote · not cash / UPI");
      if (firstPay) showReviewQr({ docId: doc.id });
      return;
    }
    const isUpiMode = mode === "upi" || mode === "uowner";
    if (mode === "upi" && !acct.trim()) return toast("Pick the UPI account");
    const isCash = !isUpiMode;
    // "to owner" = money that leaves the manager's daybook / collectable balance:
    // Cash → Owner, UPI → Owner, or any cash the owner records themselves.
    const toOwner = isUpiMode ? mode === "uowner" : mode === "owner" || isOwner;

    // Advance for next quote — sits on the customer account; does NOT pay this quotation.
    if (forNext && !editId) {
      const custId = await resolveCustId();
      if (!custId) return;
      await addExpense({
        type: "sale",
        amount: a,
        mode: isUpiMode ? "upi" : "cash",
        account: mode === "upi" || (isCash && mode !== "owner") ? acct.trim() : "",
        toOwner,
        custId,
        refQuoteId: doc.id,
        note: (doc.customerName || "").trim() || "Walk-in",
        label: note.trim() || "Advance for next quote",
        date: payDate ? toDmy(payDate) : undefined,
        enteredBy: by,
      });
      setAmt("");
      setAcct("");
      setNote("");
      setPayDate("");
      setForNext(false);
      reload();
      bumpData();
      toast("₹" + inr(a) + " held as advance for the next quotation");
      return;
    }

    // Flyer only on the first amount entry for this quotation.
    const firstPay = quotePaid(doc) <= 0.005;
    await addExpense({
      type: "sale",
      amount: a,
      mode: isUpiMode ? "upi" : "cash",
      // UPI → Owner needs no account (goes straight to the owner, not a collectable account)
      account: mode === "upi" || (isCash && mode !== "owner") ? acct.trim() : "",
      toOwner,
      note: (doc.customerName || "Walk-in") + " · " + doc.number,
      label: note.trim(), // free-text note — any mode, shows on statements
      date: payDate ? toDmy(payDate) : undefined,
      enteredBy: by,
      sourceId: doc.id,
    });
    setAggregates(r2(cashOf() + (isCash ? a : 0)), r2(upiOf() + (isUpiMode ? a : 0)), commOf());
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
    if (firstPay) showReviewQr({ docId: doc.id });
  }

  async function delLine(l: PartyStatement) {
    // synthetic lines ("from quote record") have no backing expense — they live only in the quote's
    // pay totals, so just reduce those aggregates (no expense to delete).
    if (!l.synthetic) {
      const e = await getRec<Expense>("expenses", l.id);
      if (e) await restoreAdvanceFromApply(e);
      await delRec("expenses", l.id);
    }
    if (l.commission) {
      setAggregates(cashOf(), upiOf(), Math.max(0, r2(commOf() - l.amount)));
    } else {
      setAggregates(
        Math.max(0, r2(cashOf() - (l.mode === "cash" ? l.amount : 0))),
        Math.max(0, r2(upiOf() - (l.mode === "upi" ? l.amount : 0))),
        commOf(),
      );
    }
    reload();
    bumpData();
    toast("Payment removed");
  }

  // load a recorded payment into the row form for editing
  function startEdit(l: PartyStatement) {
    setEditId(l.id);
    setForNext(false);
    setAmt(String(l.amount));
    setAcct(l.account || "");
    setNote(l.note || "");
    setPayDate(l.date ? fromDmy(l.date) : "");
    if (l.commission) {
      setMode("commission");
      void (async () => {
        const e = await getRec<Expense>("expenses", l.id);
        setCommParty((e?.party || "").trim() || (doc.customerName || "").trim());
        setCommQuoteId(e?.refQuoteId || doc.id);
        setCommCarpenter((e?.carpenter || "").trim() || (doc.site || "").trim());
        const match = customers.find((c) => c.id && e?.party && c.name === e.party);
        setCommCustId(match?.id || doc.customerId || "");
      })();
      return;
    }
    setMode(l.mode === "upi" ? (l.toOwner ? "uowner" : "upi") : l.toOwner ? "owner" : "cash");
  }
  function cancelEdit() {
    setEditId(null);
    setAmt("");
    setAcct("");
    setNote("");
    setPayDate("");
    setMode("cash");
    setForNext(false);
  }
  async function saveEdit() {
    const old = lines.find((l) => l.id === editId);
    if (!old) return cancelEdit();
    const a = Math.max(0, +amt || 0);
    if (a <= 0) return;
    const newComm = mode === "commission";
    const oldComm = !!old.commission;
    if (newComm && !commParty.trim()) return toast("Enter the party / customer for this commission");
    const isUpiMode = mode === "upi" || mode === "uowner";
    if (!newComm && mode === "upi" && !acct.trim() && !old.synthetic) return toast("Pick the UPI account");
    const isCash = !isUpiMode && !newComm;
    const e = await getRec<Expense>("expenses", old.id);

    const nextCash = Math.max(0, r2(cashOf() - (old.mode === "cash" && !oldComm ? old.amount : 0) + (isCash ? a : 0)));
    const nextUpi = Math.max(0, r2(upiOf() - (old.mode === "upi" && !oldComm ? old.amount : 0) + (isUpiMode && !newComm ? a : 0)));
    const nextComm = Math.max(0, r2(commOf() - (oldComm ? old.amount : 0) + (newComm ? a : 0)));

    if (!e) {
      if (newComm && !oldComm) return toast("Turn this into a new Commission line instead");
      setAggregates(nextCash, nextUpi, nextComm);
      cancelEdit();
      reload();
      bumpData();
      toast("Payment updated");
      return;
    }
    if (newComm) {
      const ok = await writeCommission(a, e);
      if (!ok) return;
    } else {
      e.amount = a;
      e.type = "sale";
      e.mode = isUpiMode ? "upi" : "cash";
      e.account = mode === "upi" || (isCash && mode !== "owner") ? acct.trim() : "";
      e.toOwner = isUpiMode ? mode === "uowner" : mode === "owner" || isOwner;
      e.label = note.trim();
      e.party = undefined;
      e.carpenter = undefined;
      e.refQuoteId = undefined;
      e.quoteNo = undefined;
      e.date = payDate ? toDmy(payDate) : e.date;
      e.updatedAt = nowIso();
      await put("expenses", e);
    }
    setAggregates(nextCash, nextUpi, nextComm);
    cancelEdit();
    reload();
    bumpData();
    toast("Payment updated");
  }

  const showAdd = !settled || editId || forNext;

  return (
    <div className="panel-card no-print" style={{ marginTop: 12, padding: 14 }}>
      <label className="modal-field" style={{ marginBottom: 6 }}>
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
      {/* default OFF — the printed quote stays clean unless this is ticked */}
      <label className="fp-print-opt" title="Prints the final price, every payment received, and the balance / Settled status on the sheet">
        <input
          type="checkbox"
          checked={!!doc.showFinalOnPrint}
          disabled={!(doc.finalPrice && doc.finalPrice > 0)}
          onChange={(e) => onShowFinalOnPrint(e.target.checked)}
        />
        Show final price &amp; payments on the printed quotation
        {!(doc.finalPrice && doc.finalPrice > 0) && <small> (enter a final price first)</small>}
      </label>

      {advBal > 0.5 && !settled && (
        <div className="pb-editbar" style={{ marginBottom: 10 }}>
          <span>
            ₹{inr(advBal)} advance on {doc.customerName || "this customer"}&apos;s account — ready for this quotation
          </span>
          <button type="button" onClick={() => void applyAdv()}>
            Apply to this quote
          </button>
        </div>
      )}

      <div className="paybook">
        <div className="pb-r pb-h">
          <span>Amount</span>
          <span>Mode</span>
          <span>Account</span>
          <span>When · by</span>
          <span />
        </div>

        {lines.map((l) => (
          <div
            className={"pb-r" + (editId === l.id ? " pb-editing" : "") + (flashId === l.id ? " pb-flash" : "")}
            id={"payline-" + l.id}
            key={l.id}
          >
            <span className="pb-amt">₹ {inr(l.amount)}</span>
            <span className="pb-mode">{modeLabel(l)}</span>
            <span className="pb-acct">
              {l.commission
                ? l.note || "Wood against commission"
                : l.mode === "upi"
                  ? (l.account || "—") + (l.note ? " · " + l.note : "")
                  : l.account
                    ? l.account + (l.note ? " · " + l.note : "")
                    : l.note || "Daybook"}
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

        {!editId && !isComm && (
          <div className="db-seg sm" style={{ margin: "8px 0 4px", gridColumn: "1 / -1" }}>
            <button
              type="button"
              className={"seg-btn" + (!forNext ? " on" : "")}
              onClick={() => setForNext(false)}
            >
              Pay this quote
            </button>
            <button
              type="button"
              className={"seg-btn" + (forNext ? " on" : "")}
              onClick={() => setForNext(true)}
              title="Customer paid today for a future quotation — holds on their account until you apply it"
            >
              Advance for next quote
            </button>
          </div>
        )}

        {forNext && !editId && !isComm && (
          <small style={{ display: "block", color: "var(--ink-faint)", marginBottom: 6, lineHeight: 1.45 }}>
            Holds ₹ on the customer&apos;s account (not on this quotation). Open the next quote and tap{" "}
            <b>Apply to this quote</b>. Optional note = condition / reason (e.g. &quot;next teak order&quot;).
          </small>
        )}

        {isComm && showAdd && (
          <div className="pb-comm no-print">
            <label className="modal-field" style={{ width: "100%" }}>
              <span>Mode</span>
              <select value={mode} onChange={(e) => pickMode(e.target.value as Mode)}>
                <option value="cash">Cash</option>
                <option value="owner">Cash → Owner</option>
                <option value="upi">UPI</option>
                <option value="uowner">UPI → Owner</option>
                <option value="commission">Commission</option>
              </select>
            </label>
            <div className="rec-grid rec-grid-due">
              <label className="modal-field">
                <span>Amount ₹</span>
                <input
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
              </label>
              <label className="modal-field">
                <span>Date (optional)</span>
                <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              </label>
            </div>
            <label className="modal-field" style={{ width: "100%" }}>
              <span>Party / customer</span>
              <CustomerPicker
                value={commParty}
                customers={customers}
                onType={(v) => {
                  setCommParty(v);
                  setCommCustId("");
                  setCommQuoteId("");
                  setCommCarpenter("");
                }}
                onPick={(c) => {
                  setCommParty(c.name);
                  setCommCustId(c.id);
                  const same = c.id === doc.customerId;
                  setCommQuoteId(same ? doc.id : "");
                  setCommCarpenter((c.site || "").trim() || (same ? (doc.site || "").trim() : ""));
                }}
                placeholder="Search customer or type a name…"
                maxResults={12}
              />
            </label>
            {(commCustId || commParty.trim()) && (
              <label className="modal-field" style={{ width: "100%" }}>
                <span>Quotation (optional)</span>
                <select
                  value={commQuoteId}
                  onChange={(ev) => {
                    const id = ev.target.value;
                    setCommQuoteId(id);
                    const q = commCustQuotes.find((x) => x.d.id === id);
                    if (q?.carpenter) setCommCarpenter(q.carpenter);
                    else if (commCust?.site) setCommCarpenter(commCust.site.trim());
                  }}
                >
                  <option value="">— none / all for this party —</option>
                  {commCustQuotes.map((q) => (
                    <option key={q.d.id} value={q.d.id}>
                      #{q.no}
                      {q.d.date ? " · " + q.d.date : ""}
                      {q.carpenter ? " · " + q.carpenter : ""}
                      {" · ₹" + inr(q.total)}
                    </option>
                  ))}
                </select>
                {commCustQuotes.length === 0 && (
                  <small style={{ color: "var(--ink-faint)", marginTop: 4, display: "block" }}>
                    No quotations for this customer yet.
                  </small>
                )}
              </label>
            )}
            <label className="modal-field" style={{ width: "100%" }}>
              <span>Carpenter</span>
              <input
                type="text"
                placeholder={commCust?.site ? "From customer: " + commCust.site : "Carpenter name (optional)"}
                value={commCarpenter}
                onChange={(ev) => setCommCarpenter(ev.target.value)}
              />
            </label>
            <label className="modal-field" style={{ width: "100%" }}>
              <span>Note (optional)</span>
              <input
                type="text"
                placeholder="e.g. timber order"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <button
              className="btn primary"
              type="button"
              onClick={editId ? saveEdit : addLine}
              disabled={!(+amt > 0)}
              style={{ width: "100%", justifyContent: "center", marginTop: 2, padding: 12 }}
            >
              {editId ? "Save changes" : "Record commission"}
            </button>
          </div>
        )}

        {showAdd && !isComm && (
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
            <select className="pb-sel" value={mode} onChange={(e) => pickMode(e.target.value as Mode)}>
              <option value="cash">Cash</option>
              <option value="owner">Cash → Owner</option>
              <option value="upi">UPI</option>
              <option value="uowner">UPI → Owner</option>
              <option value="commission">Commission</option>
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
              title={editId ? "Save changes" : forNext ? "Hold as advance" : "Add payment"}
              onClick={editId ? saveEdit : addLine}
              disabled={!(+amt > 0)}
            >
              {editId ? "✓" : "+"}
            </button>
          </div>
        )}
        {showAdd && !isComm && (
          <div className="pb-r pb-note">
            <input
              className="pb-in"
              type="text"
              placeholder={
                forNext
                  ? "Condition / note (optional) — e.g. next teak · before Aug 30"
                  : "Note (optional) — shows on statements"
              }
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ gridColumn: "1 / -1" }}
            />
          </div>
        )}

        <div className="pb-r pb-foot">
          <span className="pb-amt">₹ {inr(received)}</span>
          <span className="pb-mode" style={{ gridColumn: "2 / 4", color: "var(--ink-faint)" }}>
            received of ₹{inr(bill)}
            {advBal > 0.5 ? ` · ₹${inr(advBal)} on account` : ""}
          </span>
          {settled ? (
            <span className="pb-bal ok">Settled ✓</span>
          ) : (
            <button
              className="pb-bal due"
              type="button"
              title="Tap to fill this balance into the amount"
              style={{ border: "none", background: "transparent", cursor: "pointer" }}
              onClick={() => {
                setForNext(false);
                setAmt(String(balance));
              }}
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
