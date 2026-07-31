"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { allRec } from "@/lib/data";
import { dateSortKey, inr } from "@/lib/calc";
import {
  inDaybook,
  isInflow,
  openingCarry,
  spendCategoryOf,
  spendCatKey,
  spendDetailOf,
  SPEND_CATEGORIES,
  typeLabel,
} from "@/lib/expenses";
import { partyLedger, quoteBill } from "@/lib/payments";
import { acctLedger, listCollections, listHolders, type AccountCollection, type PayHolder } from "@/lib/accounts";
import { listAttendance, listWorkers, workerAccount, type AttendanceMark, type Worker } from "@/lib/attendance";
import { USERS } from "@/lib/local-auth";
import { brandFor } from "@/lib/brand";
import { generatePdf, printOrSavePdf } from "@/lib/pdf";
import { useApp } from "@/store/useApp";
import { toast } from "@/store/app-store";
import type { Customer, Doc, Expense } from "@/lib/types";

const r2 = (n: number) => Math.round(n * 100) / 100;
const userName = (id: string) => USERS.find((u) => u.id === id)?.name || id || "—";
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

const isBillable = (d: Doc) =>
  d.status === "Created" || (+(d.payCash || 0)) > 0 || (+(d.payUpi || 0)) > 0 || (+(d.amountPaid || 0)) > 0;

type BookTab = "sales" | "cash" | "expenses" | "pl" | "bs";

const TABS: { key: BookTab; label: string; desc: string }[] = [
  { key: "pl", label: "P&L", desc: "Gross profit − Expenses = Net profit" },
  { key: "bs", label: "Balance Sheet", desc: "Assets − Liabilities = Capital" },
  { key: "sales", label: "Sales Book", desc: "All money in, chronological" },
  { key: "cash", label: "Cash Book", desc: "Cash in hand with running balance" },
  { key: "expenses", label: "Expenses", desc: "All money out, by type" },
];

