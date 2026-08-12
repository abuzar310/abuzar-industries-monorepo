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
  balanceAfter,
  deleteAccountEntry,
  deleteCollection,
  getClearMarks,
  holderClearKey,
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
  setHolderOpening,
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
import { printOrSavePdf } from "@/lib/pdf";
import { waLink } from "@/lib/whatsapp";
import { USERS } from "@/lib/local-auth";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import type { Customer, Doc, Expense } from "@/lib/types";

const userName = (id: string) => USERS.find((u) => u.id === id)?.name || id || "—";
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
  balance: 0,
  lines: [],
});

const genDate = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
};

interface PrintRow {
  date: string;
  at: string;
  kind: "in" | "collect";
  label: string;
  amount: number;
}
interface PrintDoc {
  title: string;
  sub: string;
  summary: { k: string; v: string }[];
  rows: PrintRow[];
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
  const quotes = cloakMoney ? [] : quotesRaw;
  const expenses = cloakMoney ? [] : expensesRaw;
  const customers = cloakMoney ? [] : customersRaw;
  const collections = cloakMoney ? [] : collectionsRaw;
  const registry = cloakMoney ? [] : registryRaw;
  const holders = cloakMoney ? [] : holdersRaw;
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

  // move a payment to another account
  const [moveFor, setMoveFor] = useState<string | null>(null);

