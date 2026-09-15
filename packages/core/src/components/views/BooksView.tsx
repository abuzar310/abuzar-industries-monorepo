"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec } from "@/lib/data";
import { inr } from "@/lib/calc";
import {
  addIncomeLine,
  addSpendCategory,
  bookLabel,
  liveIncomeLines,
  liveSpendCategories,
  removeIncomeLine,
  removeSpendCategory,
  renameIncomeLine,
  renameSpendCategory,
  setBookLabel,
  spendLocked,
  splitCustomIncome,
} from "@/lib/book-catalog";
import { inBooks, inDaybook, isInflow, openingCarry, spendCategoryOf, spendCatKey, spendDetailOf } from "@/lib/expenses";
import { confirmDialog, formDialog } from "@/store/dialog-store";
import { partyLedger, quoteBill } from "@/lib/payments";
import { acctLedger, listCollections, listHolders, type AccountCollection, type PayHolder } from "@/lib/accounts";
import { listAttendance, listWorkers, workerAccount, type AttendanceMark, type Worker } from "@/lib/attendance";
import { USERS } from "@/lib/local-auth";
import { useApp } from "@/store/useApp";
import type { Customer, Doc, Expense } from "@/lib/types";
import { generatePdf } from "@/lib/pdf";
import { toast } from "@/store/app-store";
import Pager, { PAGE, usePager } from "@/components/Pager";
import PassbookPrint, { type PassbookLine } from "@/components/PassbookPrint";
import PdfButtons from "@/components/PdfButtons";
import { TabIcon } from "@/components/Icons";

const r2 = (n: number) => Math.round(n * 100) / 100;
const userName = (id: string) => USERS.find((u) => u.id === id)?.name || id || "—";
// dd-mm-yy → { mm, yy }
const parts = (d: string) => {
  const [, mm = "", yy = ""] = (d || "").split("-");
  return { mm, yy };
};
const sortKey = (d: string) => {
  const [dd, mm, yy] = (d || "").split("-");
  return dd && mm && yy ? `20${yy}-${mm}-${dd}` : "";
};
const MONTHS: [string, string][] = [
  ["01", "Jan"], ["02", "Feb"], ["03", "Mar"], ["04", "Apr"], ["05", "May"], ["06", "Jun"],
  ["07", "Jul"], ["08", "Aug"], ["09", "Sep"], ["10", "Oct"], ["11", "Nov"], ["12", "Dec"],
];

/** A quote counts as billed once Created OR money was taken against it (same rule as Balances). */
const isBillable = (d: Doc) =>
  d.status === "Created" ||
  (+(d.payCash || 0)) > 0 ||
  (+(d.payUpi || 0)) > 0 ||
  (+(d.payCommission || 0)) > 0 ||
  (+(d.amountPaid || 0)) > 0;