export default function BooksView() {
  const { ready, dataVersion, brandMode } = useApp();
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, "0"));
  const [year, setYear] = useState(String(now.getFullYear()).slice(2));
  const [tab, setTab] = useState<BookTab>("pl");
  const [pdfBusy, setPdfBusy] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [quotes, setQuotes] = useState<Doc[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [collections, setCollections] = useState<AccountCollection[]>([]);
  const [holders, setHolders] = useState<PayHolder[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [marks, setMarks] = useState<AttendanceMark[]>([]);
  const [carry, setCarry] = useState(0);
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

  // ── raw data slices ──────────────────────────────────────────────────────
  const monthExp = useMemo(() => expenses.filter((e) => inMonth(e.date)), [expenses, month, year]); // eslint-disable-line react-hooks/exhaustive-deps

  const income = useMemo(() => {
    const sales = monthExp.filter((e) => e.type === "sale" && !e.charge);
    const cash = r2(sales.filter((e) => e.mode !== "upi").reduce((s, e) => s + (+e.amount || 0), 0));
    const upiOwner = r2(
      sales.filter((e) => e.mode === "upi" && e.toOwner).reduce((s, e) => s + (+e.amount || 0), 0),
    );
    const upiOther = r2(
      sales.filter((e) => e.mode === "upi" && !e.toOwner).reduce((s, e) => s + (+e.amount || 0), 0),
    );
    const upi = r2(upiOwner + upiOther);
    return { cash, upi, upiOwner, upiOther, total: r2(cash + upi), count: sales.length };
  }, [monthExp]);

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
    () => r2(quotes.filter((d) => !d.deletedAt && !d.purgedAt && inMonth(d.date) && isBillable(d)).reduce((s, d) => s + quoteBill(d), 0)),
    [quotes, month, year], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const directCosts = useMemo(() => {
    const dir = monthExp.filter((e) => (e.type === "additional" || e.type === "custom") && !e.charge);
    const total = r2(dir.reduce((s, e) => s + (+e.amount || 0), 0));
    const byLabel = new Map<string, number>();
    for (const e of dir) {
      const l = e.label || e.type;
      byLabel.set(l, r2((byLabel.get(l) || 0) + (+e.amount || 0)));
    }
    return { total, count: dir.length, byLabel };
  }, [monthExp]);

  const indirectCosts = useMemo(() => {
    const ind = monthExp.filter((e) => (e.type === "salary" || e.type === "food") && !e.charge);
    const total = r2(ind.reduce((s, e) => s + (+e.amount || 0), 0));
    const byType = new Map<string, number>();
    for (const e of ind) {
      byType.set(e.type, r2((byType.get(e.type) || 0) + (+e.amount || 0)));
    }
    return { total, count: ind.length, byType };
  }, [monthExp]);

  const grossProfit = r2(income.total + billedMonth - directCosts.total);
  const netProfit = r2(grossProfit - indirectCosts.total);
  const net = r2(income.total - spends.total);

  // ── cash book entries ─────────────────────────────────────────────────────
  const cashBookRows = useMemo(() => {
    const cashMoves = monthExp
      .filter((e) => !e.charge && !(e.mode === "upi"))
      .map((e) => {
        const inflow = isInflow(e.type);
        return {
          id: e.id,
          date: e.date,
          at: e.createdAt || "",
          particulars: inflow ? (e.custId ? "Received" : "Sale") + (e.toOwner ? " → Owner" : "") : typeLabel(e.type) + (e.label ? " · " + e.label : ""),
          detail: [e.note, "by " + userName(e.enteredBy)].filter(Boolean).join(" · "),
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
    for (const row of cashMoves) {
      bal = r2(bal + row.credit - row.debit);
      row.balance = bal;
    }
    return cashMoves;
  }, [monthExp]);

  // ── sales book entries ────────────────────────────────────────────────────
  const salesBookRows = useMemo(() => {
    const rows = monthExp
      .filter((e) => e.type === "sale" && !e.charge)
      .map((e) => ({
        id: e.id,
        date: e.date,
        at: e.createdAt || "",
        customer: e.custId ? customers.find((c) => c.id === e.custId)?.name : "Walk-in",
        mode: e.mode === "upi" ? "UPI" + (e.account ? " · " + e.account : "") : "Cash",
        amount: +e.amount || 0,
        note: e.note || "",
        by: userName(e.enteredBy),
      }))
      .concat(
        quotes.filter((d) => !d.deletedAt && !d.purgedAt && inMonth(d.date) && isBillable(d)).map((d) => ({
          id: d.id,
          date: d.date,
          at: d.createdAt || "",
          customer: d.customerName || "—",
          mode: "Quote #" + (d.displayNumber || d.number),
          amount: quoteBill(d),
          note: "",
          by: "",
        })),
      )
      .sort((a, b) => {
        const d = sortKey(a.date).localeCompare(sortKey(b.date));
        if (d !== 0) return d;
        return (a.at || "").localeCompare(b.at || "");
      });
    return rows;
  }, [monthExp, quotes, month, year, customers]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── full month ledger (every cash event) ──────────────────────────────────
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

  // ── balance sheet snapshot ────────────────────────────────────────────────
  const snapshot = useMemo(() => {
    const openCash = expenses.filter((e) => !e.sessionId && inDaybook(e));
    const cashIn = openCash.filter((e) => isInflow(e.type)).reduce((s, e) => s + (+e.amount || 0), 0);
    const cashOut = openCash.filter((e) => !isInflow(e.type)).reduce((s, e) => s + (+e.amount || 0), 0);
    const cashInHand = r2(carry + cashIn - cashOut);

    const ledger = acctLedger(expenses, collections, quotes, customers);
    const acctBal = ledger.accounts.reduce((s, a) => s + a.balance, 0);
    const holderOpen = holders.reduce((s, h) => s + (+(h.opening || 0) || 0), 0);
    const holderCols = collections.filter((c) => !!c.holderId).reduce((s, c) => s + (+c.amount || 0), 0);
    const upiWithHolders = r2(acctBal + holderOpen - holderCols);

    const { parties, totalPending } = partyLedger(quotes, expenses, customers);
    const receivables = r2(totalPending);
    const custAdvances = r2(parties.filter((p) => p.balance < -0.5).reduce((s, p) => s + -p.balance, 0));

    let unpaidWages = 0;
    let workerAdvances = 0;
    for (const w of workers.filter((x) => x.active !== false)) {
      const acc = workerAccount(w, marks, expenses);
      if (acc.wageBalance > 0.5) unpaidWages = r2(unpaidWages + acc.wageBalance);
      if (acc.debt > 0.5) workerAdvances = r2(workerAdvances + acc.debt);
    }

    const assets = r2(cashInHand + upiWithHolders + receivables + workerAdvances);
    const liabilities = r2(unpaidWages + custAdvances);
    return {
      cashInHand, upiWithHolders, receivables, workerAdvances,
      unpaidWages, custAdvances, assets, liabilities,
      position: r2(assets - liabilities),
    };
  }, [expenses, quotes, customers, collections, holders, workers, marks, carry]);

  const monthLabel = (MONTHS.find(([v]) => v === month)?.[1] || month) + " 20" + year;
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
  const bookName = TABS.find((t) => t.key === tab)?.label || "Books";
  const brand = brandFor(brandMode);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const today = new Date();
  const genOn = `${pad2(today.getDate())}-${pad2(today.getMonth() + 1)}-${today.getFullYear()}`;
  async function downloadPdf() {
    if (pdfBusy) return;
    setPdfBusy(true);
    try {
      if ((await printOrSavePdf(printRef.current, bookName.replace(/[\s/]+/g, "-").toLowerCase() + "-" + monthLabel.replace(/\s+/g, "-") + "-" + genOn)) === "pdf") toast("PDF downloaded ✓");
    } catch (e) {
      toast("PDF error: " + ((e as Error)?.message || e));
    } finally {
      setPdfBusy(false);
    }
  }

  // ── tab renderers ─────────────────────────────────────────────────────────

  /** 1. Profit & Loss — GP − Indirect expenses = Net Profit */
  const renderPL = () => (
    <div>
      <div className="party-grid" style={{ marginTop: 6 }}>
        <div className="party-card">
          <div className="party-stat-label">Gross Profit (from Trading)</div>
          <div className={"party-stat-value " + (grossProfit >= 0 ? "ok" : "due")}>{grossProfit < 0 ? "−" : ""}₹ {inr(Math.abs(grossProfit))}</div>
          <div className="party-stat-sub">{grossProfit >= 0 ? "brought down" : "trading loss brought down"}</div>
        </div>
        <div className="party-card">
          <div className="party-stat-label">Indirect expenses · {monthLabel}</div>
          <div className="party-stat-value due">₹ {inr(indirectCosts.total)}</div>
          <div className="party-stat-sub">{indirectCosts.count} entries (salary, food, overheads)</div>
        </div>
        <div className="party-card hero">
          <div className="party-stat-label">Net Profit</div>
          <div className={"party-stat-value " + (netProfit >= 0 ? "ok" : "due")}>{netProfit < 0 ? "−" : ""}₹ {inr(Math.abs(netProfit))}</div>
          <div className="party-stat-sub">{netProfit >= 0 ? "profit for the month" : "loss for the month"}</div>
        </div>
      </div>

      <div className="books-grid" style={{ marginTop: 0 }}>
        <div className="party-card">
          <div className="party-stat-label" style={{ marginBottom: 10 }}>Dr — Expenses</div>
          {indirectCosts.byType.size === 0 && <div className="books-row"><span>No indirect expenses</span><b>—</b></div>}
          {[...indirectCosts.byType.entries()].sort((a, b) => b[1] - a[1]).map(([t, amt]) => (
            <div className="books-row" key={t}><span>{typeLabel(t as Expense["type"])}</span><b className="due">₹{inr(amt)}</b></div>
          ))}
          {/* other expenses not in salary/food (e.g. 'custom' that wasn't counted as direct) */}
          {spends.byCat.size > 0 && [...spends.byCat.entries()]
            .filter(([k]) => k !== "salary" && k !== "food")
            .sort((a, b) => b[1].amount - a[1].amount)
            .map(([k, g]) => (
              <div className="books-row" key={k}><span>{g.label}</span><b className="due">₹{inr(g.amount)}</b></div>
            ))}
          <div className="books-row books-total"><span>Total expenses</span><b className="due">₹{inr(indirectCosts.total)}</b></div>
        </div>
        <div className="party-card">
          <div className="party-stat-label" style={{ marginBottom: 10 }}>Cr — Income</div>
          <div className="books-row"><span>Gross profit brought down</span><b className="ok">₹{inr(grossProfit)}</b></div>
          {duesAdded > 0 && <div className="books-row"><span>Dues added (non-cash)</span><b>₹{inr(duesAdded)}</b></div>}
          <div className="books-row books-total"><span>Total income</span><b className="ok">₹{inr(grossProfit)}</b></div>
          <div className="books-row" style={{ borderTop: "2px solid var(--ochre)", marginTop: 6, paddingTop: 9, fontWeight: 700 }}>
            <span>{netProfit >= 0 ? "Net Profit" : "Net Loss"}</span>
            <b className={netProfit >= 0 ? "ok" : "due"}>₹{inr(Math.abs(netProfit))}</b>
          </div>
        </div>
      </div>
    </div>
  );

  /** 3. Balance Sheet — Assets, Liabilities, Capital */
  const renderBS = () => (
    <div>
      <div className="party-grid" style={{ marginTop: 6 }}>
        <div className="party-card">
          <div className="party-stat-label">Total Assets</div>
          <div className="party-stat-value ok">₹ {inr(snapshot.assets)}</div>
          <div className="party-stat-sub">what the business holds</div>
        </div>
        <div className="party-card">
          <div className="party-stat-label">Total Liabilities</div>
          <div className="party-stat-value due">₹ {inr(snapshot.liabilities)}</div>
          <div className="party-stat-sub">what the business owes</div>
        </div>
        <div className="party-card hero">
          <div className="party-stat-label">Capital (Net Worth)</div>
          <div className={"party-stat-value " + (snapshot.position >= 0 ? "ok" : "due")}>{snapshot.position < 0 ? "−" : ""}₹ {inr(Math.abs(snapshot.position))}</div>
          <div className="party-stat-sub">Assets − Liabilities</div>
        </div>
      </div>

      <div className="books-grid">
        <div className="party-card">
          <div className="party-stat-label" style={{ marginBottom: 10 }}>Assets</div>
          <div className="books-row"><span>Cash in hand <small>· Daybook</small></span><b className="ok">₹{inr(snapshot.cashInHand)}</b></div>
          <div className="books-row"><span>UPI with holders <small>· Accounts</small></span><b className="ok">₹{inr(snapshot.upiWithHolders)}</b></div>
          <div className="books-row"><span>Customer dues <small>· Balances</small></span><b className="ok">₹{inr(snapshot.receivables)}</b></div>
          <div className="books-row"><span>Worker advances <small>· Attendance</small></span><b className="ok">₹{inr(snapshot.workerAdvances)}</b></div>
          <div className="books-row books-total"><span>Total assets</span><b className="ok">₹{inr(snapshot.assets)}</b></div>
        </div>
        <div className="party-card">
          <div className="party-stat-label" style={{ marginBottom: 10 }}>Liabilities &amp; Capital</div>
          <div className="books-row"><span>Unpaid wages <small>· Attendance</small></span><b className="due">₹{inr(snapshot.unpaidWages)}</b></div>
          <div className="books-row"><span>Customer advances <small>· Balances</small></span><b className="due">₹{inr(snapshot.custAdvances)}</b></div>
          <div className="books-row books-total"><span>Total liabilities</span><b className="due">₹{inr(snapshot.liabilities)}</b></div>
          <div className="books-row" style={{ borderTop: "2px solid var(--ochre)", marginTop: 6, paddingTop: 9, fontWeight: 700 }}>
            <span>Capital (net worth)</span>
            <b className={snapshot.position >= 0 ? "ok" : "due"}>{snapshot.position < 0 ? "−" : ""}₹{inr(Math.abs(snapshot.position))}</b>
          </div>
        </div>
      </div>
    </div>
  );

  /** 4. Sales Book — every money-in event, chronological */
  const renderSalesBook = () => (
    <div className="panel-card" style={{ marginTop: 12 }}>
      <div className="pc-head" style={{ justifyContent: "space-between" }}>
        <span>Sales Book · {monthLabel}</span>
        <span style={{ fontFamily: "var(--mono)", fontSize: 12, textTransform: "none", letterSpacing: 0 }}>
          {salesBookRows.length} entry{salesBookRows.length === 1 ? "" : "s"} · ₹{inr(income.total + billedMonth)}
        </span>
      </div>
      {salesBookRows.length ? (
        <div className="bank-ledger" style={{ margin: "10px 12px 12px" }}>
          <div className="bank-hdr">
            <span>Date</span>
            <span>Customer / Ref</span>
            <span className="bank-amt">Mode</span>
            <span className="bank-amt">Amount ₹</span>
            <span className="bank-amt"></span>
          </div>
          {salesBookRows.map((row, i) => (
            <div className="bank-row" key={row.id + "-" + i} style={{ cursor: "default" }}>
              <span className="bank-date">{row.date}</span>
              <span className="bank-parts">
                {row.customer || "—"}
                {row.note && <small>{row.note}</small>}
              </span>
              <span className="bank-amt" style={{ fontSize: 10, textTransform: "uppercase", color: "var(--ink-faint)", fontWeight: 600 }}>{row.mode}</span>
              <span className="bank-amt cr">₹{inr(row.amount)}</span>
              <span className="bank-amt"></span>
            </div>
          ))}
          <div className="bank-row bank-total">
            <span></span>
            <span className="bank-parts">Total sales</span>
            <span></span>
            <span className="bank-amt cr" style={{ fontSize: 13.5 }}>₹{inr(income.total + billedMonth)}</span>
            <span></span>
          </div>
        </div>
      ) : (
        <div className="stmt-sub" style={{ padding: "10px 16px", opacity: 0.7 }}>No sales in {monthLabel}.</div>
      )}
    </div>
  );

  /** 5. Cash Book — every cash movement with running balance */
  const renderCashBook = () => (
    <div className="panel-card" style={{ marginTop: 12 }}>
      <div className="pc-head" style={{ justifyContent: "space-between" }}>
        <span>Cash Book · {monthLabel}</span>
        <span style={{ fontFamily: "var(--mono)", fontSize: 12, textTransform: "none", letterSpacing: 0 }}>
          in ₹{inr(cashBookRows.reduce((s, r) => s + r.credit, 0))} · out ₹{inr(cashBookRows.reduce((s, r) => s + r.debit, 0))}
        </span>
      </div>
      {cashBookRows.length ? (
        <div className="bank-ledger" style={{ margin: "10px 12px 12px" }}>
          <div className="bank-hdr">
            <span>Date</span>
            <span>Particulars</span>
            <span className="bank-amt">Out ₹</span>
            <span className="bank-amt">In ₹</span>
            <span className="bank-amt">Balance</span>
          </div>
          {cashBookRows.map((row) => (
            <div className="bank-row" key={row.id}>
              <span className="bank-date">{row.date}</span>
              <span className="bank-parts">
                {row.particulars}
                {row.detail && <small>{row.detail}</small>}
              </span>
              <span className={"bank-amt" + (row.debit > 0 ? " dr" : "")}>{row.debit > 0 ? "₹" + inr(row.debit) : ""}</span>
              <span className={"bank-amt" + (row.credit > 0 ? " cr" : "")}>{row.credit > 0 ? "₹" + inr(row.credit) : ""}</span>
              <span className="bank-amt bal">
                ₹{inr(Math.abs(row.balance))}
                <span className={"bal-tag " + (row.balance >= 0 ? "cr" : "dr")}>{row.balance >= 0 ? "Cr" : "Dr"}</span>
              </span>
            </div>
          ))}
          <div className="bank-row bank-total">
            <span></span>
            <span className="bank-parts">Net cash movement</span>
            <span className="bank-amt dr">₹{inr(cashBookRows.reduce((s, r) => s + r.debit, 0))}</span>
            <span className="bank-amt cr">₹{inr(cashBookRows.reduce((s, r) => s + r.credit, 0))}</span>
            <span className={"bank-amt bal " + (cashBookRows.length && cashBookRows[cashBookRows.length - 1].balance >= 0 ? "ok" : "due")}>
              ₹{inr(Math.abs(cashBookRows.length ? cashBookRows[cashBookRows.length - 1].balance : 0))}
            </span>
          </div>
        </div>
      ) : (
        <div className="stmt-sub" style={{ padding: "10px 16px", opacity: 0.7 }}>No cash movements in {monthLabel}.</div>
      )}
    </div>
  );

  /** 6. Expenses Book — grouped & chronological */
  const renderExpensesBook = () => (
    <div>
      {/* expense breakdown cards */}
      <div className="party-grid" style={{ marginTop: 6 }}>
        <div className="party-card">
          <div className="party-stat-label">Total spent · {monthLabel}</div>
          <div className="party-stat-value due">₹ {inr(spends.total)}</div>
          <div className="party-stat-sub">{spends.count} entries · {spends.byCat.size} categories</div>
        </div>
        <div className="party-card">
          <div className="party-stat-label">Direct costs</div>
          <div className="party-stat-value due">₹ {inr(directCosts.total)}</div>
          <div className="party-stat-sub">{directCosts.count} entries (material, freight, custom)</div>
        </div>
        <div className="party-card">
          <div className="party-stat-label">Indirect costs</div>
          <div className="party-stat-value due">₹ {inr(indirectCosts.total)}</div>
          <div className="party-stat-sub">{indirectCosts.count} entries (salary, food, overheads)</div>
        </div>
      </div>

      {/* breakdown by type */}
      <div className="panel-card" style={{ marginTop: 12 }}>
        <div className="pc-head">Expenses by type</div>
        <div className="books-grid" style={{ margin: "8px 14px 14px" }}>
          <div>
            <div className="party-stat-label" style={{ marginBottom: 6 }}>Direct (trading)</div>
            {directCosts.byLabel.size === 0 && <div className="books-row"><span>None</span><b>—</b></div>}
            {[...directCosts.byLabel.entries()].sort((a, b) => b[1] - a[1]).map(([l, amt]) => (
              <div className="books-row" key={l}><span>{l}</span><b className="due">₹{inr(amt)}</b></div>
            ))}
          </div>
          <div>
            <div className="party-stat-label" style={{ marginBottom: 6 }}>Indirect (overheads)</div>
            {[...spends.byCat.entries()].filter(([k]) => k === "salary" || k === "food").sort((a, b) => b[1].amount - a[1].amount).map(([k, g]) => (
              <div className="books-row" key={k}><span>{g.label}</span><b className="due">₹{inr(g.amount)}</b></div>
            ))}
          </div>
        </div>
      </div>

      {/* all expenses chronological */}
      <div className="panel-card" style={{ marginTop: 12 }}>
        <div className="pc-head" style={{ justifyContent: "space-between" }}>
          <span>All outflows · {monthLabel}</span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 12, textTransform: "none", letterSpacing: 0 }}>
            {spends.count} entry{spends.count === 1 ? "" : "s"}
          </span>
        </div>
        {monthRows.filter((r) => r.debit > 0).length ? (
          <div className="bank-ledger" style={{ margin: "10px 12px 12px" }}>
            <div className="bank-hdr">
              <span>Date</span>
              <span>Particulars</span>
              <span className="bank-amt">Amount ₹</span>
              <span className="bank-amt"></span>
              <span className="bank-amt"></span>
            </div>
            {monthRows.filter((r) => r.debit > 0).map((row) => (
              <div className="bank-row" key={row.id} style={{ cursor: "default" }}>
                <span className="bank-date">{row.date}</span>
                <span className="bank-parts">
                  {row.particulars}
                  {row.detail && <small>{row.detail}</small>}
                </span>
                <span className="bank-amt dr">₹{inr(row.debit)}</span>
                <span className="bank-amt"></span>
                <span className="bank-amt"></span>
              </div>
            ))}
            <div className="bank-row bank-total">
              <span></span>
              <span className="bank-parts">Total spent</span>
              <span className="bank-amt dr" style={{ fontSize: 13.5 }}>₹{inr(spends.total)}</span>
              <span></span>
              <span></span>
            </div>
          </div>
        ) : (
          <div className="stmt-sub" style={{ padding: "10px 16px", opacity: 0.7 }}>No expenses in {monthLabel}.</div>
        )}
      </div>
    </div>
  );

  return (
    <div className="ledger-page">
      <div className="sectitle" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span>Books <small>— accounting books: P&amp;L, Balance Sheet, Sales, Cash, Expenses</small></span>
        <button
          className="btn primary sm"
          style={{ marginLeft: "auto" }}
          disabled={pdfBusy}
          onClick={downloadPdf}
        >{pdfBusy ? "Preparing…" : "Download PDF"}</button>
      </div>

      {/* month picker */}
      <div className="stmt-filters" style={{ marginTop: 14 }}>
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

      {/* month ledger filters (applied to the full ledger on every tab) */}
      <div
        className="books-led-filters"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "flex-end",
          marginTop: 14,
          padding: "10px 12px",
        }}
      >
        <label className="modal-field" style={{ flex: "1 1 160px", minWidth: 140, margin: 0 }}>
          <span>Category</span>
          <select value={ledCat} onChange={(e) => setLedCat(e.target.value)}>
            <option value="all">All</option>
            <option value="in">Money in</option>
            <option value="out">All expenses</option>
            {SPEND_CATEGORIES.map((c) => (
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

      {/* tab bar */}
      <div className="db-seg" style={{ marginTop: 18 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={"seg-btn" + (tab === t.key ? " on" : "")}
            type="button"
            onClick={() => setTab(t.key)}
            title={t.desc}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* active tab content */}
      {tab === "pl" && renderPL()}
      {tab === "bs" && renderBS()}
      {tab === "sales" && renderSalesBook()}
      {tab === "cash" && renderCashBook()}
      {tab === "expenses" && renderExpensesBook()}

      {/* ---- printable book (matches the active tab) ---- */}
      <div className="cd-print rep-doc" ref={printRef}>
        <div className="rep-head">
          <div className="rep-brand">
            <h1>{brand.name || "Books"}</h1>
            {brand.addr && <div>{brand.addr}</div>}
            {brand.gstin && <div>GSTIN: {brand.gstin}</div>}
          </div>
          <div className="rep-meta">
            <div className="rep-title">{bookName}</div>
            <div className="rep-period">{monthLabel}</div>
          </div>
        </div>

        {(() => {
          switch (tab) {
                case "pl": {
                  return (
                    <>
                      <div className="rep-summary cols3">
                        <div>
                          <b className={grossProfit >= 0 ? "ok" : "due"}>{grossProfit < 0 ? "−" : ""}₹{inr(Math.abs(grossProfit))}</b>
                          <span>Gross Profit</span>
                        </div>
                        <div>
                          <b>₹{inr(indirectCosts.total)}</b>
                          <span>Indirect Expenses</span>
                        </div>
                        <div>
                          <b className={netProfit >= 0 ? "ok" : "due"}>{netProfit < 0 ? "−" : ""}₹{inr(Math.abs(netProfit))}</b>
                          <span>Net Profit</span>
                        </div>
                      </div>
                      <table className="rep-table">
                        <colgroup>
                          <col style={{ width: "50%" }} />
                          <col style={{ width: "25%" }} />
                          <col style={{ width: "25%" }} />
                        </colgroup>
                        <thead>
                          <tr>
                            <th>Dr — Expenses</th>
                            <th className="amt">Amount</th>
                            <th className="amt">Cr — Income</th>
                          </tr>
                        </thead>
                        <tbody>
                          {indirectCosts.byType.size === 0 && spends.byCat.size === 0 ? (
                            <tr>
                              <td colSpan={3}>No expenses</td>
                            </tr>
                          ) : (
                            <>
                              {[...indirectCosts.byType.entries()].sort((a, b) => b[1] - a[1]).map(([t, amt]) => (
                                <tr key={t}>
                                  <td>{typeLabel(t as Expense["type"])}</td>
                                  <td className="amt due">₹{inr(amt)}</td>
                                  <td></td>
                                </tr>
                              ))}
                              {[...spends.byCat.entries()]
                                .filter(([k]) => k !== "salary" && k !== "food")
                                .sort((a, b) => b[1].amount - a[1].amount)
                                .map(([k, g]) => (
                                  <tr key={k}>
                                    <td>{g.label}</td>
                                    <td className="amt due">₹{inr(g.amount)}</td>
                                    <td></td>
                                  </tr>
                                ))}
                            </>
                          )}
                          <tr className="rep-tot">
                            <td>Total expenses</td>
                            <td className="amt due">₹{inr(indirectCosts.total)}</td>
                            <td></td>
                          </tr>
                          <tr>
                            <td></td>
                            <td></td>
                            <td>Gross profit brought down</td>
                          </tr>
                          <tr>
                            <td></td>
                            <td></td>
                            <td className="amt ok">₹{inr(grossProfit)}</td>
                          </tr>
                          {duesAdded > 0 && (
                            <>
                              <tr>
                                <td></td>
                                <td></td>
                                <td>Dues added (non-cash)</td>
                              </tr>
                              <tr>
                                <td></td>
                                <td></td>
                                <td className="amt">₹{inr(duesAdded)}</td>
                              </tr>
                            </>
                          )}
                          <tr className="rep-tot">
                            <td></td>
                            <td></td>
                            <td>Total income</td>
                          </tr>
                          <tr className="rep-tot">
                            <td></td>
                            <td></td>
                            <td className="amt ok">₹{inr(grossProfit)}</td>
                          </tr>
                          <tr style={{ borderTop: "2px solid var(--ochre)", fontWeight: 700 }}>
                            <td>{netProfit >= 0 ? "Net Profit" : "Net Loss"}</td>
                            <td></td>
                            <td className={"amt " + (netProfit >= 0 ? "ok" : "due")}>₹{inr(Math.abs(netProfit))}</td>
                          </tr>
                        </tbody>
                      </table>
                    </>
                  );
                }
                case "bs": {
                  return (
                    <>
                      <div className="rep-summary cols3">
                        <div>
                          <b>₹{inr(snapshot.assets)}</b>
                          <span>Total Assets</span>
                        </div>
                        <div>
                          <b>₹{inr(snapshot.liabilities)}</b>
                          <span>Total Liabilities</span>
                        </div>
                        <div>
                          <b className={snapshot.position >= 0 ? "ok" : "due"}>{snapshot.position < 0 ? "−" : ""}₹{inr(Math.abs(snapshot.position))}</b>
                          <span>Capital</span>
                        </div>
                      </div>
                      <table className="rep-table">
                        <colgroup>
                          <col style={{ width: "50%" }} />
                          <col style={{ width: "25%" }} />
                          <col style={{ width: "25%" }} />
                        </colgroup>
                        <thead>
                          <tr>
                            <th>Assets</th>
                            <th className="amt"></th>
                            <th className="amt">Liabilities & Capital</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>Cash in hand <small>· Daybook</small></td>
                            <td className="amt ok">₹{inr(snapshot.cashInHand)}</td>
                            <td></td>
                          </tr>
                          <tr>
                            <td>UPI with holders <small>· Accounts</small></td>
                            <td className="amt ok">₹{inr(snapshot.upiWithHolders)}</td>
                            <td></td>
                          </tr>
                          <tr>
                            <td>Customer dues <small>· Balances</small></td>
                            <td className="amt ok">₹{inr(snapshot.receivables)}</td>
                            <td></td>
                          </tr>
                          <tr>
                            <td>Worker advances <small>· Attendance</small></td>
                            <td className="amt ok">₹{inr(snapshot.workerAdvances)}</td>
                            <td></td>
                          </tr>
                          <tr className="rep-tot">
                            <td>Total assets</td>
                            <td className="amt ok">₹{inr(snapshot.assets)}</td>
                            <td></td>
                          </tr>
                          <tr>
                            <td></td>
                            <td></td>
                            <td>Unpaid wages <small>· Attendance</small></td>
                          </tr>
                          <tr>
                            <td></td>
                            <td></td>
                            <td className="amt due">₹{inr(snapshot.unpaidWages)}</td>
                          </tr>
                          <tr>
                            <td></td>
                            <td></td>
                            <td>Customer advances <small>· Balances</small></td>
                          </tr>
                          <tr>
                            <td></td>
                            <td></td>
                            <td className="amt due">₹{inr(snapshot.custAdvances)}</td>
                          </tr>
                          <tr className="rep-tot">
                            <td></td>
                            <td></td>
                            <td>Total liabilities</td>
                          </tr>
                          <tr className="rep-tot">
                            <td></td>
                            <td></td>
                            <td className="amt due">₹{inr(snapshot.liabilities)}</td>
                          </tr>
                          <tr style={{ borderTop: "2px solid var(--ochre)", fontWeight: 700 }}>
                            <td></td>
                            <td></td>
                            <td>Capital (net worth)</td>
                          </tr>
                          <tr style={{ fontWeight: 700 }}>
                            <td></td>
                            <td></td>
                            <td className={"amt " + (snapshot.position >= 0 ? "ok" : "due")}>{snapshot.position < 0 ? "−" : ""}₹{inr(Math.abs(snapshot.position))}</td>
                          </tr>
                        </tbody>
                      </table>
                    </>
                  );
                }
                case "sales": {
                  const totalSales = income.total + billedMonth;
                  return (
                    <>
                      <div className="rep-summary cols3">
                        <div>
                          <b>{salesBookRows.length}</b>
                          <span>Entries</span>
                        </div>
                        <div>
                          <b>₹{inr(totalSales)}</b>
                          <span>Total Sales</span>
                        </div>
                        <div>
                          <b>{monthLabel}</b>
                          <span>Period</span>
                        </div>
                      </div>
                      <table className="rep-table">
                        <colgroup>
                          <col style={{ width: "5%" }} />
                          <col style={{ width: "13%" }} />
                          <col style={{ width: "35%" }} />
                          <col style={{ width: "17%" }} />
                          <col style={{ width: "15%" }} />
                          <col style={{ width: "15%" }} />
                        </colgroup>
                        <thead>
                          <tr>
                            <th className="c-n">#</th>
                            <th>Date</th>
                            <th>Customer / Ref</th>
                            <th>Mode</th>
                            <th className="amt">Amount ₹</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {salesBookRows.length ? (
                            salesBookRows.map((row, i) => (
                              <tr key={row.id + "-" + i}>
                                <td className="c-n">{i + 1}</td>
                                <td className="c-date">{row.date}</td>
                                <td className="c-cust">
                                  {row.customer || "—"}
                                  {row.note && <small>{row.note}</small>}
                                </td>
                                <td style={{ fontSize: 10, textTransform: "uppercase", color: "var(--ink-faint)", fontWeight: 600 }}>{row.mode}</td>
                                <td className="amt cr">₹{inr(row.amount)}</td>
                                <td></td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={6} className="rep-empty">No sales in {monthLabel}.</td>
                            </tr>
                          )}
                          <tr className="rep-tot">
                            <td colSpan={4}>Total sales</td>
                            <td className="amt cr">₹{inr(totalSales)}</td>
                            <td></td>
                          </tr>
                        </tbody>
                      </table>
                    </>
                  );
                }
                case "cash": {
                  const totalIn = cashBookRows.reduce((s, r) => s + r.credit, 0);
                  const totalOut = cashBookRows.reduce((s, r) => s + r.debit, 0);
                  const closingBal = cashBookRows.length ? cashBookRows[cashBookRows.length - 1].balance : 0;
                  return (
                    <>
                      <div className="rep-summary cols4">
                        <div>
                          <b>{cashBookRows.length}</b>
                          <span>Entries</span>
                        </div>
                        <div>
                          <b>₹{inr(totalIn)}</b>
                          <span>In</span>
                        </div>
                        <div>
                          <b>₹{inr(totalOut)}</b>
                          <span>Out</span>
                        </div>
                        <div>
                          <b>₹{inr(closingBal)}</b>
                          <span>Closing Balance</span>
                        </div>
                      </div>
                      <table className="rep-table">
                        <colgroup>
                          <col style={{ width: "5%" }} />
                          <col style={{ width: "12%" }} />
                          <col style={{ width: "35%" }} />
                          <col style={{ width: "16%" }} />
                          <col style={{ width: "16%" }} />
                          <col style={{ width: "16%" }} />
                        </colgroup>
                        <thead>
                          <tr>
                            <th className="c-n">#</th>
                            <th>Date</th>
                            <th>Particulars</th>
                            <th className="amt">Out ₹</th>
                            <th className="amt">In ₹</th>
                            <th className="amt">Balance ₹</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cashBookRows.length ? (
                            cashBookRows.map((row, i) => (
                              <tr key={row.id}>
                                <td className="c-n">{i + 1}</td>
                                <td className="c-date">{row.date}</td>
                                <td className="c-cust">
                                  {row.particulars}
                                  {row.detail && <small>{row.detail}</small>}
                                </td>
                                <td className={"amt " + (row.debit > 0 ? "dr" : "")}>{row.debit > 0 ? "₹" + inr(row.debit) : ""}</td>
                                <td className={"amt " + (row.credit > 0 ? "cr" : "")}>{row.credit > 0 ? "₹" + inr(row.credit) : ""}</td>
                                <td className="amt bal">
                                  ₹{inr(Math.abs(row.balance))}
                                  <span className={"bal-tag " + (row.balance >= 0 ? "cr" : "dr")}>{row.balance >= 0 ? "Cr" : "Dr"}</span>
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={6} className="rep-empty">No cash movements in {monthLabel}.</td>
                            </tr>
                          )}
                          <tr className="rep-tot">
                            <td colSpan={3}>Net cash movement</td>
                            <td className="amt dr">₹{inr(totalOut)}</td>
                            <td className="amt cr">₹{inr(totalIn)}</td>
                            <td className={"amt " + (closingBal >= 0 ? "ok" : "due")}>₹{inr(Math.abs(closingBal))}</td>
                          </tr>
                        </tbody>
                      </table>
                    </>
                  );
                }
                case "expenses": {
                  return (
                    <>
                      <div className="rep-summary cols3">
                        <div>
                          <b>₹{inr(spends.total)}</b>
                          <span>Total Spent</span>
                        </div>
                        <div>
                          <b>₹{inr(directCosts.total)}</b>
                          <span>Direct Costs</span>
                        </div>
                        <div>
                          <b>₹{inr(indirectCosts.total)}</b>
                          <span>Indirect Costs</span>
                        </div>
                      </div>
                      <table className="rep-table">
                        <colgroup>
                          <col style={{ width: "50%" }} />
                          <col style={{ width: "25%" }} />
                          <col style={{ width: "25%" }} />
                        </colgroup>
                        <thead>
                          <tr>
                            <th>Category</th>
                            <th className="amt">Amount ₹</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr style={{ fontWeight: 700, background: "var(--panel-2)" }}>
                            <td>Direct (Trading)</td>
                            <td className="amt">₹{inr(directCosts.total)}</td>
                            <td></td>
                          </tr>
                          {directCosts.byLabel.size === 0 ? (
                            <tr>
                              <td colSpan={2} style={{ paddingLeft: "24px" }}>None</td>
                              <td></td>
                            </tr>
                          ) : (
                            [...directCosts.byLabel.entries()].sort((a, b) => b[1] - a[1]).map(([l, amt]) => (
                              <tr key={l} style={{ paddingLeft: "24px" }}>
                                <td>{l}</td>
                                <td className="amt due">₹{inr(amt)}</td>
                                <td></td>
                              </tr>
                            ))
                          )}
                          <tr style={{ fontWeight: 700, background: "var(--panel-2)" }}>
                            <td>Indirect (Overheads)</td>
                            <td className="amt">₹{inr(indirectCosts.total)}</td>
                            <td></td>
                          </tr>
                          {[...spends.byCat.entries()].filter(([k]) => k === "salary" || k === "food").sort((a, b) => b[1].amount - a[1].amount).map(([k, g]) => (
                            <tr key={k} style={{ paddingLeft: "24px" }}>
                              <td>{g.label}</td>
                              <td className="amt due">₹{inr(g.amount)}</td>
                              <td></td>
                            </tr>
                          ))}
                          <tr className="rep-tot">
                            <td>Total spent</td>
                            <td className="amt due">₹{inr(spends.total)}</td>
                            <td></td>
                          </tr>
                        </tbody>
                      </table>
                    </>
                  );
                }
                default:
                  return null;
              }
            })()}

        <div className="rep-foot">Generated {genOn} · {brand.name}</div>
      </div>
    </div>
  );
}
