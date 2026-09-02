"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec } from "@/lib/data";
import { inr } from "@/lib/calc";
import {
  acctLedger,
  acctClearKey,
  addCollection,
  addHolder,
  addHolderAccount,
  addTransportDue,
  balanceAfter,
  deleteAccountEntry,
  deleteCollection,
  getClearMarks,
  holderClearKey,
  holderPassbookLines,
  isAccountTransportPay,
  isPendingTransport,
  isTransportPocket,
  listCollections,
  listHolders,
  listPayAccounts,
  markCleared,
  moveEntryAccount,
  popHolderOpening,
  removeHolder,
  removeHolderAccount,
  removePayAccount,
  renameHolder,
  setHolderKind,
  setHolderOpening,
  settleTransportDue,
  stashHolderOpening,
  unmarkCleared,
  type AccountCollection,
  type AcctBalance,
  type AcctStmtLine,
  type PayAccount,
  type PayHolder,
} from "@/lib/accounts";
import { brandFor } from "@/lib/brand";
import { addExpense, PAID_TO_MANAGER_LABEL } from "@/lib/expenses";
import { getFeatures } from "@/lib/features";
import { generatePdf } from "@/lib/pdf";
import { waLink } from "@/lib/whatsapp";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import { Paged } from "@/components/Pager";
import PdfButtons from "@/components/PdfButtons";
import type { Customer, Doc, Expense, Purchase, Supplier } from "@/lib/types";

const hhmm = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(+d) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};
const toDmy = (v: string) => {
  const [y, m, d] = (v || "").split("-");
  return d && m && y ? `${d}-${m}-${y.slice(2)}` : "";
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const lc = (s: string) => (s || "").trim().toLowerCase();

const emptyBal = (name: string): AcctBalance => ({
  name,
  received: 0,
  ownerReceived: 0,
  collected: 0,
  spent: 0,
  balance: 0,
  lines: [],
});

const genDate = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
};

interface AcctLedgerRow {
  date: string;
  at: string;
  particulars: string;
  detail: string;
  debit: number;
  credit: number;
  balance: number;
  l: AcctStmtLine;
  kind: "in" | "collect" | "transport";
  isOpen?: boolean;
  isClose?: boolean;
}
interface PrintDoc {
  title: string;
  summary: { k: string; v: string }[];
  rows: AcctLedgerRow[];
  preview?: boolean;
}

