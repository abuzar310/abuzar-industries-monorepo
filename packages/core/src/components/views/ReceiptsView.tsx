"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec, getRec, put } from "@/lib/data";
import { inr, nowIso } from "@/lib/calc";
import { addExpense, spendCategoryOf, spendDetailOf, SPEND_CATEGORIES, upiAccounts } from "@/lib/expenses";
import { listWorkers, payWorker, repayWorker, type Worker } from "@/lib/attendance";
import { partyLedger, quoteBill } from "@/lib/payments";
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

const SPEND_LABELS = new Set(SPEND_CATEGORIES.map((c) => c.label));
/** Category spends recorded as Paid out (and daybook food/salary/custom with our labels). */
const isCategoryPayout = (e: Expense) =>
  !e.custId &&
  !e.charge &&
  (e.type === "food" ||
    e.type === "salary" ||
    (e.type === "custom" && SPEND_LABELS.has(e.label || "")));

type Kind = "received" | "due" | "paid";

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
  /** whose cash the "Paid out" money left (null = default to the logged-in role) */
  const [paidBy, setPaidBy] = useState<"owner" | "manager" | null>(null);
  /** Paid out category — Food / Salary / Truck rent / … */
  const [paidCat, setPaidCat] = useState(SPEND_CATEGORIES[0].id);
  /** Paid out: party (carpenter = customer pick/type) or free name for other cats */
  const [paidParty, setPaidParty] = useState("");
  /** Carpenter commission: linked customer (for quote list) — not written to expense.custId */
  const [paidCustId, setPaidCustId] = useState("");
  const [paidQuoteId, setPaidQuoteId] = useState("");
  const [paidCarpenter, setPaidCarpenter] = useState("");
  /** Mini truck rounds */
  const [paidRounds, setPaidRounds] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  /** editing a whole receipt (possibly split across quotes): its pieces get unwound + re-applied on save */
  const [editRcpt, setEditRcpt] = useState<{ id: string; pieces: Expense[] } | null>(null);
  /** where a received amount goes: oldest-first · one specific quote · account only */
  const [applyTo, setApplyTo] = useState<"quotes" | "quote" | "account">("quotes");
  const [quoteId, setQuoteId] = useState("");
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

  // arrived from Balances (✎ on a payment line): ?edit=<rcptId | expenseId> → prefill the form
  const editConsumed = useRef(false);
  useEffect(() => {
    if (editConsumed.current || !expenses.length || !customers.length) return;
    const editParam = new URLSearchParams(window.location.search).get("edit");
    if (!editParam) {
      editConsumed.current = true;
      return;
    }
    const pieces = expenses.filter((e) => e.type === "sale" && !e.charge && e.rcptId === editParam);
    const single = pieces.length ? null : expenses.find((e) => e.id === editParam && e.type === "sale");
    const rep = pieces.find((x) => !!x.custId) || pieces[0] || single;
    if (!rep) return; // data may still be loading — retry on next load
    editConsumed.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    const qById = new Map(quotes.map((q) => [q.id, q] as const));
    const cid = rep.custId || (rep.sourceId ? qById.get(rep.sourceId)?.customerId || "" : "");
    const t = setTimeout(() => {
      startEdit(
        pieces.length
          ? { key: editParam, cid, e: pieces.find((x) => !x.sourceId) || pieces[0], amount: 0, pieces, locked: false }
          : { key: rep.id, cid, e: rep, amount: +rep.amount || 0, locked: false },
      );
      setOpenCust(cid || null);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startEdit is stable enough for this one-shot prefill
  }, [expenses, customers, quotes]);

  const ledger = partyLedger(quotes, expenses, customers);
  const party = picked ? ledger.parties.find((p) => p.custId === picked.id) : null;
  const outstanding = party ? party.balance : picked?.opening || 0;
  const custName = (id?: string) => customers.find((c) => c.id === id)?.name || "—";

  function pickCustomer(c: Customer) {
    setPicked(c);
    setName(c.name);
    setQuoteId("");
    if (applyTo === "quote") setApplyTo("quotes");
  }
  function onType(v: string) {
    setName(v);
    setPicked(null);
    setQuoteId("");
  }
  function resetForm() {
    setAmt("");
    setAcct("");
    setNote("");
    setDate("");
    setMode("cash");
    setPaidBy(null);
    setPaidCat(SPEND_CATEGORIES[0].id);
    setPaidParty("");
    setPaidCustId("");
    setPaidQuoteId("");
    setPaidCarpenter("");
    setPaidRounds("");
    setEditId(null);
    setEditRcpt(null);
    setApplyTo("quotes");
    setQuoteId("");
  }

  /** open quotations for the picked customer — total + due for the pick list */
  const openQuotes = picked
    ? quotes
        .filter((d) => {
          if (d.deletedAt || d.purgedAt || d.customerId !== picked.id) return false;
          const billable =
            d.status === "Created" ||
            (+(d.payCash || 0)) > 0 ||
            (+(d.payUpi || 0)) > 0 ||
            (+(d.amountPaid || 0)) > 0;
          if (!billable) return false;
          return r2(quoteBill(d) - (+d.amountPaid || 0)) > 0.5;
        })
        .map((d) => {
          const total = quoteBill(d);
          const due = r2(total - (+d.amountPaid || 0));
          const no = d.displayNumber || d.number || d.id;
          return { d, total, due, no };
        })
        .sort((a, b) => (a.d.createdAt || "").localeCompare(b.d.createdAt || ""))
    : [];
  const pickedQuote = openQuotes.find((x) => x.d.id === quoteId) || null;

  /** All quotations for the carpenter-commission party (not only open/due). */
  const paidCustQuotes = paidCustId
    ? quotes
        .filter((d) => !d.deletedAt && !d.purgedAt && d.customerId === paidCustId)
        .map((d) => ({
          d,
          no: d.displayNumber || d.number || d.id,
          carpenter: (d.site || "").trim(),
          total: quoteBill(d),
        }))
        .sort((a, b) => (b.d.createdAt || "").localeCompare(a.d.createdAt || ""))
    : [];
  const paidCust = paidCustId ? customers.find((c) => c.id === paidCustId) || null : null;

  async function record() {
    const a = Math.max(0, +amt || 0);
    if (a <= 0) return toast("Enter an amount");

    // ---- Paid out: category spend (party/name logged; not a customer ledger link) ----
    if (kind === "paid" && !editRcpt) {
      const cat = SPEND_CATEGORIES.find((c) => c.id === paidCat) || SPEND_CATEGORIES[SPEND_CATEGORIES.length - 1];
      const by = paidBy ?? (isOwner ? "owner" : "manager");
      const party = paidParty.trim();
      const rounds = cat.id === "minitruck" ? Math.max(0, Math.floor(+paidRounds || 0)) : 0;
      const isCarp = cat.id === "carpenter";
      const carpenter = isCarp ? paidCarpenter.trim() : "";
      const q = isCarp && paidQuoteId ? paidCustQuotes.find((x) => x.d.id === paidQuoteId) : null;
      const refQuoteId = q?.d.id || "";
      const quoteNo = q ? q.no : "";
      if (editId) {
        const e = await getRec<Expense>("expenses", editId);
        if (!e || e.type === "sale") return resetForm();
        e.amount = a;
        e.type = cat.type;
        e.label = cat.label;
        e.note = note.trim();
        e.party = party || undefined;
        e.rounds = rounds > 0 ? rounds : undefined;
        e.carpenter = carpenter || undefined;
        e.refQuoteId = refQuoteId || undefined;
        e.quoteNo = quoteNo || undefined;
        e.toOwner = by === "owner";
        e.date = date ? toDmy(date) : e.date;
        e.custId = undefined;
        e.updatedAt = nowIso();
        await put("expenses", e);
        resetForm();
        load();
        bumpData();
        return toast("Updated ✓");
      }
      await addExpense({
        type: cat.type,
        amount: a,
        mode: "cash",
        label: cat.label,
        note: note.trim(),
        party,
        rounds: rounds > 0 ? rounds : undefined,
        carpenter: carpenter || undefined,
        refQuoteId: refQuoteId || undefined,
        quoteNo: quoteNo || undefined,
        date: date ? toDmy(date) : undefined,
        toOwner: by === "owner",
        enteredBy: user?.id || "unknown",
      });
      resetForm();
      load();
      bumpData();
      return toast(
        "₹" + inr(a) + " · " + cat.label +
          (by === "owner" ? " — Owner's cash (not in Daybook)" : " — cut from the Daybook"),
      );
    }

    if (!picked) return toast("Pick an existing customer");

    if (editRcpt) {
      // safest edit of a receipt: unwind every old piece (rolling quote totals back),
      // then re-apply the corrected amount fresh — money can never be double-counted
      const isUpiMode = mode === "upi" || mode === "uowner";
      if (mode === "upi" && !acct.trim()) return toast("Pick the UPI account");
      if (applyTo === "quote" && !quoteId) return toast("Pick which quotation to settle");
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
        quoteId: applyTo === "quote" ? quoteId : undefined,
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

    const isUpiMode = mode === "upi" || mode === "uowner";
    if (mode === "upi" && !acct.trim()) return toast("Pick the UPI account");
    if (applyTo === "quote" && !quoteId) return toast("Pick which quotation to settle");
    const isCash = !isUpiMode;
    const toOwner = isUpiMode ? mode === "uowner" : mode === "owner" || isOwner;
    // apply the receipt across open quotations (oldest-first, or one picked quote); leftover → account
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
      quoteId: applyTo === "quote" ? quoteId : undefined,
      enteredBy: user?.id || "unknown",
    });
    resetForm();
    load();
    bumpData();
    const nq = applied.length;
    const msg =
      nq > 0
        ? "₹" + inr(a) + " received from " + picked.name + " · applied to " +
          (nq === 1 ? "#" + (applied[0]?.number || "quote") : nq + " quotes") +
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
    const label = entry.paid ? "paid out" : e.charge ? "due" : "receipt";
    const total = pieces ? r2(pieces.reduce((s, x) => s + (+x.amount || 0), 0)) : +e.amount || 0;
    const who = entry.paid && !entry.cid ? spendCategoryOf(e) : custName(entry.cid);
    const ok = await confirmDialog({
      title: "Delete " + label + "?",
      message:
        who + " — ₹" + inr(total) +
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
      const linked = pieces.filter((x) => !!x.sourceId);
      if (linked.length === 1) {
        setApplyTo("quote");
        setQuoteId(linked[0].sourceId || "");
      } else if (linked.length > 1) {
        setApplyTo("quotes");
        setQuoteId("");
      } else {
        setApplyTo("account");
        setQuoteId("");
      }
    } else if (entry.paid && isCategoryPayout(e)) {
      setEditId(e.id);
      setEditRcpt(null);
      setKind("paid");
      setAmt(String(e.amount));
      const match = SPEND_CATEGORIES.find((c) => c.label === spendCategoryOf(e));
      setPaidCat(match?.id || "other");
      setPaidBy(e.toOwner ? "owner" : "manager");
      setNote(e.note || "");
      setPaidParty(e.party || "");
      setPaidCarpenter(e.carpenter || "");
      setPaidQuoteId(e.refQuoteId || "");
      setPaidRounds(e.rounds ? String(e.rounds) : "");
      setDate(e.date ? fromDmy(e.date) : "");
      setPicked(null);
      setName("");
      // resolve customer id from party name or linked quote
      const fromQuote = e.refQuoteId ? quotes.find((q) => q.id === e.refQuoteId) : null;
      const byName = (e.party || "").trim()
        ? customers.find((c) => c.name.trim().toLowerCase() === (e.party || "").trim().toLowerCase())
        : null;
      setPaidCustId(fromQuote?.customerId || byName?.id || "");
      return;
    } else {
      setEditId(e.id);
      setEditRcpt(null);
      setKind(entry.paid ? "paid" : e.charge ? "due" : "received");
      setAmt(String(e.amount));
    }
    setMode(e.charge ? "cash" : e.mode === "upi" ? (e.toOwner ? "uowner" : "upi") : e.toOwner ? "owner" : "cash");
    setPaidBy(entry.paid ? (e.toOwner ? "owner" : "manager") : null);
    setAcct(e.account || "");
    setNote(entry.paid ? e.note || "" : e.charge ? e.note || "" : e.label || "");
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
    /** true = a "Paid out" entry (money we handed to the customer) */
    paid?: boolean;
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
  // Legacy "Paid to customer" outs — still under that customer
  expenses
    .filter((e) => e.type === "custom" && !!e.custId)
    .forEach((e) => {
      const cid = e.custId!;
      const arr = byCust.get(cid) || [];
      arr.push({ key: e.id, cid, e, amount: +e.amount || 0, locked: false, paid: true });
      byCust.set(cid, arr);
    });
  // Category paid-outs (Food / Salary / Truck rent / …) — listed separately, no customer
  const paidOutList = expenses
    .filter(isCategoryPayout)
    .map((e) => ({ key: e.id, cid: "", e, amount: +e.amount || 0, locked: false, paid: true as const }))
    .sort((a, b) => (b.e.createdAt || "").localeCompare(a.e.createdAt || ""));
  const paidOutTotal = r2(paidOutList.reduce((s, x) => s + x.amount, 0));
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
      const received = sorted.filter((x) => !x.e.charge && !x.paid);
      const dues = sorted.filter((x) => x.e.charge);
      const paidOut = sorted.filter((x) => x.paid);
      return {
        cid,
        name: custName(cid),
        received: r2(received.reduce((s, x) => s + x.amount, 0)),
        dueAdded: r2(dues.reduce((s, x) => s + x.amount, 0)),
        paidOut: r2(paidOut.reduce((s, x) => s + x.amount, 0)),
        list: sorted,
      };
    })
    .sort((a, b) => b.received + b.dueAdded + b.paidOut - (a.received + a.dueAdded + a.paidOut));

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
    <div className="ledger-page">
      <div className="sectitle">
        Receipts <small>— record a payment received or paid out</small>
      </div>

      <div className="panel-card" style={{ padding: 16 }}>
        <div className="db-seg sm" style={{ margin: "0 0 14px" }}>
          <button className={"seg-btn" + (kind === "received" ? " on" : "")} type="button" onClick={() => setKind("received")} disabled={editing}>
            Received
          </button>
          <button className={"seg-btn" + (kind === "paid" ? " on" : "")} type="button" onClick={() => setKind("paid")} disabled={editing}>
            Paid out
          </button>
        </div>

        {kind === "received" && (
          <label className="modal-field" style={{ width: "100%" }}>
            <span>Customer</span>
            <CustomerPicker value={name} customers={customers} onType={onType} onPick={pickCustomer} placeholder="Search an existing customer…" />
          </label>
        )}

        {kind === "paid" && (
          <label className="modal-field" style={{ width: "100%", marginBottom: 4 }}>
            <span>Category</span>
            <select
              value={paidCat}
              onChange={(e) => {
                setPaidCat(e.target.value);
                if (e.target.value !== "minitruck") setPaidRounds("");
              }}
            >
              {SPEND_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </label>
        )}

        {kind === "received" && picked && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "10px 0 4px" }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 13 }}>
              Outstanding: <b style={{ color: outstanding > 0.5 ? "var(--danger)" : "var(--green)" }}>₹ {inr(outstanding)}</b>
            </span>
            {outstanding > 0.5 && !editing && (
              <button className="btn sm" type="button" onClick={() => setAmt(String(r2(outstanding)))}>
                Pay full
              </button>
            )}
          </div>
        )}

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

        {kind === "paid" && (
          <div style={{ marginTop: 12, width: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
            {paidCat === "carpenter" ? (
              <>
                <label className="modal-field" style={{ width: "100%" }}>
                  <span>Party / customer</span>
                  <CustomerPicker
                    value={paidParty}
                    customers={customers}
                    onType={(v) => {
                      setPaidParty(v);
                      setPaidCustId("");
                      setPaidQuoteId("");
                      setPaidCarpenter("");
                    }}
                    onPick={(c) => {
                      setPaidParty(c.name);
                      setPaidCustId(c.id);
                      setPaidQuoteId("");
                      setPaidCarpenter((c.site || "").trim());
                    }}
                    placeholder="Search customer or type a name…"
                    maxResults={12}
                  />
                </label>
                {paidCustId && (
                  <label className="modal-field" style={{ width: "100%" }}>
                    <span>Quotation (optional)</span>
                    <select
                      value={paidQuoteId}
                      onChange={(ev) => {
                        const id = ev.target.value;
                        setPaidQuoteId(id);
                        const q = paidCustQuotes.find((x) => x.d.id === id);
                        if (q?.carpenter) setPaidCarpenter(q.carpenter);
                        else if (paidCust?.site) setPaidCarpenter(paidCust.site.trim());
                      }}
                    >
                      <option value="">— none / all for this party —</option>
                      {paidCustQuotes.map((q) => (
                        <option key={q.d.id} value={q.d.id}>
                          #{q.no}
                          {q.d.date ? " · " + q.d.date : ""}
                          {q.carpenter ? " · " + q.carpenter : ""}
                          {" · ₹" + inr(q.total)}
                        </option>
                      ))}
                    </select>
                    {paidCustQuotes.length === 0 && (
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
                    placeholder={paidCust?.site ? "From customer: " + paidCust.site : "Carpenter name (optional)"}
                    value={paidCarpenter}
                    onChange={(ev) => setPaidCarpenter(ev.target.value)}
                  />
                </label>
              </>
            ) : (
              <label className="modal-field" style={{ width: "100%" }}>
                <span>Name (optional)</span>
                <input
                  type="text"
                  placeholder={paidCat === "minitruck" ? "e.g. driver / vehicle" : "e.g. who / where"}
                  value={paidParty}
                  onChange={(e) => setPaidParty(e.target.value)}
                />
              </label>
            )}
            {paidCat === "minitruck" && (
              <label className="modal-field" style={{ width: "100%", maxWidth: 200 }}>
                <span>Rounds</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  placeholder="0"
                  value={paidRounds}
                  onChange={(e) => setPaidRounds(e.target.value)}
                />
              </label>
            )}
          </div>
        )}

        {showReceivedFields && (
          <div className="modal-field" style={{ marginTop: 12, width: "100%" }}>
            <span>Use this money for</span>
            <div className="db-seg sm" style={{ marginTop: 4, flexWrap: "wrap" }}>
              <button
                className={"seg-btn" + (applyTo === "quotes" ? " on" : "")}
                type="button"
                onClick={() => { setApplyTo("quotes"); setQuoteId(""); }}
              >
                Oldest first
              </button>
              <button
                className={"seg-btn" + (applyTo === "quote" ? " on" : "")}
                type="button"
                onClick={() => setApplyTo("quote")}
                disabled={!picked || openQuotes.length === 0}
                title={!picked ? "Pick a customer first" : openQuotes.length ? "Settle one quotation" : "No open quotations for this customer"}
              >
                This quotation
              </button>
              <button
                className={"seg-btn" + (applyTo === "account" ? " on" : "")}
                type="button"
                onClick={() => { setApplyTo("account"); setQuoteId(""); }}
              >
                Account only
              </button>
            </div>
            {applyTo === "quote" && (
              <div style={{ marginTop: 10 }}>
                <label className="modal-field" style={{ width: "100%" }}>
                  <span>Which quotation</span>
                  <select value={quoteId} onChange={(e) => setQuoteId(e.target.value)}>
                    <option value="">— pick quotation —</option>
                    {openQuotes.map((q) => (
                      <option key={q.d.id} value={q.d.id}>
                        #{q.no} · Total ₹{inr(q.total)} · Due ₹{inr(q.due)}
                      </option>
                    ))}
                  </select>
                </label>
                {pickedQuote && (
                  <div style={{ marginTop: 8, fontFamily: "var(--mono)", fontSize: 13, display: "flex", gap: 16, flexWrap: "wrap" }}>
                    <span>Total <b>₹{inr(pickedQuote.total)}</b></span>
                    <span>Paid <b>₹{inr(r2(pickedQuote.total - pickedQuote.due))}</b></span>
                    <span style={{ color: "var(--danger)" }}>Due <b>₹{inr(pickedQuote.due)}</b></span>
                    <button className="btn sm" type="button" onClick={() => setAmt(String(pickedQuote.due))}>
                      Fill due
                    </button>
                  </div>
                )}
              </div>
            )}
            <small style={{ color: "var(--ink-faint)", marginTop: 4, display: "block" }}>
              {applyTo === "quotes"
                ? "Clears open quotations oldest-first; anything beyond stays on the account."
                : applyTo === "quote"
                  ? "Applies only to the quotation you pick — enter the amount manually (or Fill due)."
                  : "Whole amount pays the account balance only — not linked to any quotation."}
            </small>
          </div>
        )}

        {kind === "paid" && (
          <div className="att-paidby" style={{ marginTop: 12 }}>
            <span className="att-paidby-lbl">Paid by</span>
            <div className="db-seg sm">
              <button
                className={"seg-btn" + ((paidBy ?? (isOwner ? "owner" : "manager")) === "owner" ? " on" : "")}
                type="button"
                title="The Owner's own cash — the Daybook is untouched"
                onClick={() => setPaidBy("owner")}
              >
                Owner
              </button>
              <button
                className={"seg-btn" + ((paidBy ?? (isOwner ? "owner" : "manager")) === "manager" ? " on" : "")}
                type="button"
                title="The Manager's cash — cut from the Daybook"
                onClick={() => setPaidBy("manager")}
              >
                Manager
              </button>
            </div>
          </div>
        )}

        {editing && (
          <div className="pb-editbar no-print" style={{ marginTop: 12 }}>
            <span>
              Editing this {kind === "due" ? "due" : kind === "paid" ? "payment" : "receipt"}
              {editRcpt && editRcpt.pieces.some((x) => !!x.sourceId) ? " — saving re-applies it fresh (linked quotations adjust)" : ""}
            </span>
            <button type="button" onClick={resetForm}>
              Cancel
            </button>
          </div>
        )}

        <button className="btn primary" type="button" onClick={record} style={{ width: "100%", justifyContent: "center", marginTop: 14, padding: 12 }}>
          {editing
            ? "Save changes"
            : kind === "paid"
              ? "Record paid out — " + (SPEND_CATEGORIES.find((c) => c.id === paidCat)?.label || "Other")
              : "Record receipt"}
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
        Paid out <small>— ₹{inr(paidOutTotal)} · {paidOutList.length}</small>
      </div>
      {paidOutList.length ? (
        <div className="panel-card" style={{ padding: "0 0 4px" }}>
          {paidOutList.map((entry) => (
            <div className="stmt" key={entry.key}>
              <div className="stmt-ic due">{spendCategoryOf(entry.e).slice(0, 3)}</div>
              <div className="stmt-main">
                <div className="stmt-to">
                  {spendCategoryOf(entry.e)}
                  <span className="acct-overall-hint">
                    {" · "}{entry.e.toOwner ? "Owner's cash" : "Daybook"}
                    {" · "}{entry.e.date}
                  </span>
                </div>
                <div className="stmt-sub">
                  {(() => {
                    const d = spendDetailOf(entry.e);
                    return (d ? d + " · " : "") + "by " + userName(entry.e.enteredBy);
                  })()}
                </div>
              </div>
              <div className="stmt-amt due">−₹{inr(entry.amount)}</div>
              <span className="pb-rowacts">
                <button className="pb-x" title="Edit" type="button" onClick={() => startEdit(entry)} style={{ marginRight: 4 }}>✎</button>
                <button className="pb-x" title="Delete" type="button" onClick={() => remove(entry)}>×</button>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="panel-card">
          <div className="empty">No category paid-outs yet — Food, Salary, Truck rent, etc.</div>
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
                  {g.paidOut > 0 && <span style={{ color: "var(--ochre-deep)" }}>{g.received > 0 || g.dueAdded > 0 ? " · " : ""}₹{inr(g.paidOut)} paid out</span>}
                  {" · "}
                  {g.list.length} {g.list.length === 1 ? "entry" : "entries"}
                </span>
              </div>
              {open &&
                (() => {
                  // Build bank-format ledger rows: dues are debits, receipts are credits
                  const lRows: { date: string; particulars: string; debit: number; credit: number; balance: number; isClose?: boolean }[] = [];
                  let bal = 0;
                  for (const entry of g.list) {
                    const { e, amount } = entry;
                    if (entry.paid) {
                      bal += amount;
                      lRows.push({ date: e.date, particulars: "Paid out" + (e.note ? " · " + e.note : "") + " · " + (e.toOwner ? "Owner's cash" : "Daybook cash") + " · by " + userName(e.enteredBy), debit: amount, credit: 0, balance: bal });
                    } else if (e.charge) {
                      bal += amount;
                      lRows.push({ date: e.date, particulars: (e.note || "Due added") + " · by " + userName(e.enteredBy), debit: amount, credit: 0, balance: bal });
                    } else {
                      bal -= amount;
                      lRows.push({ date: e.date, particulars: (e.mode === "upi" ? "UPI" : "Cash") + " · " + (e.account || ""), debit: 0, credit: amount, balance: bal });
                    }
                  }
                  const due = bal > 0.5;
                  return (
                    <div className="bank-ledger" style={{ marginTop: 0 }}>
                      <div className="bank-hdr">
                        <span>Date</span>
                        <span>Particulars</span>
                        <span className="bank-amt">Dr ₹</span>
                        <span className="bank-amt">Cr ₹</span>
                        <span className="bank-amt">Balance</span>
                      </div>
                      {lRows.map((row, i) => {
                        const entry = g.list[i];
                        const { e, quoteNo, quoteId, locked, settled } = entry;
                        const isDue = !!e.charge;
                        return (
                          <div key={entry.key} className="bank-row" style={{ cursor: "default" }}>
                            <span className="bank-date">{row.date}</span>
                            <span className="bank-parts">
                              {entry.paid ? "" : isDue ? "Due – " : "Receipt – "}{row.particulars}
                              {settled && <small> · {settled}</small>}
                              {!isDue && quoteNo && <small> · #{quoteNo}</small>}
                              <span className="bl-acts">
                                {locked && quoteId ? (
                                  <button className="bl-btn" title="Open quotation" type="button" onClick={() => router.push("/editor/" + quoteId)}>↗</button>
                                ) : (
                                  <>
                                    <button className="bl-btn" title="Edit" type="button" onClick={() => startEdit(entry)}>✎</button>
                                    <button className="bl-btn danger" title="Delete" type="button" onClick={() => remove(entry)}>×</button>
                                  </>
                                )}
                              </span>
                            </span>
                            <span className={"bank-amt" + (row.debit > 0 ? " dr" : "")}>{row.debit > 0 ? "₹" + inr(row.debit) : ""}</span>
                            <span className={"bank-amt" + (row.credit > 0 ? " cr" : "")}>{row.credit > 0 ? "₹" + inr(row.credit) : ""}</span>
                            <span className={"bank-amt bal" + (i === lRows.length - 1 ? (due ? " due" : " ok") : "")}>
                              ₹{inr(Math.abs(row.balance))}
                              <span className={"bal-tag " + (row.balance > 0.5 ? "dr" : "cr")}>{row.balance > 0.5 ? "Dr" : "Cr"}</span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
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