export default function BooksView() {
  const { ready, dataVersion, cloakMoney } = useApp();
  const router = useRouter();
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, "0"));
  const [year, setYear] = useState(String(now.getFullYear()).slice(2));
  // which book to show — a visible chooser at the top instead of one long scroll
  const [view, setView] = useState<"pnl" | "ledger" | "cash" | "bank" | "balance" | "assets">("pnl");
  const [editNames, setEditNames] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const [expensesRaw, setExpenses] = useState<Expense[]>([]);
  const [quotesRaw, setQuotes] = useState<Doc[]>([]);
  const [customersRaw, setCustomers] = useState<Customer[]>([]);
  const [collectionsRaw, setCollections] = useState<AccountCollection[]>([]);
  const [holdersRaw, setHolders] = useState<PayHolder[]>([]);
  const [workersRaw, setWorkers] = useState<Worker[]>([]);
  const [marksRaw, setMarks] = useState<AttendanceMark[]>([]);
  const [carryRaw, setCarry] = useState(0);
  const expenses = cloakMoney ? [] : expensesRaw;
  const quotes = cloakMoney ? [] : quotesRaw;
  const customers = cloakMoney ? [] : customersRaw;
  const collections = cloakMoney ? [] : collectionsRaw;
  const holders = cloakMoney ? [] : holdersRaw;
  const workers = cloakMoney ? [] : workersRaw;
  const marks = cloakMoney ? [] : marksRaw;
  const carry = cloakMoney ? 0 : carryRaw;
  /** Month ledger filters */
  const [ledCat, setLedCat] = useState("all");
  const [ledFrom, setLedFrom] = useState("");
  const [ledTo, setLedTo] = useState("");

  const load = useCallback(() => {
    Promise.all([
      allRec<Expense>("expenses"),
      allRec<Doc>("quotations"),
      allRec<Customer>("customers"),
      listCollections(),
      listHolders(),
      listWorkers(),
      listAttendance(),
      openingCarry(),
    ]).then(([es, qs, cs, cols, hs, ws, ms, cr]) => {
      setExpenses(es);
      setQuotes(qs);
      setCustomers(cs);
      setCollections(cols);
      setHolders(hs);
      setWorkers(ws);
      setMarks(ms);
      setCarry(cr);
    });
  }, []);
  useEffect(() => {
    if (ready) load();
  }, [ready, dataVersion, load]);

  // months that actually have data, newest first — for the picker
  const years = useMemo(() => {
    const set = new Set<string>();
    expenses.forEach((e) => { const { yy } = parts(e.date); if (yy) set.add(yy); });
    quotes.forEach((q) => { const { yy } = parts(q.date); if (yy) set.add(yy); });
    set.add(String(now.getFullYear()).slice(2));
    return [...set].sort((a, b) => b.localeCompare(a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses, quotes]);

  const inMonth = (d: string) => {
    const p = parts(d);
    return p.mm === month && p.yy === year;
  };

  // ── monthly income & expenses (from the daybook — every money event) ──────
  const monthExp = useMemo(
    () => expenses.filter((e) => inMonth(e.date) && inBooks(e)),
    [expenses, month, year], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const income = useMemo(
    () =>
      splitCustomIncome(
        monthExp.filter((e) => e.type === "sale" && !e.charge),
        liveIncomeLines().filter((l) => l.custom),
      ),
    [monthExp, dataVersion],
  );

  const spends = useMemo(() => {
    const outs = monthExp.filter((e) => !isInflow(e.type) && !e.charge);
    const byCat = new Map<string, { label: string; amount: number; count: number }>();
    for (const e of outs) {
      const key = spendCatKey(e);
      const g = byCat.get(key) || { label: spendCategoryOf(e), amount: 0, count: 0 };
      g.amount = r2(g.amount + (+e.amount || 0));
      g.count++;
      byCat.set(key, g);
    }
    const total = r2(outs.reduce((s, e) => s + (+e.amount || 0), 0));
    return { byCat, total, count: outs.length };
  }, [monthExp]);

  const duesAdded = useMemo(
    () => r2(monthExp.filter((e) => e.type === "sale" && e.charge).reduce((s, e) => s + (+e.amount || 0), 0)),
    [monthExp],
  );
  const billedMonth = useMemo(
    () =>
      r2(
        quotes
          .filter((d) => !d.deletedAt && !d.purgedAt && inMonth(d.date) && isBillable(d))
          .reduce((s, d) => s + quoteBill(d), 0),
      ),
    [quotes, month, year], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const spendCats = liveSpendCategories({ skipBooks: false });
  const incomeLines = liveIncomeLines();

  const net = r2(income.total - spends.total);

  async function askName(title: string, current: string) {
    const res = await formDialog({
      title,
      fields: [{ name: "label", label: "Name", value: current, required: true }],
      submitLabel: "Save",
    });
    const v = (res?.label || "").trim();
    return v || null;
  }

  async function onRenameLabel(id: string, current: string) {
    const v = await askName("Rename", current);
    if (v) await setBookLabel(id, v);
  }

  function openPaid(id: string) {
    router.push("/receipts?paid=" + encodeURIComponent(id) + "&mm=" + month + "&yy=" + year);
  }
  function openTxn(id: string) {
    router.push("/receipts?edit=" + encodeURIComponent(id));
  }

  function Name({ id, extra }: { id: string; extra?: string }) {
    const text = bookLabel(id) + (extra || "");
    return (
      <span className="books-name">
        {text}
        {editNames && (
          <button type="button" className="books-name-btn no-print" onClick={() => void onRenameLabel(id, bookLabel(id))} aria-label="Rename">
            ✎
          </button>
        )}
      </span>
    );
  }

  // ── month ledger: every money event chronologically with a running net ────
  const monthRows = useMemo(() => {
    const fromKey = ledFrom || "";
    const toKey = ledTo || "";
    const rows = monthExp
      .filter((e) => !e.charge) // charges move no cash
      .filter((e) => {
        if (ledCat === "all") return true;
        if (ledCat === "in") return isInflow(e.type);
        if (ledCat === "out") return !isInflow(e.type);
        return spendCatKey(e) === ledCat;
      })
      .filter((e) => {
        const k = sortKey(e.date);
        if (fromKey && k && k < fromKey) return false;
        if (toKey && k && k > toKey) return false;
        return true;
      })
      .map((e) => {
        const inflow = isInflow(e.type);
        const cat = inflow
          ? (e.custId ? "Received" : e.party ? "Received from name" : "Sale") +
            (e.mode === "upi" ? " · UPI" : " · Cash") +
            (e.toOwner ? " → Owner" : "")
          : spendCategoryOf(e);
        const detailBits = inflow
          ? [
              e.party && !e.custId ? e.party : "",
              e.label && !e.custId ? e.label : "",
              e.account ? "acct " + e.account : "",
              e.note,
              "by " + userName(e.enteredBy),
            ].filter(Boolean)
          : [spendDetailOf(e), "by " + userName(e.enteredBy)].filter(Boolean);
        return {
          id: e.id,
          date: e.date,
          at: e.createdAt || "",
          particulars: cat,
          detail: detailBits.join(" · "),
          debit: inflow ? 0 : +e.amount || 0,
          credit: inflow ? +e.amount || 0 : 0,
          balance: 0,
        };
      })
      .sort((a, b) => {
        const d = sortKey(a.date).localeCompare(sortKey(b.date));
        if (d !== 0) return d;
        return (a.at || "").localeCompare(b.at || "");
      });
    let bal = 0;
    for (const row of rows) {
      bal = r2(bal + row.credit - row.debit);
      row.balance = bal;
    }
    return rows;
  }, [monthExp, ledCat, ledFrom, ledTo]);

  const ledOut = r2(monthRows.reduce((s, r) => s + r.debit, 0));
  const ledIn = r2(monthRows.reduce((s, r) => s + r.credit, 0));
  const ledNet = r2(ledIn - ledOut);
  const ledFiltered = ledCat !== "all" || !!ledFrom || !!ledTo;

  // ── cash book: the manager's open cash, every event chronologically ─────────
  // Same rule as the Daybook / snapshot cash-in-hand: only real cash movements
  // in the manager's hand (inDaybook excludes UPI / to-owner / dues charges) and
  // never the closed-session rows. Seeded with the opening carry, so the closing
  // balance ties exactly to Assets & Liabilities "Cash in hand".
  const cashRows = useMemo(() => {
    const rows = expenses
      .filter((e) => !e.sessionId && inDaybook(e))
      .map((e) => {
        const inflow = isInflow(e.type);
        const cat = inflow
          ? (e.custId ? "Received" : e.party ? "Received from " + e.party : "Cash sale")
          : spendCategoryOf(e);
        const detailBits = inflow
          ? [e.label && !e.custId ? e.label : "", e.note, "by " + userName(e.enteredBy)].filter(Boolean)
          : [spendDetailOf(e), "by " + userName(e.enteredBy)].filter(Boolean);
        return {
          id: e.id,
          date: e.date,
          at: e.createdAt || "",
          particulars: cat,
          detail: detailBits.join(" · "),
          debit: inflow ? 0 : +e.amount || 0, // cash out
          credit: inflow ? +e.amount || 0 : 0, // cash in
          balance: 0,
        };
      })
      .sort((a, b) => {
        const d = sortKey(a.date).localeCompare(sortKey(b.date));
        if (d !== 0) return d;
        return (a.at || "").localeCompare(b.at || "");
      });
    let bal = r2(carry);
    for (const row of rows) {
      bal = r2(bal + row.credit - row.debit);
      row.balance = bal;
    }
    return rows;
  }, [expenses, carry]);
  const cashIn = r2(cashRows.reduce((s, r) => s + r.credit, 0));
  const cashOut = r2(cashRows.reduce((s, r) => s + r.debit, 0));
  const cashClose = r2(carry + cashIn - cashOut); // ties to snapshot.cashInHand

  const monthPg = usePager(
    [...monthRows].reverse(),
    PAGE,
    month + "\0" + year + "\0" + ledCat + "\0" + ledFrom + "\0" + ledTo,
  );
  const cashPg = usePager([...cashRows].reverse(), PAGE, "");

  // ── bank book: UPI accounts (no bank-account model exists — UPI IS the bank) ──
  const bankLedger = useMemo(
    () => acctLedger(expenses, collections, quotes, customers),
    [expenses, collections, quotes, customers],
  );

  // ── assets & liabilities snapshot (as of today) ────────────────────────────
  const snapshot = useMemo(() => {
    // cash in hand — the manager's open cash book (same rule as the Daybook)
    const openCash = expenses.filter((e) => !e.sessionId && inDaybook(e));
    const cashIn = openCash.filter((e) => isInflow(e.type)).reduce((s, e) => s + (+e.amount || 0), 0);
    const cashOut = openCash.filter((e) => !isInflow(e.type)).reduce((s, e) => s + (+e.amount || 0), 0);
    const cashInHand = r2(carry + cashIn - cashOut);

    // UPI sitting with account holders (Accounts tab)
    const ledger = acctLedger(expenses, collections, quotes, customers);
    const acctBal = ledger.accounts.reduce((s, a) => s + a.balance, 0);
    const holderOpen = holders.reduce((s, h) => s + (+(h.opening || 0) || 0), 0);
    const holderCols = collections.filter((c) => !!c.holderId).reduce((s, c) => s + (+c.amount || 0), 0);
    const holderPays = expenses
      .filter((e) => e.pocketSpend === "transport" && !!e.holderId)
      .reduce((s, e) => s + (+e.amount || 0), 0);
    const upiWithHolders = r2(acctBal + holderOpen - holderCols - holderPays);

    // receivables & customer advances (Balances tab rule)
    const { parties, totalPending } = partyLedger(quotes, expenses, customers);
    const custAdvances = r2(parties.filter((p) => p.balance < -0.5).reduce((s, p) => s + -p.balance, 0));

    // workers: unpaid wages are owed BY us (liability); advances out are owed TO us (asset)
    let unpaidWages = 0;
    let workerAdvances = 0;
    for (const w of workers.filter((x) => x.active !== false)) {
      const acc = workerAccount(w, marks, expenses);
      if (acc.wageBalance > 0.5) unpaidWages = r2(unpaidWages + acc.wageBalance);
      if (acc.debt > 0.5) workerAdvances = r2(workerAdvances + acc.debt);
    }

    const assets = r2(cashInHand + upiWithHolders + totalPending + workerAdvances);
    const liabilities = r2(unpaidWages + custAdvances);
    return {
      cashInHand,
      upiWithHolders,
      receivables: r2(totalPending),
      workerAdvances,
      unpaidWages,
      custAdvances,
      assets,
      liabilities,
      position: r2(assets - liabilities),
    };
  }, [expenses, quotes, customers, collections, holders, workers, marks, carry]);

  const monthLabel = (MONTHS.find(([v]) => v === month)?.[1] || month) + " 20" + year;
  const ledgerPdfRows: PassbookLine[] = [
    ...monthRows.map((row) => ({
      key: row.id,
      date: row.date,
      who: row.particulars,
      detail: row.detail,
      debit: row.debit,
      credit: row.credit,
      balance: row.balance,
    })),
    {
      key: "led-close",
      date: "",
      who: ledFiltered ? bookLabel("led.filtered") : bookLabel("led.net") + " " + monthLabel,
      debit: ledOut,
      credit: ledIn,
      balance: ledNet,
      close: true,
    },
  ];
  const cashPdfRows: PassbookLine[] = [
    {
      key: "cash-open",
      date: "",
      who: bookLabel("cash.open"),
      detail: bookLabel("cash.openNote"),
      debit: 0,
      credit: 0,
      balance: carry,
      open: true,
    },
    ...cashRows.map((row) => ({
      key: row.id,
      date: row.date,
      who: row.particulars,
      detail: row.detail,
      debit: row.debit,
      credit: row.credit,
      balance: row.balance,
    })),
    {
      key: "cash-close",
      date: "",
      who: bookLabel("cash.close"),
      debit: cashOut,
      credit: cashIn,
      balance: cashClose,
      close: true,
    },
  ];
  const step = (dir: -1 | 1) => {
    let m = parseInt(month, 10) + dir;
    let y = parseInt(year, 10);
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    setMonth(String(m).padStart(2, "0"));
    setYear(String(y).padStart(2, "0"));
    setLedCat("all");
    setLedFrom("");
    setLedTo("");
  };

  // Save the CURRENT section as a PDF that looks like the on-screen cards (not a
  // separate table). Card-aware pagination keeps cards/rows whole across pages.
  const savePdf = useCallback((preview = false) => {
    const bookPass = view === "ledger" || view === "cash";
    const el = bookPass ? printRef.current : pageRef.current;
    if (!el) return;
    const label =
      view === "pnl" ? "Income & Expense · " + monthLabel
      : view === "ledger" ? "Month ledger · " + monthLabel
      : view === "cash" ? "Cash book"
      : view === "bank" ? "Bank book"
      : view === "balance" ? "Balance sheet"
      : "Assets & Liabilities";
    const stamp = new Date().toISOString().slice(0, 10);
    if (!preview) toast("Preparing PDF…");
    generatePdf(el, "books-" + view + "-" + stamp, {
      pageBreak: bookPass
        ? ".bank-row,.acct-print-sum,.acct-print-hdr"
        : ".party-card,.bank-row,.books-row,.books-total",
      width: 700,
      title: "Books — " + label,
      marginMm: 8,
      preview,
    })
      .then(() => { if (!preview) toast("PDF downloaded ✓"); })
      .catch(() => toast("Could not create the PDF"));
  }, [view, monthLabel]);

  return (
    <div className="ph-kit"><div className="ledger-page" ref={pageRef}>
      <div className="sectitle no-print">
        <span className="phone-ico ph-only"><TabIcon icon="book" size={18} /></span>
        Books <small><span className="desk-only">— </span>monthly income &amp; expense · assets &amp; liabilities</small>
      </div>

      {/* which book to show — a visible chooser (this was one long scroll before) */}
      <div className="db-seg no-print" style={{ marginTop: 14 }}>
        <button className={"seg-btn" + (view === "pnl" ? " on" : "")} type="button" onClick={() => setView("pnl")}>
          Income &amp; Expense
        </button>
        <button className={"seg-btn" + (view === "ledger" ? " on" : "")} type="button" onClick={() => setView("ledger")}>
          Month ledger
        </button>
        <button className={"seg-btn" + (view === "cash" ? " on" : "")} type="button" onClick={() => setView("cash")}>
          Cash book
        </button>
        <button className={"seg-btn" + (view === "bank" ? " on" : "")} type="button" onClick={() => setView("bank")}>
          Bank book
        </button>
        <button className={"seg-btn" + (view === "balance" ? " on" : "")} type="button" onClick={() => setView("balance")}>
          Balance sheet
        </button>
        <button className={"seg-btn" + (view === "assets" ? " on" : "")} type="button" onClick={() => setView("assets")}>
          Assets &amp; Liabilities
        </button>
      </div>

      {/* Save the on-screen section as a website-quality PDF (direct download) */}
      <div className="no-print" style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
        <button className={"btn sm" + (editNames ? " primary" : "")} type="button" onClick={() => setEditNames((v) => !v)}>
          {editNames ? "Done" : "Edit names"}
        </button>
        <PdfButtons onPreview={() => savePdf(true)} onDownload={() => savePdf(false)} downloadLabel="Save PDF" />
      </div>

      {/* month picker — drives Income & Expense and the Month ledger */}
      {(view === "pnl" || view === "ledger") && (
      <div className="stmt-filters no-print" style={{ marginTop: 14 }}>
        <button className="btn sm" type="button" onClick={() => step(-1)} aria-label="Previous month">‹</button>
        <select className="paysel" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
          {MONTHS.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <select className="paysel" value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year">
          {years.map((y) => (
            <option key={y} value={y}>20{y}</option>
          ))}
        </select>
        <button className="btn sm" type="button" onClick={() => step(1)} aria-label="Next month">›</button>
      </div>
      )}

      {view === "pnl" && (
      <>
      {/* monthly P&L cards */}
      <div className="party-grid">
        <div className="party-card">
          <div className="party-stat-label"><Name id="pnl.income" extra={" · " + monthLabel} /></div>
          <div className="party-stat-value ok">₹ {inr(income.total)}</div>
          <div className="party-stat-sub">
            {income.count} receipts · cash ₹{inr(income.cash)} · UPI ₹{inr(income.upi)}
            {income.upi > 0 ? ` (owner ₹${inr(income.upiOwner)} · other ₹${inr(income.upiOther)})` : ""}
          </div>
        </div>
        <div className="party-card">
          <div className="party-stat-label"><Name id="pnl.expenses" extra={" · " + monthLabel} /></div>
          <div className="party-stat-value due">₹ {inr(spends.total)}</div>
          <div className="party-stat-sub">{spends.count} entries across {spends.byCat.size} categories</div>
        </div>
        <div className="party-card hero">
          <div className="party-stat-label"><Name id="pnl.net" extra={" · " + monthLabel} /></div>
          <div className={"party-stat-value " + (net >= 0 ? "ok" : "due")}>{net < 0 ? "−" : ""}₹ {inr(Math.abs(net))}</div>
          <div className="party-stat-sub"><Name id={net >= 0 ? "pnl.surplus" : "pnl.deficit"} /></div>
        </div>
      </div>

      {/* income / expense breakdown */}
      <div className="books-grid">
        <div className="party-card">
          <div className="party-stat-label" style={{ marginBottom: 10 }}>
            <Name id="inc.head" />
            {editNames && (
              <button
                type="button"
                className="books-name-btn no-print"
                onClick={async () => {
                  const v = await askName("Add income name", "");
                  if (v) await addIncomeLine(v);
                }}
              >
                +
              </button>
            )}
          </div>
          <div className="books-row"><span><Name id="inc.cash" /></span><b className="ok">₹{inr(income.cash)}</b></div>
          <div className="books-row"><span><Name id="inc.upiOwner" /></span><b className="ok">₹{inr(income.upiOwner)}</b></div>
          <div className="books-row"><span><Name id="inc.upiOther" /></span><b className="ok">₹{inr(income.upiOther)}</b></div>
          {income.extra.map((g) => (
            <div className="books-row" key={g.id}>
              <span className="books-name">
                {g.label}
                {editNames && (
                  <span className="no-print">
                    <button type="button" className="books-name-btn" onClick={async () => { const v = await askName("Rename", g.label); if (v) await renameIncomeLine(g.id, v); }}>✎</button>
                    <button type="button" className="books-name-btn" onClick={async () => { if (await confirmDialog({ title: "Remove this name?", message: "Money stays. It goes back into cash / UPI.", confirmLabel: "Remove", danger: true })) await removeIncomeLine(g.id); }}>×</button>
                  </span>
                )}
              </span>
              <b className="ok">₹{inr(g.amount)}</b>
            </div>
          ))}
          {editNames && incomeLines.filter((l) => l.custom && !income.extra.some((g) => g.id === l.id)).map((l) => (
            <div className="books-row" key={l.id}>
              <span className="books-name">
                {l.label}
                <span className="no-print">
                  <button type="button" className="books-name-btn" onClick={async () => { const v = await askName("Rename", l.label); if (v) await renameIncomeLine(l.id, v); }}>✎</button>
                  <button type="button" className="books-name-btn" onClick={async () => { if (await confirmDialog({ title: "Remove this name?", confirmLabel: "Remove", danger: true })) await removeIncomeLine(l.id); }}>×</button>
                </span>
              </span>
              <b>—</b>
            </div>
          ))}
          {(billedMonth > 0 || editNames) && <div className="books-row"><span><Name id="inc.billed" extra={" · " + monthLabel} /></span><b>₹{inr(billedMonth)}</b></div>}
          {(duesAdded > 0 || editNames) && <div className="books-row"><span><Name id="inc.dues" /></span><b className="due">₹{inr(duesAdded)}</b></div>}
          <div className="books-row books-total"><span><Name id="inc.total" /></span><b className="ok">₹{inr(income.total)}</b></div>
        </div>
        <div className="party-card">
          <div className="party-stat-label" style={{ marginBottom: 10 }}>
            <Name id="exp.head" />
            {editNames && (
              <button
                type="button"
                className="books-name-btn no-print"
                onClick={async () => {
                  const v = await askName("Add expense name", "");
                  if (v) await addSpendCategory(v);
                }}
              >
                +
              </button>
            )}
          </div>
          {spends.byCat.size === 0 && !editNames && <div className="books-row"><span><Name id="exp.empty" /></span><b>—</b></div>}
          {(editNames ? spendCats : spendCats.filter((c) => spends.byCat.has(c.id)))
            .slice()
            .sort((a, b) => (spends.byCat.get(b.id)?.amount || 0) - (spends.byCat.get(a.id)?.amount || 0))
            .map((c) => {
              const g = spends.byCat.get(c.id);
              return (
                <div
                  className={"books-row" + (!editNames && g ? " books-go" : "")}
                  key={c.id}
                  onClick={() => { if (!editNames && g) openPaid(c.id); }}
                  role={!editNames && g ? "link" : undefined}
                >
                  <span className="books-name">
                    {c.label}{g ? <small> · {g.count}</small> : null}
                    {editNames && (
                      <span className="no-print" onClick={(ev) => ev.stopPropagation()}>
                        <button type="button" className="books-name-btn" onClick={async () => { const v = await askName("Rename", c.label); if (v) await renameSpendCategory(c.id, v); }}>✎</button>
                        {!spendLocked(c.id) && (
                          <button type="button" className="books-name-btn" onClick={async () => { if (await confirmDialog({ title: "Remove " + c.label + "?", message: "Old rows stay, under Other. Receipts / Daybook drop this name.", confirmLabel: "Remove", danger: true })) await removeSpendCategory(c.id); }}>×</button>
                        )}
                      </span>
                    )}
                  </span>
                  <b className="due">{g ? "₹" + inr(g.amount) : "—"}</b>
                </div>
              );
            })}
          <div className="books-row books-total"><span><Name id="exp.total" /></span><b className="due">₹{inr(spends.total)}</b></div>
        </div>
      </div>
      </>
      )}

      {/* every money event of the month — bank-format with running net */}
      {view === "ledger" && (
      <div className="panel-card" style={{ marginTop: 18 }}>
        <div className="pc-head" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <span><Name id="led.head" extra={" · " + monthRows.length + (monthRows.length === 1 ? " entry" : " entries")} /></span>
          <span className="pc-head-meta">
            in ₹{inr(ledIn)} · out ₹{inr(ledOut)}
          </span>
        </div>
        <div
          className="books-led-filters no-print"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            alignItems: "flex-end",
            padding: "4px 12px 10px",
          }}
        >
          <label className="modal-field" style={{ flex: "1 1 160px", minWidth: 140, margin: 0 }}>
            <span>Category</span>
            <select value={ledCat} onChange={(e) => setLedCat(e.target.value)}>
              <option value="all">{bookLabel("led.all")}</option>
              <option value="in">{bookLabel("led.in")}</option>
              <option value="out">{bookLabel("led.out")}</option>
              {spendCats.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </label>
          <label className="modal-field" style={{ flex: "0 1 140px", minWidth: 120, margin: 0 }}>
            <span>From</span>
            <input type="date" value={ledFrom} onChange={(e) => setLedFrom(e.target.value)} />
          </label>
          <label className="modal-field" style={{ flex: "0 1 140px", minWidth: 120, margin: 0 }}>
            <span>To</span>
            <input type="date" value={ledTo} onChange={(e) => setLedTo(e.target.value)} />
          </label>
          {ledFiltered && (
            <button
              type="button"
              className="btn sm"
              onClick={() => { setLedCat("all"); setLedFrom(""); setLedTo(""); }}
            >
              Clear
            </button>
          )}
        </div>
        {monthRows.length ? (
          <>
          <div className="bank-ledger" style={{ margin: "0 12px 12px" }}>
            <div className="bank-hdr">
              <span>Date</span>
              <span>Particulars</span>
              <span className="bank-amt">Out ₹</span>
              <span className="bank-amt">In ₹</span>
              <span className="bank-amt">Net</span>
            </div>
            {monthPg.view.map((row) => {
              // Net Cr/Dr = running balance (surplus Cr, deficit Dr)
              const balDr = row.balance < -0.005;
              // Line tag: money-out = Dr, money-in = Cr
              const lineDr = row.debit > 0.005;
              return (
              <div className="bank-row books-go" key={row.id} onClick={() => openTxn(row.id)} role="link">
                <span className="bank-date">{row.date}</span>
                <span className="bank-parts">
                  {row.particulars}
                  {row.detail && <small>{row.detail}</small>}
                </span>
                <span className={"bank-amt" + (lineDr ? " dr" : "")}>
                  {lineDr ? "₹" + inr(row.debit) : ""}
                  {lineDr ? <span className="bal-tag dr">Dr</span> : null}
                </span>
                <span className={"bank-amt" + (row.credit > 0.005 ? " cr" : "")}>
                  {row.credit > 0.005 ? "₹" + inr(row.credit) : ""}
                  {row.credit > 0.005 ? <span className="bal-tag cr">Cr</span> : null}
                </span>
                <span className={"bank-amt bal" + (balDr ? " dr" : " cr")}>
                  ₹{inr(Math.abs(row.balance))}
                  <span className={"bal-tag " + (balDr ? "dr" : "cr")}>{balDr ? "Dr" : "Cr"}</span>
                </span>
              </div>
              );
            })}
            <div className="bank-row bank-total">
              <span className="bank-date"></span>
              <span className="bank-parts">{ledFiltered ? bookLabel("led.filtered") : bookLabel("led.net") + " " + monthLabel}</span>
              <span className="bank-amt dr">₹{inr(ledOut)}</span>
              <span className="bank-amt cr">₹{inr(ledIn)}</span>
              <span className={"bank-amt bal" + (ledNet < -0.005 ? " dr" : " cr")}>
                ₹{inr(Math.abs(ledNet))}
                <span className={"bal-tag " + (ledNet < -0.005 ? "dr" : "cr")}>{ledNet < -0.005 ? "Dr" : "Cr"}</span>
              </span>
            </div>
          </div>
          <Pager page={monthPg.page} pages={monthPg.pages} total={monthPg.total} onPage={monthPg.setPage} />
          </>
        ) : (
          <div className="stmt-sub" style={{ padding: "10px 16px", opacity: 0.7 }}>
            {ledFiltered ? "No entries match these filters." : "No money moved in " + monthLabel + "."}
          </div>
        )}
      </div>
      )}

      {/* cash book — the manager's open cash, running balance from opening carry */}
      {view === "cash" && (
      <>
      <div className="panel-card" style={{ marginTop: 18 }}>
        <div className="pc-head" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <span><Name id="cash.head" /></span>
          <span className="pc-head-meta">
            closing ₹{inr(cashClose)}
          </span>
        </div>
        <div className="bank-ledger" style={{ margin: "0 12px 12px" }}>
          <div className="bank-hdr">
            <span>Date</span>
            <span>Particulars</span>
            <span className="bank-amt">Out ₹</span>
            <span className="bank-amt">In ₹</span>
            <span className="bank-amt">Balance</span>
          </div>
          <div className="bank-row">
            <span className="bank-date"></span>
            <span className="bank-parts">
              <Name id="cash.open" />
              <small>{bookLabel("cash.openNote")}</small>
            </span>
            <span className="bank-amt"></span>
            <span className="bank-amt"></span>
            <span className={"bank-amt bal" + (carry < -0.005 ? " dr" : " cr")}>
              ₹{inr(Math.abs(carry))}
              <span className={"bal-tag " + (carry < -0.005 ? "dr" : "cr")}>{carry < -0.005 ? "Dr" : "Cr"}</span>
            </span>
          </div>
          {cashPg.view.map((row) => {
            const balDr = row.balance < -0.005;
            const lineDr = row.debit > 0.005;
            return (
              <div className="bank-row books-go" key={row.id} onClick={() => openTxn(row.id)} role="link">
                <span className="bank-date">{row.date}</span>
                <span className="bank-parts">
                  {row.particulars}
                  {row.detail && <small>{row.detail}</small>}
                </span>
                <span className={"bank-amt" + (lineDr ? " dr" : "")}>
                  {lineDr ? "₹" + inr(row.debit) : ""}
                  {lineDr ? <span className="bal-tag dr">Dr</span> : null}
                </span>
                <span className={"bank-amt" + (row.credit > 0.005 ? " cr" : "")}>
                  {row.credit > 0.005 ? "₹" + inr(row.credit) : ""}
                  {row.credit > 0.005 ? <span className="bal-tag cr">Cr</span> : null}
                </span>
                <span className={"bank-amt bal" + (balDr ? " dr" : " cr")}>
                  ₹{inr(Math.abs(row.balance))}
                  <span className={"bal-tag " + (balDr ? "dr" : "cr")}>{balDr ? "Dr" : "Cr"}</span>
                </span>
              </div>
            );
          })}
          <div className="bank-row bank-total">
            <span className="bank-date"></span>
            <span className="bank-parts"><Name id="cash.close" /></span>
            <span className="bank-amt dr">₹{inr(cashOut)}</span>
            <span className="bank-amt cr">₹{inr(cashIn)}</span>
            <span className={"bank-amt bal" + (cashClose < -0.005 ? " dr" : " cr")}>
              ₹{inr(Math.abs(cashClose))}
              <span className={"bal-tag " + (cashClose < -0.005 ? "dr" : "cr")}>{cashClose < -0.005 ? "Dr" : "Cr"}</span>
            </span>
          </div>
        </div>
      </div>
      <Pager page={cashPg.page} pages={cashPg.pages} total={cashPg.total} onPage={cashPg.setPage} />
      </>
      )}

      {/* bank book — the UPI accounts (same data as the Accounts tab) */}
      {view === "bank" && (
      <div className="panel-card" style={{ marginTop: 18 }}>
        <div className="pc-head" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <span><Name id="bank.head" /></span>
          <span className="pc-head-meta">
            on hand ₹{inr(bankLedger.totalBalance)}
          </span>
        </div>
        <div className="bank-ledger" style={{ margin: "0 12px 12px" }}>
          <div className="bank-hdr">
            <span></span>
            <span><Name id="bank.acct" /></span>
            <span className="bank-amt">Received ₹</span>
            <span className="bank-amt">Out ₹</span>
            <span className="bank-amt">Balance</span>
          </div>
          {bankLedger.accounts.map((a) => {
            const balDr = a.balance < -0.005;
            return (
              <div className="bank-row" key={a.name || "unnamed"}>
                <span className="bank-date"></span>
                <span className="bank-parts">
                  {a.name || "—"}
                  <small>
                    {a.lines.length} {a.lines.length === 1 ? "entry" : "entries"}
                    {a.ownerReceived > 0.5 ? " · owner ₹" + inr(a.ownerReceived) + " (not on hand)" : ""}
                    {a.spent > 0.5 ? " · transport ₹" + inr(a.spent) : ""}
                  </small>
                </span>
                <span className="bank-amt cr">₹{inr(a.received)}</span>
                <span className="bank-amt dr">₹{inr(a.collected + (a.spent || 0))}</span>
                <span className={"bank-amt bal" + (balDr ? " dr" : " cr")}>
                  ₹{inr(Math.abs(a.balance))}
                  <span className={"bal-tag " + (balDr ? "dr" : "cr")}>{balDr ? "Dr" : "Cr"}</span>
                </span>
              </div>
            );
          })}
          <div className="bank-row bank-total">
            <span className="bank-date"></span>
            <span className="bank-parts"><Name id="bank.total" /></span>
            <span className="bank-amt cr">₹{inr(bankLedger.totalReceived)}</span>
            <span className="bank-amt dr">₹{inr(bankLedger.totalCollected + (bankLedger.totalSpent || 0))}</span>
            <span className={"bank-amt bal" + (bankLedger.totalBalance < -0.005 ? " dr" : " cr")}>
              ₹{inr(Math.abs(bankLedger.totalBalance))}
              <span className={"bal-tag " + (bankLedger.totalBalance < -0.005 ? "dr" : "cr")}>
                {bankLedger.totalBalance < -0.005 ? "Dr" : "Cr"}
              </span>
            </span>
          </div>
        </div>
        {bankLedger.accounts.length === 0 && (
          <div className="stmt-sub" style={{ padding: "10px 16px", opacity: 0.7 }}>
            No UPI accounts yet — add them on the Accounts tab.
          </div>
        )}
      </div>
      )}

      {/* balance sheet — formal two-sided view; both totals tie */}
      {view === "balance" && (
      <>
      <div className="sectitle sectitle-sub sub-28">
        <span className="phone-ico ph-only"><TabIcon icon="scale" size={16} /></span>
        <Name id="bal.head" />
      </div>
      <div className="books-grid">
        <div className="party-card">
          <div className="party-stat-label" style={{ marginBottom: 10 }}><Name id="bal.liab" /></div>
          <div className="books-row"><span><Name id="bal.wages" /> <small>· Attendance</small></span><b className="due">₹{inr(snapshot.unpaidWages)}</b></div>
          <div className="books-row"><span><Name id="bal.custAdv" /> <small>· Balances</small></span><b className="due">₹{inr(snapshot.custAdvances)}</b></div>
          <div className="books-row">
            <span><Name id="bal.capital" /> <small>· balancing figure</small></span>
            <b className={snapshot.position >= 0 ? "ok" : "due"}>{snapshot.position < 0 ? "−" : ""}₹{inr(Math.abs(snapshot.position))}</b>
          </div>
          <div className="books-row books-total"><span><Name id="bal.total" /></span><b>₹{inr(snapshot.assets)}</b></div>
        </div>
        <div className="party-card">
          <div className="party-stat-label" style={{ marginBottom: 10 }}><Name id="bal.assets" /></div>
          <div className="books-row"><span><Name id="bal.cash" /> <small>· Daybook</small></span><b>₹{inr(snapshot.cashInHand)}</b></div>
          <div className="books-row"><span><Name id="bal.upi" /> <small>· Accounts</small></span><b>₹{inr(snapshot.upiWithHolders)}</b></div>
          <div className="books-row"><span><Name id="bal.dues" /> <small>· Balances</small></span><b>₹{inr(snapshot.receivables)}</b></div>
          <div className="books-row"><span><Name id="bal.worker" /> <small>· Attendance</small></span><b>₹{inr(snapshot.workerAdvances)}</b></div>
          <div className="books-row books-total"><span><Name id="bal.total" /></span><b>₹{inr(snapshot.assets)}</b></div>
        </div>
      </div>
      <div className="stmt-sub" style={{ padding: "10px 2px", opacity: 0.7, fontSize: 12 }}>
        Owner&rsquo;s capital is the balancing figure (the net position) — the unofficial books keep no separate capital account.
      </div>
      </>
      )}

      {view === "assets" && (
      <>
      {/* assets & liabilities — live snapshot */}
      <div className="sectitle sectitle-sub sub-28">
        <span className="phone-ico ph-only"><TabIcon icon="wallet" size={16} /></span>
        <Name id="ast.head" />
      </div>
      <div className="books-grid">
        <div className="party-card">
          <div className="party-stat-label" style={{ marginBottom: 10 }}><Name id="ast.hold" /></div>
          <div className="books-row"><span><Name id="bal.cash" /> <small>· Daybook</small></span><b>₹{inr(snapshot.cashInHand)}</b></div>
          <div className="books-row"><span><Name id="bal.upi" /> <small>· Accounts</small></span><b>₹{inr(snapshot.upiWithHolders)}</b></div>
          <div className="books-row"><span><Name id="bal.dues" /> <small>· Balances</small></span><b>₹{inr(snapshot.receivables)}</b></div>
          <div className="books-row"><span><Name id="bal.worker" /> <small>· Attendance</small></span><b>₹{inr(snapshot.workerAdvances)}</b></div>
          <div className="books-row books-total"><span><Name id="ast.assets" /></span><b className="ok">₹{inr(snapshot.assets)}</b></div>
        </div>
        <div className="party-card">
          <div className="party-stat-label" style={{ marginBottom: 10 }}><Name id="ast.owe" /></div>
          <div className="books-row"><span><Name id="bal.wages" /> <small>· Attendance</small></span><b className="due">₹{inr(snapshot.unpaidWages)}</b></div>
          <div className="books-row"><span><Name id="bal.custAdv" /> <small>· Balances</small></span><b className="due">₹{inr(snapshot.custAdvances)}</b></div>
          <div className="books-row books-total"><span><Name id="ast.liab" /></span><b className="due">₹{inr(snapshot.liabilities)}</b></div>
          <div className="books-row books-total" style={{ marginTop: 8 }}>
            <span><Name id="ast.net" /></span>
            <b className={snapshot.position >= 0 ? "ok" : "due"}>{snapshot.position < 0 ? "−" : ""}₹{inr(Math.abs(snapshot.position))}</b>
          </div>
        </div>
      </div>
      </>
      )}
      {(view === "ledger" || view === "cash") && (
        <PassbookPrint
          printRef={printRef}
          dr="Out ₹"
          cr="In ₹"
          positiveIsDr={false}
          summary={
            view === "ledger"
              ? [
                  { k: "Out", v: "₹ " + inr(ledOut) },
                  { k: "In", v: "₹ " + inr(ledIn) },
                  { k: "Net", v: "₹ " + inr(ledNet) },
                ]
              : [
                  { k: "Opening", v: "₹ " + inr(carry) },
                  { k: "In", v: "₹ " + inr(cashIn) },
                  { k: "Out", v: "₹ " + inr(cashOut) },
                  { k: "Closing", v: "₹ " + inr(cashClose) },
                ]
          }
          rows={view === "ledger" ? ledgerPdfRows : cashPdfRows}
        />
      )}
    </div></div>
  );
}