export default function AccountsView() {
  const { ready, dataVersion, user, brandMode, cloakMoney } = useApp();
  const brand = brandFor(brandMode);
  const router = useRouter();
  const [printDoc, setPrintDoc] = useState<PrintDoc | null>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const [quotesRaw, setQuotes] = useState<Doc[]>([]);
  const [expensesRaw, setExpenses] = useState<Expense[]>([]);
  const [customersRaw, setCustomers] = useState<Customer[]>([]);
  const [collectionsRaw, setCollections] = useState<AccountCollection[]>([]);
  const [registryRaw, setRegistry] = useState<PayAccount[]>([]);
  const [holdersRaw, setHolders] = useState<PayHolder[]>([]);
  const [suppliersRaw, setSuppliers] = useState<Supplier[]>([]);
  const [purchasesRaw, setPurchases] = useState<Purchase[]>([]);
  const quotes = cloakMoney ? [] : quotesRaw;
  const expenses = cloakMoney ? [] : expensesRaw;
  const customers = cloakMoney ? [] : customersRaw;
  const collections = cloakMoney ? [] : collectionsRaw;
  const registry = cloakMoney ? [] : registryRaw;
  const holders = cloakMoney ? [] : holdersRaw;
  const suppliers = cloakMoney ? [] : suppliersRaw;
  const purchases = cloakMoney ? [] : purchasesRaw;
  // "cleared log" watermarks — everything at/before a mark is hidden HERE only
  // (never deleted; quotations / Statements / Balances / Daybook keep it all)
  const [clearMarks, setClearMarks] = useState<Record<string, string>>({});

  // expand state — everything is OPEN by default (we track what's been collapsed), so the whole
  // ledger is visible at a glance without clicking into each holder/account.
  const [collapsedHolders, setCollapsedHolders] = useState<Set<string>>(new Set());
  const [collapsedAccts, setCollapsedAccts] = useState<Set<string>>(new Set());

  // collect form — either a holder (holderId) or an ungrouped account (name)
  const [collectHolder, setCollectHolder] = useState<string | null>(null);
  const [collectFor, setCollectFor] = useState<string | null>(null);
  const [cAmt, setCAmt] = useState("");
  const [cDate, setCDate] = useState("");
  const [cNote, setCNote] = useState("");
  /** Who receives the collected cash — Owner pocket vs Manager Daybook */
  const [cBy, setCBy] = useState<"owner" | "manager">("owner");

  // pay transport from a UPI pocket (Cut Size) — settles a locked due, does not create one
  const [payHolder, setPayHolder] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<string | null>(null);
  const [payDueId, setPayDueId] = useState<string | null>(null);
  const [tDate, setTDate] = useState("");
  const [showAddDue, setShowAddDue] = useState(false);
  const [dueParty, setDueParty] = useState("");
  const [dueAmt, setDueAmt] = useState("");
  const [dueFrom, setDueFrom] = useState("");
  const [dueDate, setDueDate] = useState("");
  const canPayTransport = !!getFeatures().acceptPayment;

  // move a payment to another account
  const [moveFor, setMoveFor] = useState<string | null>(null);
  const [rowMenu, setRowMenu] = useState<string | null>(null);

  useEffect(() => {
    if (!rowMenu && !moveFor) return;
    const onDoc = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest("[data-acct-row-ui]")) return;
      setRowMenu(null);
      setMoveFor(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setRowMenu(null);
      setMoveFor(null);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [rowMenu, moveFor]);

  // holder create / edit
  const [showAddHolder, setShowAddHolder] = useState(false);
  const [newHolder, setNewHolder] = useState("");
  const [newHolderTransport, setNewHolderTransport] = useState(false);
  const [renameForId, setRenameForId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [addAcctFor, setAddAcctFor] = useState<string | null>(null); // holderId
  const [newAcct, setNewAcct] = useState("");
  const [openingForId, setOpeningForId] = useState<string | null>(null); // holderId editing opening balance
  const [openingVal, setOpeningVal] = useState("");

  const load = useCallback(() => {
    Promise.all([
      allRec<Doc>("quotations"),
      allRec<Expense>("expenses"),
      allRec<Customer>("customers"),
      allRec<Supplier>("suppliers"),
      allRec<Purchase>("purchases"),
      listCollections(),
      listPayAccounts(),
      listHolders(),
      getClearMarks(),
    ]).then(([qs, es, cs, sups, buys, cols, reg, hs, marks]) => {
      setQuotes(qs);
      setExpenses(es);
      setCustomers(cs);
      setSuppliers(sups);
      setPurchases(buys);
      setCollections(cols);
      setRegistry(reg);
      setHolders(hs);
      setClearMarks(marks);
    });
  }, []);
  useEffect(() => {
    if (ready) load();
  }, [ready, dataVersion, load]);

  // Download the same passbook as on screen (Date / Particulars / Dr / Cr / Balance).
  useEffect(() => {
    if (!printDoc) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const el = printRef.current;
      if (!el) {
        setPrintDoc(null);
        return;
      }
      try {
        if (!printDoc.preview) toast("Preparing PDF…");
        await generatePdf(el, (printDoc.title || "statement").replace(/\s+/g, "-").toLowerCase(), {
          pageBreak: ".bank-row,.acct-print-sum,.acct-print-hdr",
          width: 700,
          title: (brand.name || "Accounts") + " — " + printDoc.title,
          marginMm: 8,
          preview: printDoc.preview,
        });
        if (!cancelled && !printDoc.preview) toast("Statement PDF downloaded \u2713");
      } catch {
        if (!cancelled) toast("Could not create the PDF");
      }
      setPrintDoc(null);
    }, 80);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [printDoc]);

  const ledger = useMemo(
    () => acctLedger(expenses, collections, quotes, customers),
    [expenses, collections, quotes, customers],
  );

  // every named account, even ones with no activity yet (holder sub-accounts + legacy registry).
  // Each account's log is cut at its clear-mark: older lines are hidden and its totals restart.
  const accounts = useMemo(() => {
    const cut = (a: AcctBalance) => balanceAfter(a, clearMarks[acctClearKey(a.name)]);
    const base = ledger.accounts.map(cut);
    const seen = new Set(base.map((a) => lc(a.name)));
    const empties: AcctBalance[] = [];
    const addEmpty = (name: string) => {
      const k = lc(name);
      if (!k || seen.has(k)) return;
      seen.add(k);
      empties.push(emptyBal(name.trim()));
    };
    holders.forEach((h) => h.accounts.forEach(addEmpty));
    registry.forEach((r) => addEmpty(r.name));
    return [...base, ...empties];
  }, [ledger, holders, registry, clearMarks]);

  const byName = useMemo(() => {
    const m = new Map<string, AcctBalance>();
    accounts.forEach((a) => m.set(lc(a.name), a));
    return m;
  }, [accounts]);

  const grouped = useMemo(() => {
    const g = new Set<string>();
    holders.forEach((h) => h.accounts.forEach((n) => g.add(lc(n))));
    return g;
  }, [holders]);

  const ungrouped = useMemo(
    () => accounts.filter((a) => !grouped.has(lc(a.name))),
    [accounts, grouped],
  );

  const allNames = useMemo(() => accounts.map((a) => a.name), [accounts]);

  // Auto-file: any ungrouped account whose name STARTS WITH a holder's name lands under that
  // holder automatically (e.g. "Tabrez GPay" → Tabrez). Names that match no holder stay
  // ungrouped for manual sorting later. Longest holder-name match wins. Self-terminating:
  // once attached the name is no longer ungrouped, so this settles after one pass.
  useEffect(() => {
    if (!ready || !holders.length) return;
    const toAttach = ungrouped
      .map((a) => {
        const h = holders
          .filter((x) => x.name.trim() && lc(a.name).startsWith(lc(x.name)))
          .sort((x, y) => y.name.length - x.name.length)[0];
        return h ? { holderId: h.id, name: a.name } : null;
      })
      .filter((x): x is { holderId: string; name: string } => !!x);
    if (!toAttach.length) return;
    Promise.all(toAttach.map((t) => addHolderAccount(t.holderId, t.name))).then(() => {
      load();
      bumpData();
    });
  }, [ready, ungrouped, holders, load]);

  // holder-level hand-overs (collections keyed by holderId), cut at the holder's clear-mark
  const holderCols = useCallback(
    (id: string) => {
      const cut = clearMarks[holderClearKey(id)] || "";
      return collections.filter((c) => c.holderId === id && (!cut || (c.createdAt || "") > cut));
    },
    [collections, clearMarks],
  );
  const holderColTotal = useMemo(
    () =>
      r2(
        collections
          .filter((c) => {
            if (!c.holderId) return false;
            const cut = clearMarks[holderClearKey(c.holderId)] || "";
            return !cut || (c.createdAt || "") > cut;
          })
          .reduce((s, c) => s + (+c.amount || 0), 0),
      ),
    [collections, clearMarks],
  );
  const holderPays = useCallback(
    (id: string) => {
      const cut = clearMarks[holderClearKey(id)] || "";
      return expenses.filter(
        (e) => isAccountTransportPay(e) && e.holderId === id && (!cut || (e.createdAt || "") > cut),
      );
    },
    [expenses, clearMarks],
  );
  const holderPayTotal = useMemo(
    () =>
      r2(
        expenses
          .filter((e) => {
            if (!isAccountTransportPay(e) || !e.holderId) return false;
            const cut = clearMarks[holderClearKey(e.holderId)] || "";
            return !cut || (e.createdAt || "") > cut;
          })
          .reduce((s, e) => s + (+e.amount || 0), 0),
      ),
    [expenses, clearMarks],
  );
  const pendingDues = useMemo(
    () =>
      expenses
        .filter(isPendingTransport)
        .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")),
    [expenses],
  );
  const pendingDueTotal = useMemo(
    () => r2(pendingDues.reduce((s, e) => s + (+e.amount || 0), 0)),
    [pendingDues],
  );
  const boughtHints = useMemo(() => {
    const s = new Set<string>();
    for (const x of suppliers) if (x.name.trim()) s.add(x.name.trim());
    for (const p of purchases) {
      if ((p.buyerName || "").trim()) s.add(p.buyerName!.trim());
      if ((p.fromName || "").trim()) s.add(p.fromName.trim());
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [suppliers, purchases]);

  const holderAccounts = (h: PayHolder) =>
    h.accounts.map((n) => byName.get(lc(n))).filter(Boolean) as AcctBalance[];

  // aggregate a holder: opening balance + money in across its accounts, minus everything handed over
  const holderView = (h: PayHolder) => {
    const subs = holderAccounts(h);
    const opening = r2(h.opening || 0);
    const received = r2(subs.reduce((s, a) => s + a.received, 0));
    const owner = r2(subs.reduce((s, a) => s + a.ownerReceived, 0));
    const subCollected = r2(subs.reduce((s, a) => s + a.collected, 0)); // legacy per-entry
    const cols = holderCols(h.id);
    const pays = holderPays(h.id);
    const collected = r2(subCollected + cols.reduce((s, c) => s + (+c.amount || 0), 0));
    const spent = r2(subs.reduce((s, a) => s + (a.spent || 0), 0) + pays.reduce((s, e) => s + (+e.amount || 0), 0));
    const balance = r2(opening + received - collected - spent);
    return { subs, opening, received, owner, collected, spent, balance, cols, pays };
  };

  // overall totals include holder opening balances + holder-level hand-overs
  // (computed over the CUT accounts, so cleared history stays out of the tiles too)
  const totalOpening = r2(holders.reduce((s, h) => s + (h.opening || 0), 0));
  const sumReceived = r2(accounts.reduce((s, a) => s + a.received, 0));
  const sumOwner = r2(accounts.reduce((s, a) => s + a.ownerReceived, 0));
  const totalCollected = r2(accounts.reduce((s, a) => s + a.collected, 0) + holderColTotal);
  const totalSpent = r2(accounts.reduce((s, a) => s + (a.spent || 0), 0) + holderPayTotal);
  const totalBalance = r2(sumReceived + totalOpening - totalCollected - totalSpent);

  // ── collect flow ──────────────────────────────────────────────────────────
  function startCollect(opts: { holderId?: string; account?: string }, balance: number, openKey: string) {
    cancelPay();
    setCollectHolder(opts.holderId || null);
    setCollectFor(opts.account || null);
    setCAmt(balance > 0 ? String(r2(balance)) : "");
    setCDate("");
    setCNote("");
    setCBy("owner");
    if (opts.account) setCollapsedAccts((s) => { const n = new Set(s); n.delete(openKey); return n; });
  }
  function cancelCollect() {
    setCollectHolder(null);
    setCollectFor(null);
    setCAmt("");
    setCDate("");
    setCNote("");
    setCBy("owner");
  }
  function cancelPay() {
    setPayHolder(null);
    setPayFor(null);
    setPayDueId(null);
    setTDate("");
  }
  function startPay(opts: { holderId?: string; account?: string }, _balance: number, openKey: string) {
    cancelCollect();
    if (!pendingDues.length) {
      setShowAddDue(true);
      toast("Add a transport due first, then pay it from this account");
      return;
    }
    setPayHolder(opts.holderId || null);
    setPayFor(opts.account || null);
    setPayDueId(pendingDues.length === 1 ? pendingDues[0].id : null);
    setTDate("");
    if (opts.account) setCollapsedAccts((s) => { const n = new Set(s); n.delete(openKey); return n; });
  }
  async function submitPay(opts: { holderId?: string; account: string }, maxBal: number) {
    const due = pendingDues.find((e) => e.id === payDueId);
    if (!due) return toast("Pick which transport due to pay");
    const a = +due.amount || 0;
    if (a > maxBal + 0.5) return toast("Need ₹" + inr(a) + " in this account (bal ₹" + inr(maxBal) + ")");
    const e = await settleTransportDue({
      id: due.id,
      account: opts.account,
      holderId: opts.holderId,
      date: tDate ? toDmy(tDate) : undefined,
      by: user?.id || "unknown",
    });
    if (!e) return toast("Could not record");
    cancelPay();
    load();
    bumpData();
    toast("₹" + inr(a) + " transport — " + (due.party || ""));
  }
  async function submitDue() {
    const party = dueParty.trim();
    if (!party) return toast("Enter the transporter name");
    const a = Math.max(0, +dueAmt || 0);
    if (a <= 0) return toast("Enter an amount");
    const e = await addTransportDue({
      party,
      amount: a,
      boughtFrom: dueFrom.trim(),
      date: dueDate ? toDmy(dueDate) : undefined,
      by: user?.id || "unknown",
    });
    if (!e) return toast("Could not record");
    setDueParty("");
    setDueAmt("");
    setDueFrom("");
    setDueDate("");
    setShowAddDue(false);
    load();
    bumpData();
    toast("Transport due · " + party + " · ₹" + inr(a));
  }
  async function delTransport(id: string, pending = false) {
    const ok = await confirmDialog({
      title: pending ? "Delete this transport due?" : "Delete this transport payment?",
      message: pending
        ? "Removes the locked bill. Nothing was paid from a UPI account."
        : "Removes it from this account and from Books — the amount goes back into the balance.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await deleteAccountEntry(id);
    if (payDueId === id) setPayDueId(null);
    load();
    bumpData();
    toast(pending ? "Transport due removed" : "Transport payment removed");
  }

  function renderPayForm(opts: { holderId?: string; account: string }, maxBal: number) {
    const picked = pendingDues.find((e) => e.id === payDueId);
    return (
      <div className="acct-form">
        <small style={{ display: "block", color: "var(--ink-faint)", marginBottom: 8 }}>
          Pay a locked due from this UPI — Books records Transport. Daybook cash is unchanged.
        </small>
        {pendingDues.map((e) => {
          const on = e.id === payDueId;
          const from = (e.boughtFrom || "").trim();
          return (
            <button
              key={e.id}
              type="button"
              className={"acct-chip" + (on ? " on" : "")}
              style={{ display: "flex", width: "100%", justifyContent: "space-between", marginBottom: 6, textAlign: "left" }}
              onClick={() => setPayDueId(e.id)}
            >
              <span>
                {(e.party || "—") + (from ? " · from " + from : "")}
              </span>
              <b>₹{inr(+e.amount || 0)}</b>
            </button>
          );
        })}
        {picked && +picked.amount > maxBal + 0.5 && (
          <small style={{ display: "block", color: "var(--danger)", marginBottom: 8 }}>
            This due is ₹{inr(+picked.amount)} — account has ₹{inr(maxBal)}.
          </small>
        )}
        <div className="acct-add-row" style={{ alignItems: "flex-end", flexWrap: "wrap", marginTop: 8 }}>
          <label className="modal-field" style={{ flex: "1 1 120px", minWidth: 0 }}>
            <span>Pay date (optional)</span>
            <input type="date" value={tDate} onChange={(e) => setTDate(e.target.value)} />
          </label>
        </div>
        <div className="rowbtns" style={{ marginTop: 10 }}>
          <button className="btn primary sm" type="button" onClick={() => submitPay(opts, maxBal)} disabled={!picked}>
            {picked ? "Pay ₹" + inr(+picked.amount) : "Pick a due"}
          </button>
          <button className="btn sm" type="button" onClick={cancelPay}>
            Cancel
          </button>
        </div>
      </div>
    );
  }
  async function submitCollect(opts: { holderId?: string; account: string }, maxBal: number) {
    const a = Math.max(0, +cAmt || 0);
    if (a <= 0) return toast("Enter an amount");
    if (a > maxBal + 0.5) return toast("That's more than the balance (₹" + inr(maxBal) + ")");
    const toManager = cBy === "manager";
    const date = cDate ? toDmy(cDate) : undefined;
    const note = cNote.trim();
    let expenseId: string | undefined;
    if (toManager) {
      // Cash into Manager Daybook (skip Books) — same mechanics as Paid to manager
      const exp = await addExpense({
        type: "sale",
        amount: a,
        mode: "cash",
        label: PAID_TO_MANAGER_LABEL,
        skipBooks: true,
        toOwner: false,
        party: opts.account,
        note: note || "Collected from " + opts.account,
        date,
        enteredBy: user?.id || "unknown",
      });
      expenseId = exp.id;
    }
    const c = await addCollection({
      account: opts.account,
      holderId: opts.holderId,
      amount: a,
      date,
      by: user?.id || "unknown",
      note,
      toManager,
      expenseId,
    });
    if (!c) return toast("Could not record");
    cancelCollect();
    load();
    bumpData();
    toast(
      "₹" +
        inr(a) +
        " collected → " +
        (toManager ? "Manager Daybook" : "Owner"),
    );
  }
  async function delCollection(id: string) {
    const col = collections.find((x) => x.id === id);
    const ok = await confirmDialog({
      title: "Delete this collection?",
      message: col?.toManager
        ? "Removes this hand-over and the linked Daybook entry — balance goes back."
        : "Removes this hand-over record — the amount goes back into the balance.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await deleteCollection(id);
    load();
    bumpData();
    toast("Collection removed");
  }
  async function delEntry(id: string, quoteNo?: string) {
    const ok = await confirmDialog({
      title: "Delete this UPI payment?",
      message:
        "Removes it from this account" +
        (quoteNo ? " and takes ₹ back off quotation #" + quoteNo + "'s paid total" : "") +
        ". Re-enter it if it was miscategorised.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await deleteAccountEntry(id);
    load();
    bumpData();
    toast("Payment removed");
  }
  async function moveEntry(id: string, to: string) {
    const okMove = await moveEntryAccount(id, to);
    setMoveFor(null);
    if (!okMove) return toast("Could not move");
    load();
    bumpData();
    toast("Moved to “" + to + "”");
  }

  // ── clear log & start fresh (owner) ──────────────────────────────────────
  // Hides this card's settled history behind a watermark and restarts its totals
  // at zero. NOTHING is deleted: every payment stays on its quotation and keeps
  // showing in Statements / Balances / Daybook. Undo brings the log back anytime.
  const isOwner = user?.role === "owner";
  const clearedOn = (key: string) => {
    const iso = clearMarks[key];
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(+d) ? "" : d.toLocaleDateString("en-GB");
  };
  async function clearAccountLog(a: AcctBalance) {
    const ok = await confirmDialog({
      title: "Clear “" + a.name + "” and start fresh?",
      message:
        "This only resets THIS account's log — the " +
        a.lines.length +
        " entries are hidden here and the totals restart from ₹0. Nothing is deleted: every payment stays on its quotation, Statements, Balances and the Daybook. You can Undo anytime.",
      confirmLabel: "Clear log",
    });
    if (!ok) return;
    await markCleared(acctClearKey(a.name));
    load();
    bumpData();
    toast("“" + a.name + "” starts fresh — history kept, Undo anytime");
  }
  async function clearHolderLog(h: PayHolder, v: ReturnType<typeof holderView>) {
    const ok = await confirmDialog({
      title: "Clear “" + h.name + "” and start fresh?",
      message:
        "Resets this holder's log (all their accounts + hand-overs" +
        (v.opening > 0 ? " + the ₹" + inr(v.opening) + " opening balance" : "") +
        ") back to ₹0 here. Nothing is deleted anywhere else — quotations, Statements, Balances and the Daybook keep every payment. You can Undo anytime.",
      confirmLabel: "Clear log",
    });
    if (!ok) return;
    await markCleared(holderClearKey(h.id));
    for (const name of h.accounts) await markCleared(acctClearKey(name));
    if ((h.opening || 0) > 0) {
      await stashHolderOpening(h.id, h.opening || 0); // so Undo can put it back
      await setHolderOpening(h.id, 0); // settled — fresh start owes nothing
    }
    load();
    bumpData();
    toast("“" + h.name + "” starts fresh — history kept, Undo anytime");
  }
  async function undoClear(keys: string[], label: string, holderId?: string) {
    for (const k of keys) await unmarkCleared(k);
    if (holderId) {
      const prev = await popHolderOpening(holderId);
      if (prev > 0) await setHolderOpening(holderId, prev);
    }
    load();
    bumpData();
    toast("“" + label + "” history is back");
  }

  // ── holder flow ───────────────────────────────────────────────────────────
  function toggleHolder(id: string) {
    setCollapsedHolders((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  async function createHolder() {
    const n = newHolder.trim();
    if (!n) return toast("Enter a holder name");
    const h = await addHolder(n, newHolderTransport ? "transport" : undefined);
    if (!h) return toast("That holder already exists");
    setNewHolder("");
    setNewHolderTransport(false);
    setShowAddHolder(false);
    load();
    bumpData();
    toast("Account holder “" + n + "” added");
  }
  async function submitRename(id: string) {
    const n = renameVal.trim();
    if (!n) return toast("Enter a name");
    const h = await renameHolder(id, n);
    if (!h) return toast("Couldn't rename (name in use?)");
    setRenameForId(null);
    setRenameVal("");
    load();
    bumpData();
  }
  async function submitOpening(id: string) {
    await setHolderOpening(id, +openingVal || 0);
    setOpeningForId(null);
    setOpeningVal("");
    load();
    bumpData();
    toast("Opening balance saved");
  }

  async function delHolder(h: PayHolder) {
    const ok = await confirmDialog({
      title: "Remove “" + h.name + "”?",
      message:
        h.accounts.length > 0
          ? "The " + h.accounts.length + " account" + (h.accounts.length === 1 ? "" : "s") + " and all their payments stay — they just move to Ungrouped."
          : "This holder has no accounts yet.",
      confirmLabel: "Remove holder",
      danger: true,
    });
    if (!ok) return;
    await removeHolder(h.id);
    load();
    bumpData();
    toast("Holder removed");
  }
  async function attachAccount(holderId: string, name: string) {
    const n = name.trim();
    if (!n) return toast("Enter an account name");
    const h = await addHolderAccount(holderId, n);
    if (!h) return toast("Couldn't add account");
    setNewAcct("");
    setAddAcctFor(null);
    load();
    bumpData();
    toast("“" + n + "” added");
  }
  async function detachAccount(holderId: string, name: string) {
    await removeHolderAccount(holderId, name);
    load();
    bumpData();
    toast("“" + name + "” moved to Ungrouped");
  }
  async function removeUngrouped(a: AcctBalance) {
    if (a.received > 0 || a.collected > 0 || a.lines.length > 0) return;
    const reg = registry.find((r) => lc(r.name) === lc(a.name));
    if (!reg) return;
    await removePayAccount(reg.id);
    load();
    bumpData();
    toast("Removed “" + a.name + "”");
  }

  function sendSummary(title: string, summary: { k: string; v: string }[]) {
    const text = [brand.name + " — " + title, ...summary.map((s) => s.k + ": " + s.v), "(as on " + genDate() + ")"].join("\n");
    window.open(waLink("", text), "_blank");
  }

  // ── build bank-format ledger rows for one account ────────────────────────
  function buildAcctLedger(a: AcctBalance, parentOpening = 0): AcctLedgerRow[] {
    const rows: Omit<AcctLedgerRow, "balance">[] = [];
    let bal = parentOpening;
    if (parentOpening > 0) {
      bal = parentOpening;
    }
    for (const line of a.lines) {
      if (line.kind === "in") {
        rows.push({
          date: line.date,
          at: line.at,
          particulars: `By UPI — ${line.customer || "—"}`,
          detail: [line.quoteNo ? `#${line.quoteNo}` : line.custId ? "receipt" : "", line.toOwner ? "to owner" : "", line.legacyCollected ? "✓" : ""].filter(Boolean).join(" · "),
          debit: 0,
          credit: line.amount,
          l: line,
          kind: "in",
        });
      } else if (line.kind === "transport") {
        rows.push({
          date: line.date,
          at: line.at,
          particulars: `To Transport — ${line.customer || "—"}`,
          detail: line.note || "",
          debit: line.amount,
          credit: 0,
          l: line,
          kind: "transport",
        });
      } else {
        rows.push({
          date: line.date,
          at: line.at,
          particulars: line.toManager ? "To Manager Daybook" : "To Owner",
          detail: line.note || "",
          debit: line.amount,
          credit: 0,
          l: line,
          kind: "collect",
        });
      }
    }
    const dayKey = (d: string) => { const [dd, mm, yy] = (d || "").split("-"); return dd && mm && yy ? `20${yy}-${mm}-${dd}` : ""; };
    rows.sort((x, y) => {
      const da = dayKey(x.date).localeCompare(dayKey(y.date));
      if (da !== 0) return da;
      return (x.at || "").localeCompare(y.at || "");
    });
    const result: AcctLedgerRow[] = [];
    if (parentOpening > 0) {
      result.push({ date: "", at: "", particulars: "Opening Balance", detail: "", debit: 0, credit: 0, balance: parentOpening, l: {} as AcctStmtLine, kind: "in", isOpen: true });
    }
    for (const r of rows) {
      bal += r.debit ? -r.debit : r.credit;
      result.push({ ...r, balance: bal });
    }
    result.push({ date: "", at: "", particulars: "Closing Balance", detail: "", debit: 0, credit: 0, balance: bal, l: {} as AcctStmtLine, kind: "in", isClose: true });
    return result;
  }

  function viewLine(row: AcctLedgerRow) {
    if (row.kind === "in" && row.l.quoteNo) {
      const id = quotes.find((d) => d.number === row.l.quoteNo)?.id;
      if (id) router.push("/editor/" + id);
    } else if (row.kind === "in" && row.l.custId) {
      router.push("/receipts?cust=" + encodeURIComponent(row.l.custId));
    }
  }
  function txnMeta(row: AcctLedgerRow) {
    if (row.isOpen || row.isClose) return "";
    const bits: string[] = [];
    if (row.detail) bits.push(row.detail);
    const t = hhmm(row.l.at);
    if (t) bits.push(t);
    return bits.join(" · ");
  }

  function pdfHolder(h: PayHolder, preview = false) {
    const v = holderView(h);
    const book: AcctBalance =
      v.subs.length === 1
        ? { ...v.subs[0], spent: v.spent, lines: holderPassbookLines(v.subs, v.cols, v.pays) }
        : {
            name: h.name,
            received: v.received,
            ownerReceived: v.owner,
            collected: v.collected,
            spent: v.spent,
            balance: v.balance,
            lines: holderPassbookLines(v.subs, v.cols, v.pays),
          };
    setPrintDoc({
      title: h.name,
      preview,
      summary: [
        ...(v.opening > 0 ? [{ k: "Opening", v: "₹ " + inr(v.opening) }] : []),
        { k: "Received", v: "₹ " + inr(v.received) },
        { k: "Collected", v: "₹ " + inr(v.collected) },
        ...(v.spent > 0.5 ? [{ k: "Transport", v: "₹ " + inr(v.spent) }] : []),
        { k: "Balance", v: "₹ " + inr(v.balance) },
      ],
      rows: buildAcctLedger(book, v.opening),
    });
  }
  function pdfAccount(a: AcctBalance, preview = false) {
    setPrintDoc({
      title: a.name,
      preview,
      summary: [
        { k: "Received", v: "₹ " + inr(a.received) },
        { k: "Collected", v: "₹ " + inr(a.collected) },
        ...(a.spent > 0.5 ? [{ k: "Transport", v: "₹ " + inr(a.spent) }] : []),
        { k: "Balance", v: "₹ " + inr(a.balance) },
      ],
      rows: buildAcctLedger(a, 0),
    });
  }

  // ── render an account's full bank-ledger table ──────────────────────────
  function renderAccountLedger(a: AcctBalance, parentOpening = 0) {
    const ledgerRows = buildAcctLedger(a, parentOpening);
    const due = ledgerRows.length > 0 ? ledgerRows[ledgerRows.length - 1].balance > 0.5 : false;
    const moveTargets = allNames.filter((n) => lc(n) !== lc(a.name));
    return (
      <Paged items={ledgerRows} resetKey={a.name + "\0" + parentOpening}>
        {(view) => (
      <div className="bank-ledger acct-book">
        <div className="bank-hdr">
          <span>Date</span>
          <span>Particulars</span>
          <span className="bank-amt">Dr</span>
          <span className="bank-amt">Cr</span>
          <span className="bank-amt">Balance</span>
          <span className="acct-txn-more-slot" aria-hidden="true" />
        </div>
        {view.map((row, i) => {
          const isUpi = row.kind === "in" && !row.isOpen && !row.isClose;
          const isTxn = !row.isOpen && !row.isClose;
          const menuId = row.l.id || "";
          const menuOpen = isTxn && rowMenu === menuId;
          const moving = isUpi && moveFor === menuId;
          const canView = isUpi && !!(row.l.quoteNo || row.l.custId);
          const canEdit = isUpi && !!row.l.quoteNo;
          const meta = txnMeta(row);
          const rowCls = [
            "bank-row",
            "acct-txn",
            row.isOpen ? "bank-open" : "",
            row.isClose ? "bank-total" : "",
            menuOpen || moving ? "on" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <div key={row.l.id || row.date + "-" + i} className={rowCls}>
              <span className="bank-date">{isTxn ? row.date : ""}</span>
              <span className="bank-parts">
                <span className="acct-txn-who">{row.particulars}</span>
                {meta ? <small>{meta}</small> : null}
              </span>
              <span className={"bank-amt" + (row.debit > 0 ? " dr" : "")}>{row.debit > 0 ? "₹" + inr(row.debit) : ""}</span>
              <span className={"bank-amt" + (row.credit > 0 ? " cr" : "")}>{row.credit > 0 ? "₹" + inr(row.credit) : ""}</span>
              <span className={"bank-amt bal" + (row.isClose ? (due ? " due" : " ok") : "")}>
                ₹{inr(Math.abs(row.balance))}
                {!row.isOpen && (
                  <span className={"bal-tag " + (row.balance > 0.5 ? "dr" : "cr")}>{row.balance > 0.5 ? "Dr" : "Cr"}</span>
                )}
              </span>
              {isTxn ? (
                <span className="acct-txn-more" data-acct-row-ui>
                  <button
                    type="button"
                    className={"acct-more-btn" + (menuOpen || moving ? " on" : "")}
                    aria-label="Transaction actions"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={() => {
                      setRowMenu(menuOpen ? null : menuId);
                      if (moveFor && moveFor !== menuId) setMoveFor(null);
                    }}
                  >
                    ⋮
                  </button>
                  {menuOpen && (
                    <div className="acct-row-menu" role="menu">
                      {canView && (
                        <button type="button" role="menuitem" onClick={() => { setRowMenu(null); viewLine(row); }}>
                          View
                        </button>
                      )}
                      {canEdit && (
                        <button type="button" role="menuitem" onClick={() => { setRowMenu(null); viewLine(row); }}>
                          Edit
                        </button>
                      )}
                      {isUpi && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMoveFor(menuId);
                            setRowMenu(null);
                          }}
                        >
                          Transfer / Adjust
                        </button>
                      )}
                      {isUpi && (
                        <button
                          type="button"
                          role="menuitem"
                          className="danger"
                          onClick={() => {
                            setRowMenu(null);
                            delEntry(row.l.id, row.l.quoteNo);
                          }}
                        >
                          Delete
                        </button>
                      )}
                      {row.kind === "collect" && (
                        <button
                          type="button"
                          role="menuitem"
                          className="danger"
                          onClick={() => {
                            setRowMenu(null);
                            delCollection(row.l.id);
                          }}
                        >
                          Delete
                        </button>
                      )}
                      {row.kind === "transport" && (
                        <button
                          type="button"
                          role="menuitem"
                          className="danger"
                          onClick={() => {
                            setRowMenu(null);
                            delTransport(row.l.id);
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </span>
              ) : (
                <span className="acct-txn-more-slot" aria-hidden="true" />
              )}
              {moving && (
                <div className="acct-move" data-acct-row-ui>
                  <span className="acct-move-lbl">Move to</span>
                  {moveTargets.length ? (
                    moveTargets.map((n) => (
                      <button key={n} type="button" className="acct-chip" onClick={() => moveEntry(row.l.id, n)}>
                        {n}
                      </button>
                    ))
                  ) : (
                    <span className="acct-move-lbl">No other account</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
        )}
      </Paged>
    );
  }

  function pocketActions(opts: {
    transport: boolean;
    onCollect: () => void;
    onPay: () => void;
  }) {
    const collect = (
      <button
        className={(opts.transport ? "btn sm" : "btn primary sm") + " acct-collect-btn"}
        type="button"
        title={opts.transport ? "Hand leftover to owner — not a lorry pay" : undefined}
        onClick={opts.onCollect}
      >
        {opts.transport ? "Collect leftover" : "Collect"}
      </button>
    );
    const pay = canPayTransport ? (
      <button
        className={(opts.transport ? "btn primary sm" : "btn sm") + " acct-pay-btn"}
        type="button"
        onClick={opts.onPay}
      >
        Pay transport
      </button>
    ) : null;
    return opts.transport ? <>{pay}{collect}</> : <>{collect}{pay}</>;
  }

  // ── one sub-account (bank-format ledger + collect form + actions) ────────
  function renderAccount(a: AcctBalance, holderId?: string) {
    const isOpen = !collapsedAccts.has(a.name);
    const due = a.balance > 0.5;
    const collecting = collectFor === a.name;
    const paying = payFor === a.name;
    const cleared = !due && a.received > 0;
    const grouped = !!holderId;
    const holder = grouped ? holders.find((h) => h.id === holderId) : undefined;
    const holderSubs = holder ? holderAccounts(holder) : [];
    const soleSub = grouped && holderSubs.length === 1;
    const parentOpening = soleSub ? holder!.opening || 0 : 0;
    const book: AcctBalance = soleSub
      ? { ...a, lines: holderPassbookLines([a], holderCols(holder!.id), holderPays(holder!.id)) }
      : a;
    const showLedger = !grouped || soleSub;
    return (
      <div className={"acct-sub" + (cleared && !grouped ? " acct-done" : "")} key={a.name}>
        <div className="acct-sub-bar">
          <span className="acct-sub-name" onClick={() => setCollapsedAccts((s) => { const n = new Set(s); isOpen ? n.add(a.name) : n.delete(a.name); return n; })}>
            <span className="um-caret" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
            {a.name}
            {cleared && !grouped && <span className="acct-collected-badge">Cleared ✓</span>}
          </span>
          {a.received > 0 && <span className="acct-sub-fig">₹{inr(a.received)}</span>}
          {a.ownerReceived > 0 && <span className="acct-sub-note">Owner ₹{inr(a.ownerReceived)}</span>}
          {!grouped && due && <span className="acct-sub-note due">Bal ₹{inr(a.balance)}</span>}
          {!grouped && !due && a.collected > 0 && <span className="acct-sub-note ok">₹{inr(a.collected)}</span>}
          {!grouped && due && !collecting && !paying && pocketActions({
            transport: isTransportPocket(undefined, a.name),
            onCollect: () => startCollect({ account: a.name }, a.balance, a.name),
            onPay: () => startPay({ account: a.name }, a.balance, a.name),
          })}
          {!grouped && (a.received > 0 || a.lines.length > 0) && (
            <>
              <PdfButtons onPreview={() => pdfAccount(a, true)} onDownload={() => pdfAccount(a)} />
              <button
                className="btn wa sm"
                type="button"
                title="Send summary on WhatsApp"
                onClick={() => sendSummary(a.name, [
                  { k: "Received", v: "₹" + inr(a.received) },
                  { k: "Collected", v: "₹" + inr(a.collected) },
                  ...(a.spent > 0.5 ? [{ k: "Transport", v: "₹" + inr(a.spent) }] : []),
                  { k: "Balance", v: "₹" + inr(a.balance) },
                ])}
              >
                Send
              </button>
              {isOwner && cleared && (
                <button
                  className="btn sm"
                  type="button"
                  title="Everything is settled — hide this log here and start from ₹0 (nothing is deleted, undo anytime)"
                  onClick={() => clearAccountLog(a)}
                >
                  Clear log
                </button>
              )}
            </>
          )}
          {grouped ? (
            <button className="pb-x" title="Move to Ungrouped" onClick={() => detachAccount(holderId, a.name)}>
              ×
            </button>
          ) : (
            a.received === 0 && a.collected === 0 && a.lines.length === 0 && registry.some((r) => lc(r.name) === lc(a.name)) && (
              <button className="pb-x" title="Remove saved name" onClick={() => removeUngrouped(a)}>
                ×
              </button>
            )
          )}
        </div>

        {!grouped && collecting && (
          <div className="acct-form">
            <div className="db-seg sm" style={{ marginBottom: 10 }}>
              <button type="button" className={"seg-btn" + (cBy === "owner" ? " on" : "")} onClick={() => setCBy("owner")}>
                By Owner
              </button>
              <button type="button" className={"seg-btn" + (cBy === "manager" ? " on" : "")} onClick={() => setCBy("manager")}>
                By Manager
              </button>
            </div>
            <small style={{ display: "block", color: "var(--ink-faint)", marginBottom: 8 }}>
              {cBy === "manager"
                ? "Cash goes into Manager Daybook balance (not in Books)."
                : "Cash to Owner — account balance drops, Daybook unchanged."}
            </small>
            <div className="acct-add-row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
              <label className="modal-field" style={{ flex: "1 1 120px", minWidth: 0 }}>
                <span>Collect ₹ <small style={{ color: "var(--ink-faint)" }}>(bal ₹{inr(a.balance)})</small></span>
                <input type="number" inputMode="decimal" placeholder={inr(a.balance)} value={cAmt} onChange={(e) => setCAmt(e.target.value)} autoFocus />
              </label>
              <label className="modal-field" style={{ flex: "1 1 120px", minWidth: 0 }}>
                <span>Date (optional)</span>
                <input type="date" value={cDate} onChange={(e) => setCDate(e.target.value)} />
              </label>
              <label className="modal-field" style={{ flex: "2 1 160px", minWidth: 0 }}>
                <span>Note (optional)</span>
                <input type="text" placeholder="e.g. handed to Afsar" value={cNote} onChange={(e) => setCNote(e.target.value)} />
              </label>
            </div>
            <div className="rowbtns" style={{ marginTop: 10 }}>
              <button className="btn primary sm" type="button" onClick={() => submitCollect({ account: a.name }, a.balance)}>
                Record collection
              </button>
              <button className="btn sm" type="button" onClick={cancelCollect}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {!grouped && paying && renderPayForm({ account: a.name }, a.balance)}

        {isOpen && showLedger &&
          (book.lines.length || parentOpening > 0 ? (
            <>{renderAccountLedger(book, parentOpening)}</>
          ) : clearMarks[acctClearKey(a.name)] ? (
            <div className="stmt-sub" style={{ padding: "8px 12px", opacity: 0.7 }}>
              Log cleared on {clearedOn(acctClearKey(a.name))} — fresh start. History is kept everywhere else.
              {isOwner && !grouped && (
                <button className="btn sm" type="button" style={{ marginLeft: 8 }} onClick={() => undoClear([acctClearKey(a.name)], a.name)}>
                  Undo
                </button>
              )}
            </div>
          ) : (
            <div className="stmt-sub" style={{ padding: "8px 12px", opacity: 0.7 }}>No UPI payments to this account yet.</div>
          ))}
      </div>
    );
  }

  const ungroupedNames = ungrouped.map((a) => a.name);

  return (
    <div className="ledger-page acct-page">
      <div className="cd-screen">
      <div className="sectitle">
        Accounts <small>— holders, their UPI accounts &amp; hand-overs</small>
      </div>

      {/* overall */}
      <div className="acct-overall">
        <div className="acct-overall-h">Overall</div>
        <div className={"acct-overall-grid" + (canPayTransport ? " has-transport" : "")}>
          <div className="acct-stat">
            <span className="k">To collect</span>
            <span className={"v" + (totalBalance <= 0.5 ? " ok" : " due")}>₹ {inr(totalBalance)}</span>
            <span className="sub">still in accounts</span>
          </div>
          <div className="acct-stat">
            <span className="k">Received (UPI)</span>
            <span className="v">₹ {inr(sumReceived)}</span>
            <span className="sub">{sumOwner > 0.5 ? "+ ₹" + inr(sumOwner) + " to owner" : "collectable"}</span>
          </div>
          <div className="acct-stat">
            <span className="k">Collected</span>
            <span className="v ok">₹ {inr(totalCollected)}</span>
            <span className="sub">handed over</span>
          </div>
          {canPayTransport && (
            <div className="acct-stat">
              <span className="k">Transport</span>
              <span className="v">₹ {inr(totalSpent)}</span>
              <span className="sub">
                {pendingDues.length
                  ? pendingDues.length + " due · ₹" + inr(pendingDueTotal)
                  : "paid from UPI"}
              </span>
            </div>
          )}
        </div>
      </div>

      {canPayTransport && (
        <>
          <div className="acct-day-label">
            <span>Transport due · {pendingDues.length}</span>
            <button
              className="btn sm"
              type="button"
              style={{ marginLeft: "auto" }}
              onClick={() => setShowAddDue((v) => !v)}
            >
              {showAddDue ? "Done" : "+ Transport due"}
            </button>
          </div>
          {showAddDue && (
            <div className="acct-form">
              <small style={{ display: "block", color: "var(--ink-faint)", marginBottom: 8 }}>
                Lock the lorry bill now. Pay it later from a UPI account — nothing leaves CS Kumar until then.
              </small>
              <div className="acct-add-row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
                <label className="modal-field" style={{ flex: "2 1 160px", minWidth: 0 }}>
                  <span>Transporter</span>
                  <input
                    type="text"
                    placeholder="e.g. Raju lorry"
                    value={dueParty}
                    onChange={(e) => setDueParty(e.target.value)}
                    autoFocus
                  />
                </label>
                <label className="modal-field" style={{ flex: "1 1 110px", minWidth: 0 }}>
                  <span>Amount ₹</span>
                  <input type="number" inputMode="decimal" placeholder="0" value={dueAmt} onChange={(e) => setDueAmt(e.target.value)} />
                </label>
                <label className="modal-field" style={{ flex: "2 1 160px", minWidth: 0 }}>
                  <span>Purchased from</span>
                  <input
                    type="text"
                    list="acct-bought-from"
                    placeholder="e.g. Dhannaram"
                    value={dueFrom}
                    onChange={(e) => setDueFrom(e.target.value)}
                  />
                  <datalist id="acct-bought-from">
                    {boughtHints.map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
                </label>
                <label className="modal-field" style={{ flex: "1 1 120px", minWidth: 0 }}>
                  <span>Date (optional)</span>
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </label>
              </div>
              <div className="rowbtns" style={{ marginTop: 10 }}>
                <button className="btn primary sm" type="button" onClick={submitDue}>
                  Lock due
                </button>
                <button className="btn sm" type="button" onClick={() => setShowAddDue(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {pendingDues.length > 0 && (
            <div className="acct-form" style={{ paddingTop: 8 }}>
              {pendingDues.map((e) => {
                const from = (e.boughtFrom || "").trim();
                return (
                  <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <b>{e.party || "—"}</b>
                      {" · ₹" + inr(+e.amount || 0)}
                      {from ? " · from " + from : ""}
                    </span>
                    <button className="btn sm danger" type="button" onClick={() => delTransport(e.id, true)}>
                      Delete
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <div className="acct-day-label">
        <span>Account holders · {holders.length}</span>
        <button className="btn sm" type="button" style={{ marginLeft: "auto" }} onClick={() => setShowAddHolder((v) => !v)}>
          {showAddHolder ? "Done" : "+ Account holder"}
        </button>
      </div>

      {showAddHolder && (
        <div className="acct-form">
          <div className="acct-add-row">
            <label className="modal-field" style={{ flex: 1, minWidth: 0 }}>
              <span>New holder name</span>
              <input
                type="text"
                placeholder="e.g. Tabrez"
                value={newHolder}
                onChange={(e) => setNewHolder(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createHolder()}
                autoFocus
              />
            </label>
            <button className="btn primary" type="button" onClick={createHolder} style={{ alignSelf: "flex-end" }}>
              Add
            </button>
          </div>
          <label className="note" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, opacity: 0.85 }}>
            <input type="checkbox" checked={newHolderTransport} onChange={(e) => setNewHolderTransport(e.target.checked)} />
            Transport pocket — Pay transport is the main button (lorry from this UPI)
          </label>
          <p className="note" style={{ marginTop: 8, opacity: 0.75 }}>
            A holder is a person who receives UPI on your behalf. Add their accounts inside — you collect from the holder, and the running total is what matters.
          </p>
        </div>
      )}

      {/* holders */}
      {holders.map((h) => {
        const { subs, opening, received, owner, collected, spent, balance, cols, pays } = holderView(h);
        const isOpen = !collapsedHolders.has(h.id);
        const due = balance > 0.5;
        const renaming = renameForId === h.id;
        const adding = addAcctFor === h.id;
        const collecting = collectHolder === h.id;
        const paying = payHolder === h.id;
        const editingOpening = openingForId === h.id;
        return (
          <div className="acct-holder" key={h.id}>
            <div className="acct-holder-bar">
              {renaming ? (
                <span style={{ flex: 1, display: "flex", gap: 6 }}>
                  <input
                    className="acct-new"
                    style={{ flex: 1 }}
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submitRename(h.id)}
                    autoFocus
                  />
                  <button className="btn primary sm" type="button" onClick={() => submitRename(h.id)}>Save</button>
                  <button className="btn sm" type="button" onClick={() => setRenameForId(null)}>Cancel</button>
                </span>
              ) : (
                <>
                  <span style={{ cursor: "pointer", flex: 1, minWidth: 0, fontWeight: 600 }} onClick={() => toggleHolder(h.id)}>
                    <span className="um-caret" style={{ marginRight: 6 }}>{isOpen ? "▾" : "▸"}</span>
                    {h.name}
                    <span className="acct-holder-count"> · {subs.length} acc{subs.length === 1 ? "" : "s"}</span>
                  </span>
                  <span className="acct-holder-meta">
                    {opening > 0 && <span>Opening ₹{inr(opening)}</span>}
                    {owner > 0 && <span>Owner ₹{inr(owner)}</span>}
                    {due ? <span className="due">Bal ₹{inr(balance)}</span> : received > 0 ? <span className="ok">Cleared</span> : null}
                  </span>
                  {due && !collecting && !paying && pocketActions({
                    transport: isTransportPocket(h),
                    onCollect: () => startCollect({ holderId: h.id }, balance, h.id),
                    onPay: () => startPay({ holderId: h.id }, balance, h.id),
                  })}
                </>
              )}
            </div>

            {collecting && (
              <div className="acct-form">
                <div className="db-seg sm" style={{ marginBottom: 10 }}>
                  <button type="button" className={"seg-btn" + (cBy === "owner" ? " on" : "")} onClick={() => setCBy("owner")}>
                    By Owner
                  </button>
                  <button type="button" className={"seg-btn" + (cBy === "manager" ? " on" : "")} onClick={() => setCBy("manager")}>
                    By Manager
                  </button>
                </div>
                <small style={{ display: "block", color: "var(--ink-faint)", marginBottom: 8 }}>
                  {cBy === "manager"
                    ? "Cash goes into Manager Daybook balance (not in Books)."
                    : "Cash to Owner — account balance drops, Daybook unchanged."}
                </small>
                <div className="acct-add-row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
                  <label className="modal-field" style={{ flex: "1 1 120px", minWidth: 0 }}>
                    <span>Collect ₹ <small style={{ color: "var(--ink-faint)" }}>(bal ₹{inr(balance)})</small></span>
                    <input type="number" inputMode="decimal" placeholder={inr(balance)} value={cAmt} onChange={(e) => setCAmt(e.target.value)} autoFocus />
                  </label>
                  <label className="modal-field" style={{ flex: "1 1 120px", minWidth: 0 }}>
                    <span>Date (optional)</span>
                    <input type="date" value={cDate} onChange={(e) => setCDate(e.target.value)} />
                  </label>
                  <label className="modal-field" style={{ flex: "2 1 160px", minWidth: 0 }}>
                    <span>Note (optional)</span>
                    <input type="text" placeholder="e.g. handed to owner" value={cNote} onChange={(e) => setCNote(e.target.value)} />
                  </label>
                </div>
                <div className="rowbtns" style={{ marginTop: 10 }}>
                  <button className="btn primary sm" type="button" onClick={() => submitCollect({ holderId: h.id, account: h.name }, balance)}>
                    Record collection
                  </button>
                  <button className="btn sm" type="button" onClick={cancelCollect}>Cancel</button>
                  {balance > 0.5 && (
                    <button className="btn sm" type="button" onClick={() => setCAmt(String(r2(balance)))}>Full ₹{inr(balance)}</button>
                  )}
                </div>
              </div>
            )}

            {paying && renderPayForm({ holderId: h.id, account: h.name }, balance)}

            {isOpen && (
              <div className="acct-holder-body">
                {subs.length ? (
                  <>
                    {subs.map((a) => renderAccount(a, h.id))}
                    {subs.length > 1 && (holderPassbookLines(subs, cols, pays).length > 0 || opening > 0) &&
                      renderAccountLedger(
                        {
                          name: h.name,
                          received,
                          ownerReceived: owner,
                          collected,
                          spent,
                          balance,
                          lines: holderPassbookLines(subs, cols, pays),
                        },
                        opening,
                      )}
                  </>
                ) : (
                  <>
                    <div className="stmt-sub" style={{ padding: "6px 4px", opacity: 0.7 }}>No accounts yet — add one below.</div>
                    {(cols.length > 0 || pays.length > 0 || opening > 0) &&
                      renderAccountLedger(
                        {
                          name: h.name,
                          received,
                          ownerReceived: owner,
                          collected,
                          spent,
                          balance,
                          lines: holderPassbookLines([], cols, pays),
                        },
                        opening,
                      )}
                  </>
                )}

                {editingOpening && (
                  <div className="acct-form">
                    <div className="acct-add-row" style={{ alignItems: "flex-end" }}>
                      <label className="modal-field" style={{ flex: 1, minWidth: 0 }}>
                        <span>Opening balance ₹ <small style={{ color: "var(--ink-faint)" }}>(already in {h.name}&apos;s hands)</small></span>
                        <input
                          type="number"
                          inputMode="decimal"
                          placeholder="0"
                          value={openingVal}
                          onChange={(e) => setOpeningVal(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && submitOpening(h.id)}
                          autoFocus
                        />
                      </label>
                      <button className="btn primary" type="button" onClick={() => submitOpening(h.id)} style={{ alignSelf: "flex-end" }}>Save</button>
                      <button className="btn" type="button" onClick={() => { setOpeningForId(null); setOpeningVal(""); }} style={{ alignSelf: "flex-end" }}>Cancel</button>
                    </div>
                  </div>
                )}

                {adding ? (
                  <div className="acct-form">
                    <div className="acct-add-row">
                      <label className="modal-field" style={{ flex: 1, minWidth: 0 }}>
                        <span>Account name</span>
                        <input
                          type="text"
                          placeholder="e.g. Tabrez GPay"
                          value={newAcct}
                          onChange={(e) => setNewAcct(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && attachAccount(h.id, newAcct)}
                          autoFocus
                        />
                      </label>
                      <button className="btn primary" type="button" onClick={() => attachAccount(h.id, newAcct)} style={{ alignSelf: "flex-end" }}>
                        Add
                      </button>
                      <button className="btn" type="button" onClick={() => { setAddAcctFor(null); setNewAcct(""); }} style={{ alignSelf: "flex-end" }}>
                        Cancel
                      </button>
                    </div>
                    {ungroupedNames.length > 0 && (
                      <>
                        <div className="stmt-sub" style={{ margin: "8px 2px 4px", opacity: 0.7 }}>or move an existing account here:</div>
                        <div className="acct-pick">
                          {ungroupedNames.map((n) => (
                            <button key={n} type="button" className="acct-chip" onClick={() => attachAccount(h.id, n)}>
                              {n}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="rowbtns acct-holder-actions">
                    <button className="btn sm primary" type="button" onClick={() => { setAddAcctFor(h.id); setNewAcct(""); }}>
                      + Account
                    </button>
                    <PdfButtons onPreview={() => pdfHolder(h, true)} onDownload={() => pdfHolder(h)} />
                    <button className="btn sm wa" type="button" onClick={() => sendSummary(h.name, [
                      ...(opening > 0 ? [{ k: "Opening", v: "₹" + inr(opening) }] : []),
                      { k: "Received", v: "₹" + inr(received) },
                      { k: "Collected", v: "₹" + inr(collected) },
                      ...(spent > 0.5 ? [{ k: "Transport", v: "₹" + inr(spent) }] : []),
                      { k: "Balance", v: "₹" + inr(balance) },
                    ])}>
                      Send
                    </button>
                    <button className="btn sm" type="button" onClick={() => { setOpeningForId(h.id); setOpeningVal(opening ? String(opening) : ""); }}>
                      {opening > 0 ? "Opening ₹" + inr(opening) : "Opening balance"}
                    </button>
                    <button className="btn sm" type="button" onClick={() => { setRenameForId(h.id); setRenameVal(h.name); }}>
                      Rename
                    </button>
                    {canPayTransport && (
                      <button
                        className={"btn sm" + (isTransportPocket(h) ? " primary" : "")}
                        type="button"
                        title={isTransportPocket(h) ? "Switch back to Collect as the main button" : "Pay lorries from this UPI — Collect stays for leftover"}
                        onClick={async () => {
                          await setHolderKind(h.id, isTransportPocket(h) ? "collect" : "transport");
                          load();
                          bumpData();
                        }}
                      >
                        {isTransportPocket(h) ? "Transport pocket ✓" : "Mark transport"}
                      </button>
                    )}
                    {isOwner && !due && (received > 0 || collected > 0 || spent > 0) && (
                      <button
                        className="btn sm"
                        type="button"
                        title="All settled — hide this holder's log here and start from ₹0 (nothing is deleted, undo anytime)"
                        onClick={() => clearHolderLog(h, { subs, opening, received, owner, collected, spent, balance, cols, pays })}
                      >
                        Clear log
                      </button>
                    )}
                    <button className="btn sm danger" type="button" onClick={() => delHolder(h)}>
                      Remove
                    </button>
                  </div>
                )}
                {clearMarks[holderClearKey(h.id)] && received === 0 && cols.length === 0 && pays.length === 0 && (
                  <div className="stmt-sub" style={{ padding: "6px 4px", opacity: 0.7 }}>
                    Log cleared on {clearedOn(holderClearKey(h.id))} — fresh start. History is kept everywhere else.
                    {isOwner && (
                      <button
                        className="btn sm"
                        type="button"
                        style={{ marginLeft: 8 }}
                        onClick={() => undoClear([holderClearKey(h.id), ...h.accounts.map(acctClearKey)], h.name, h.id)}
                      >
                        Undo
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* ungrouped */}
      {ungrouped.length > 0 && (
        <>
          <div className="acct-day-label" style={{ marginTop: 14 }}>
            <span>Ungrouped · {ungrouped.length}</span>
          </div>
          <p className="note" style={{ margin: "0 0 8px", opacity: 0.7 }}>
            Accounts not under a holder yet. Open a holder and use “+ Account” to move them in.
          </p>
          {ungrouped.map((a) => renderAccount(a))}
        </>
      )}

      {holders.length === 0 && ungrouped.length === 0 && (
        <div className="acct-empty">
          <div className="empty">
            No account holders yet. Add one (e.g. Tabrez), then add their UPI accounts inside.
          </div>
        </div>
      )}
      </div>

      {printDoc && (
        <div className="cd-print acct-print acct-page" ref={printRef}>
          <div className={"acct-print-sum" + (printDoc.summary.length >= 5 ? " cols5" : printDoc.summary.length === 4 ? " cols4" : " cols3")}>
            {printDoc.summary.map((s) => (
              <div key={s.k}>
                <span>{s.k}</span>
                <b>{s.v}</b>
              </div>
            ))}
          </div>
          <div className="bank-ledger acct-book">
            <div className="bank-hdr acct-print-hdr">
              <span>Date</span>
              <span>Particulars</span>
              <span className="bank-amt">Dr</span>
              <span className="bank-amt">Cr</span>
              <span className="bank-amt">Balance</span>
            </div>
            {printDoc.rows.map((row, i) => {
              const isTxn = !row.isOpen && !row.isClose;
              const meta = txnMeta(row);
              const closeDue = !!(row.isClose && row.balance > 0.5);
              return (
                <div
                  key={row.l.id || row.date + "-" + i}
                  className={
                    "bank-row acct-txn" +
                    (row.isOpen ? " bank-open" : "") +
                    (row.isClose ? " bank-total" : "")
                  }
                >
                  <span className="bank-date">{isTxn ? row.date : ""}</span>
                  <span className="bank-parts">
                    <span className="acct-txn-who">{row.particulars}</span>
                    {meta ? <small>{meta}</small> : null}
                  </span>
                  <span className={"bank-amt" + (row.debit > 0 ? " dr" : "")}>{row.debit > 0 ? "₹" + inr(row.debit) : ""}</span>
                  <span className={"bank-amt" + (row.credit > 0 ? " cr" : "")}>{row.credit > 0 ? "₹" + inr(row.credit) : ""}</span>
                  <span className={"bank-amt bal" + (row.isClose ? (closeDue ? " due" : " ok") : "")}>
                    ₹{inr(Math.abs(row.balance))}
                    {!row.isOpen && (
                      <span className={"bal-tag " + (row.balance > 0.5 ? "dr" : "cr")}>{row.balance > 0.5 ? "Dr" : "Cr"}</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