  // holder create / edit
  const [showAddHolder, setShowAddHolder] = useState(false);
  const [newHolder, setNewHolder] = useState("");
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
      listCollections(),
      listPayAccounts(),
      listHolders(),
      getClearMarks(),
    ]).then(([qs, es, cs, cols, reg, hs, marks]) => {
      setQuotes(qs);
      setExpenses(es);
      setCustomers(cs);
      setCollections(cols);
      setRegistry(reg);
      setHolders(hs);
      setClearMarks(marks);
    });
  }, []);
  useEffect(() => {
    if (ready) load();
  }, [ready, dataVersion, load]);

  // print the on-screen statement once the print doc has rendered, then clear it
  // (Android/installed-app: the print dialog doesn't exist — download a PDF instead)
  useEffect(() => {
    if (!printDoc) return;
    const t = setTimeout(async () => {
      const how = await printOrSavePdf(printRef.current, (printDoc.title || "statement").replace(/\s+/g, "-").toLowerCase());
      if (how === "pdf") toast("Statement PDF downloaded \u2713");
      setPrintDoc(null);
    }, 80);
    return () => clearTimeout(t);
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
    const collected = r2(subCollected + cols.reduce((s, c) => s + (+c.amount || 0), 0));
    const balance = r2(opening + received - collected);
    return { subs, opening, received, owner, collected, balance, cols };
  };

  // overall totals include holder opening balances + holder-level hand-overs
  // (computed over the CUT accounts, so cleared history stays out of the tiles too)
  const totalOpening = r2(holders.reduce((s, h) => s + (h.opening || 0), 0));
  const sumReceived = r2(accounts.reduce((s, a) => s + a.received, 0));
  const sumOwner = r2(accounts.reduce((s, a) => s + a.ownerReceived, 0));
  const totalCollected = r2(accounts.reduce((s, a) => s + a.collected, 0) + holderColTotal);
  const totalBalance = r2(sumReceived + totalOpening - totalCollected);

  // ── collect flow ──────────────────────────────────────────────────────────
  function startCollect(opts: { holderId?: string; account?: string }, balance: number, openKey: string) {
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
    const h = await addHolder(n);
    if (!h) return toast("That holder already exists");
    setNewHolder("");
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

  // ── statement PDF / WhatsApp send (per holder or per account) ──────────────
  function stmtRows(subs: AcctBalance[]): PrintRow[] {
    const rows: PrintRow[] = [];
    const multi = subs.length > 1;
    for (const a of subs) {
      for (const l of a.lines) {
        if (l.kind === "in")
          rows.push({
            date: l.date,
            at: l.at || "",
            kind: "in",
            label: (multi ? a.name + " · " : "") + (l.customer || "—") + (l.quoteNo ? " · #" + l.quoteNo : ""),
            amount: l.amount,
          });
        else
          rows.push({
            date: l.date,
            at: l.at || "",
            kind: "collect",
            label:
              "Collected → " +
              (l.toManager ? "Manager Daybook" : "Owner") +
              (l.note ? " · " + l.note : ""),
            amount: l.amount,
          });
      }
    }
    return rows;
  }
  function pdfHolder(h: PayHolder) {
    const v = holderView(h);
    const rows = stmtRows(v.subs);
    for (const c of v.cols)
      rows.push({
        date: c.date,
        at: c.createdAt || "",
        kind: "collect",
        label:
          "Collected → " +
          (c.toManager ? "Manager Daybook" : "Owner") +
          (c.note ? " · " + c.note : ""),
        amount: +c.amount || 0,
      });
    rows.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
    setPrintDoc({
      title: h.name,
      sub: brand.name + " · UPI account statement · " + genDate(),
      summary: [
        ...(v.opening > 0 ? [{ k: "Opening", v: "₹ " + inr(v.opening) }] : []),
        { k: "Received", v: "₹ " + inr(v.received) },
        { k: "Collected", v: "₹ " + inr(v.collected) },
        { k: "Balance", v: "₹ " + inr(v.balance) },
      ],
      rows,
    });
  }
  function pdfAccount(a: AcctBalance) {
    setPrintDoc({
      title: a.name,
      sub: brand.name + " · UPI account statement · " + genDate(),
      summary: [
        { k: "Received", v: "₹ " + inr(a.received) },
        { k: "Collected", v: "₹ " + inr(a.collected) },
        { k: "Balance", v: "₹ " + inr(a.balance) },
      ],
      rows: stmtRows([a]).sort((x, y) => (y.at || "").localeCompare(x.at || "")),
    });
  }
  function sendSummary(title: string, summary: { k: string; v: string }[]) {
    const text = [brand.name + " — " + title, ...summary.map((s) => s.k + ": " + s.v), "(as on " + genDate() + ")"].join("\n");
    window.open(waLink("", text), "_blank");
  }

  // ── build bank-format ledger rows for one account ────────────────────────
  interface AcctLedgerRow {
    date: string;
    at: string;
    particulars: string;
    detail: string;
    debit: number;  // collections / hand-overs
    credit: number; // UPI payments in
    balance: number;
    l: AcctStmtLine;
    kind: "in" | "collect";
    isOpen?: boolean;
    isClose?: boolean;
  }
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
          particulars: `By UPI – ${line.customer || "—"}`,
          detail: [line.quoteNo ? `#${line.quoteNo}` : line.custId ? "receipt" : "", line.toOwner ? "to owner" : "", line.legacyCollected ? "✓" : ""].filter(Boolean).join(" · "),
          debit: 0,
          credit: line.amount,
          l: line,
          kind: "in",
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
    // chronological sort
    const sortKey = (d: string) => { const [dd, mm, yy] = (d || "").split("-"); return dd && mm && yy ? `20${yy}-${mm}-${dd}` : ""; };
    rows.sort((a, b) => {
      const da = sortKey(a.date).localeCompare(sortKey(b.date));
      if (da !== 0) return da;
      return (a.at || "").localeCompare(b.at || "");
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

  // ── render an account's full bank-ledger table ──────────────────────────
  function renderAccountLedger(a: AcctBalance, parentOpening = 0) {
    const ledgerRows = buildAcctLedger(a, parentOpening);
    const due = ledgerRows.length > 0 ? ledgerRows[ledgerRows.length - 1].balance > 0.5 : false;
    return (
      <div className="bank-ledger" style={{ marginTop: 0 }}>
        <div className="bank-hdr">
          <span>Date</span>
          <span>Particulars</span>
          <span className="bank-amt">Dr ₹</span>
          <span className="bank-amt">Cr ₹</span>
          <span className="bank-amt">Balance</span>
        </div>
        {ledgerRows.map((row, i) => {
          const rowCls = ["bank-row", row.isOpen ? "bank-open" : "", row.isClose ? "bank-total" : ""].filter(Boolean).join(" ");
          const isUpi = row.kind === "in" && !row.isOpen && !row.isClose;
          return (
            <div
              key={i}
              className={rowCls}
              style={{ cursor: row.isOpen || row.isClose ? "default" : "pointer" }}
              onClick={() => {
                if (row.isOpen || row.isClose) return;
                if (row.kind === "in" && row.l.quoteNo) router.push("/editor/" + (quotes.find((d) => d.number === row.l.quoteNo)?.id || ""));
                else if (row.kind === "in" && row.l.custId) router.push("/receipts?cust=" + encodeURIComponent(row.l.custId));
              }}
            >
              <span className="bank-date">{!row.isOpen && !row.isClose ? row.date : ""}</span>
              <span className="bank-parts">
                {row.particulars}
                {row.detail && <small>{row.detail}</small>}
                {isUpi && (row.l.at ? <> · <small>{hhmm(row.l.at)}</small></> : null)}
                {isUpi && <span className="bl-acts">
                  <button className="bl-btn" title="Move to another account" type="button" onClick={(e) => { e.stopPropagation(); setMoveFor(moveFor === row.l.id ? null : row.l.id); }}>⇄</button>
                  <button className="bl-btn danger" title="Delete" type="button" onClick={(e) => { e.stopPropagation(); delEntry(row.l.id, row.l.quoteNo); }}>×</button>
                </span>}
                {row.kind === "collect" && !row.isClose && (
                  <span className="bl-acts">
                    <button className="bl-btn danger" title="Delete collection" type="button" onClick={(e) => { e.stopPropagation(); delCollection(row.l.id); }}>×</button>
                  </span>
                )}
              </span>
              <span className={"bank-amt" + (row.debit > 0 ? " dr" : "")}>{row.debit > 0 ? "₹" + inr(row.debit) : ""}</span>
              <span className={"bank-amt" + (row.credit > 0 ? " cr" : "")}>{row.credit > 0 ? "₹" + inr(row.credit) : ""}</span>
              <span className={"bank-amt bal" + (row.isClose ? (due ? " due" : " ok") : "")}>
                ₹{inr(Math.abs(row.balance))}
                {!row.isOpen && <span className={"bal-tag " + (row.balance > 0.5 ? "dr" : "cr")}>{row.balance > 0.5 ? "Dr" : "Cr"}</span>}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  // ── one sub-account (bank-format ledger + collect form + actions) ────────
  function renderAccount(a: AcctBalance, holderId?: string) {
    const isOpen = !collapsedAccts.has(a.name);
    const due = a.balance > 0.5;
    const collecting = collectFor === a.name;
    const cleared = !due && a.received > 0;
    const grouped = !!holderId;
    const parentOpening = grouped && holders.find(h => h.id === holderId) ? (holders.find(h => h.id === holderId)!.opening || 0) : 0;
    return (
      <div className={"panel-card acct-sub" + (cleared && !grouped ? " acct-done" : "")} key={a.name}>
        <div className="pc-head acct-head">
          <span style={{ cursor: "pointer", flex: 1, minWidth: 0 }} onClick={() => setCollapsedAccts((s) => { const n = new Set(s); isOpen ? n.add(a.name) : n.delete(a.name); return n; })}>
            <span className="um-caret" style={{ marginRight: 6 }}>
              {isOpen ? "▾" : "▸"}
            </span>
            {a.name}
            {cleared && !grouped && <span className="acct-collected-badge">Cleared ✓</span>}
          </span>
          <span className="acct-head-totals">
            {a.received > 0 && <span className="acct-tag upi">In ₹{inr(a.received)}</span>}
            {a.ownerReceived > 0 && <span className="acct-tag">Owner ₹{inr(a.ownerReceived)}</span>}
            {!grouped &&
              (due ? (
                <span className="acct-tag pending">Bal ₹{inr(a.balance)}</span>
              ) : (
                a.collected > 0 && <span className="acct-tag ok">₹{inr(a.collected)}</span>
              ))}
          </span>
          {!grouped && due && !collecting && (
            <button className="btn primary sm acct-collect-btn" type="button" onClick={() => startCollect({ account: a.name }, a.balance, a.name)}>
              Collect
            </button>
          )}
          {!grouped && (a.received > 0 || a.lines.length > 0) && (
            <>
              <button className="btn sm" type="button" title="Download PDF statement" onClick={() => pdfAccount(a)}>
                PDF
              </button>
              <button
                className="btn wa sm"
                type="button"
                title="Send summary on WhatsApp"
                onClick={() => sendSummary(a.name, [
                  { k: "Received", v: "₹" + inr(a.received) },
                  { k: "Collected", v: "₹" + inr(a.collected) },
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
          <div className="panel-card" style={{ padding: 12, margin: "0 0 4px" }}>
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

        {isOpen &&
          (a.lines.length ? (
            <>{renderAccountLedger(a, parentOpening)}</>
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
    <div className="ledger-page">
      <div className="cd-screen">
      <div className="sectitle">
        Accounts <small>— holders, their UPI accounts &amp; hand-overs</small>
      </div>

      {/* overall */}
      <div className="panel-card acct-overall">
        <div className="acct-overall-h">Overall</div>
        <div className="acct-overall-grid">
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
        </div>
      </div>

      <div className="acct-day-label">
        <span>Account holders · {holders.length}</span>
        <button className="btn sm" type="button" style={{ marginLeft: "auto" }} onClick={() => setShowAddHolder((v) => !v)}>
          {showAddHolder ? "Done" : "+ Account holder"}
        </button>
      </div>

      {showAddHolder && (
        <div className="panel-card" style={{ padding: 14, marginBottom: 12 }}>
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
          <p className="note" style={{ marginTop: 8, opacity: 0.75 }}>
            A holder is a person who receives UPI on your behalf. Add their accounts inside — you collect from the holder, and the running total is what matters.
          </p>
        </div>
      )}

      {/* holders */}
      {holders.map((h) => {
        const { subs, opening, received, owner, collected, balance, cols } = holderView(h);
        const isOpen = !collapsedHolders.has(h.id);
        const due = balance > 0.5;
        const renaming = renameForId === h.id;
        const adding = addAcctFor === h.id;
        const collecting = collectHolder === h.id;
        const editingOpening = openingForId === h.id;
        return (
          <div className="panel-card acct-holder" key={h.id}>
            <div className="pc-head acct-head acct-holder-head">
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
                  <span className="acct-head-totals">
                    {opening > 0 && <span className="acct-tag">Opening ₹{inr(opening)}</span>}
                    {received > 0 && <span className="acct-tag upi">In ₹{inr(received)}</span>}
                    {owner > 0 && <span className="acct-tag">Owner ₹{inr(owner)}</span>}
                    {due ? (
                      <span className="acct-tag pending">Bal ₹{inr(balance)}</span>
                    ) : (
                      received > 0 && <span className="acct-tag ok">Cleared ✓</span>
                    )}
                  </span>
                  {due && !collecting && (
                    <button className="btn primary sm acct-collect-btn" type="button" onClick={() => startCollect({ holderId: h.id }, balance, h.id)}>
                      Collect
                    </button>
                  )}
                </>
              )}
            </div>

            {collecting && (
              <div className="panel-card" style={{ padding: 12, margin: "0 0 8px" }}>
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

            {isOpen && (
              <div className="acct-holder-body">
                {subs.length ? (
                  subs.map((a) => renderAccount(a, h.id))
                ) : (
                  <div className="stmt-sub" style={{ padding: "6px 4px", opacity: 0.7 }}>No accounts yet — add one below.</div>
                )}

                {cols.length > 0 && (
                  <div className="acct-handovers">
                    <div className="bank-ledger" style={{ marginTop: 8 }}>
                      <div className="bank-hdr">
                        <span>Date</span>
                        <span>Particulars</span>
                        <span className="bank-amt">Dr ₹</span>
                        <span className="bank-amt">Cr ₹</span>
                        <span className="bank-amt">Balance</span>
                      </div>
                      {cols
                        .slice()
                        .sort((x, y) => {
                          const dx = (x.createdAt || "").localeCompare(y.createdAt || "");
                          return dx;
                        })
                        .map((c, i) => {
                          const bal = r2(cols.slice(0, i + 1).reduce((s, x) => s + (+x.amount || 0), 0));
                          return (
                            <div className="bank-row" key={c.id}>
                              <span className="bank-date">{c.date}</span>
                              <span className="bank-parts">
                                Collected → {c.toManager ? "Manager Daybook" : "Owner"}
                                {c.note ? " · " + c.note : ""}
                                <small>{hhmm(c.createdAt) ? " · " + hhmm(c.createdAt) : ""} · by {userName(c.by)}</small>
                              </span>
                              <span className="bank-amt dr">₹{inr(c.amount)}</span>
                              <span className="bank-amt cr"></span>
                              <span className="bank-amt bal">
                                ₹{inr(Math.abs(balance - bal))}
                                <span className={"bal-tag " + (balance - bal > 0.5 ? "dr" : "cr")}>{balance - bal > 0.5 ? "Dr" : "Cr"}</span>
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}

                {editingOpening && (
                  <div className="panel-card" style={{ padding: 12, margin: "6px 0 2px" }}>
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
                  <div className="panel-card" style={{ padding: 12, margin: "6px 0 2px" }}>
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
                    <button className="btn sm" type="button" onClick={() => pdfHolder(h)}>
                      PDF
                    </button>
                    <button className="btn sm wa" type="button" onClick={() => sendSummary(h.name, [
                      ...(opening > 0 ? [{ k: "Opening", v: "₹" + inr(opening) }] : []),
                      { k: "Received", v: "₹" + inr(received) },
                      { k: "Collected", v: "₹" + inr(collected) },
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
                    {isOwner && !due && (received > 0 || collected > 0) && (
                      <button
                        className="btn sm"
                        type="button"
                        title="All settled — hide this holder's log here and start from ₹0 (nothing is deleted, undo anytime)"
                        onClick={() => clearHolderLog(h, { subs, opening, received, owner, collected, balance, cols })}
                      >
                        Clear log
                      </button>
                    )}
                    <button className="btn sm danger" type="button" onClick={() => delHolder(h)}>
                      Remove
                    </button>
                  </div>
                )}
                {clearMarks[holderClearKey(h.id)] && received === 0 && cols.length === 0 && (
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
        <div className="panel-card">
          <div className="empty">
            No account holders yet. Add one (e.g. Tabrez), then add their UPI accounts inside.
          </div>
        </div>
      )}
      </div>

      {printDoc && (
        <div className="cd-print rep-doc" ref={printRef}>
          <div className="rep-head">
            <div className="rep-brand">
              <h1>{brand.name || "Statement"}</h1>
              {brand.addr && <div>{brand.addr}</div>}
            </div>
            <div className="rep-meta">
              <div className="rep-title">{printDoc.title}</div>
              <div className="rep-period">{printDoc.sub}</div>
            </div>
          </div>
          <div className={"rep-summary " + (printDoc.summary.length === 4 ? "cols4" : "cols3")}>
            {printDoc.summary.map((s) => (
              <div key={s.k}>
                <b>{s.v}</b>
                <span>{s.k}</span>
              </div>
            ))}
          </div>
          <table className="rep-table">
            <colgroup>
              <col style={{ width: "6%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "42%" }} />
              <col style={{ width: "18%" }} />
            </colgroup>
            <thead>
              <tr>
                <th className="c-n">#</th>
                <th>Date</th>
                <th>Type</th>
                <th>Detail</th>
                <th className="amt">Amount ₹</th>
              </tr>
            </thead>
            <tbody>
              {printDoc.rows.length ? (
                printDoc.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="c-n">{i + 1}</td>
                    <td className="c-date">{r.date}</td>
                    <td>{r.kind === "in" ? "Received" : "Handed over"}</td>
                    <td className="c-cust">{r.label}</td>
                    <td className="amt">{r.kind === "in" ? "+" : "−"}{inr(r.amount)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="rep-empty">No entries.</td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="rep-foot">Generated {genDate()} · {brand.name}</div>
        </div>
      )}
    </div>
  );
}
