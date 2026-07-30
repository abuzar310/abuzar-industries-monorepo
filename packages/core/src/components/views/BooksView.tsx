"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { allRec } from "@/lib/data";
import { inr } from "@/lib/calc";
import { inDaybook, isInflow, openingCarry, typeLabel } from "@/lib/expenses";
import { partyLedger, quoteBill } from "@/lib/payments";
import { acctLedger, listCollections, listHolders, type AccountCollection, type PayHolder } from "@/lib/accounts";
import { listAttendance, listWorkers, workerAccount, type AttendanceMark, type Worker } from "@/lib/attendance";
import { USERS } from "@/lib/local-auth";
import { useApp } from "@/store/useApp";
import type { Customer, Doc, Expense } from "@/lib/types";

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
  d.status === "Created" || (+(d.payCash || 0)) > 0 || (+(d.payUpi || 0)) > 0 || (+(d.amountPaid || 0)) > 0;

export default function BooksView() {
  const { ready, dataVersion } = useApp();
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, "0"));
  const [year, setYear] = useState(String(now.getFullYear()).slice(2));

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [quotes, setQuotes] = useState<Doc[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [collections, setCollections] = useState<AccountCollection[]>([]);
  const [holders, setHolders] = useState<PayHolder[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [marks, setMarks] = useState<AttendanceMark[]>([]);
  const [carry, setCarry] = useState(0);

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
  const monthExp = useMemo(() => expenses.filter((e) => inMonth(e.date)), [expenses, month, year]); // eslint-disable-line react-hooks/exhaustive-deps

  const income = useMemo(() => {
    const sales = monthExp.filter((e) => e.type === "sale" && !e.charge);
    const cash = r2(sales.filter((e) => e.mode !== "upi").reduce((s, e) => s + (+e.amount || 0), 0));
    const upi = r2(sales.filter((e) => e.mode === "upi").reduce((s, e) => s + (+e.amount || 0), 0));
    return { cash, upi, total: r2(cash + upi), count: sales.length };
  }, [monthExp]);

  const spends = useMemo(() => {
    const outs = monthExp.filter((e) => !isInflow(e.type) && !e.charge);
    const byType = new Map<string, { amount: number; count: number }>();
    for (const e of outs) {
      const g = byType.get(e.type) || { amount: 0, count: 0 };
      g.amount = r2(g.amount + (+e.amount || 0));
      g.count++;
      byType.set(e.type, g);
    }
    const total = r2(outs.reduce((s, e) => s + (+e.amount || 0), 0));
    return { byType, total, count: outs.length };
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

  const net = r2(income.total - spends.total);

  // ── month ledger: every money event chronologically with a running net ────
  const monthRows = useMemo(() => {
    const rows = monthExp
      .filter((e) => !e.charge) // charges move no cash
      .map((e) => {
        const inflow = isInflow(e.type);
        const what = inflow
          ? (e.custId ? "Received" : "Sale") + (e.mode === "upi" ? " · UPI" + (e.account ? " · " + e.account : "") : " · Cash") + (e.toOwner ? " → Owner" : "")
          : typeLabel(e.type) + (e.label ? " · " + e.label : "");
        return {
          id: e.id,
          date: e.date,
          at: e.createdAt || "",
          particulars: what,
          detail: [e.note, "by " + userName(e.enteredBy)].filter(Boolean).join(" · "),
          debit: inflow ? 0 : +e.amount || 0, // money out
          credit: inflow ? +e.amount || 0 : 0, // money in
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
  }, [monthExp]);

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
    const upiWithHolders = r2(acctBal + holderOpen - holderCols);

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
  const step = (dir: -1 | 1) => {
    let m = parseInt(month, 10) + dir;
    let y = parseInt(year, 10);
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    setMonth(String(m).padStart(2, "0"));
    setYear(String(y).padStart(2, "0"));
  };

  return (
    <div className="ledger-page">
      <div className="sectitle">
        Books <small>— monthly income &amp; expense · assets &amp; liabilities</small>
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

      {/* monthly P&L cards */}
      <div className="party-grid">
        <div className="party-card">
          <div className="party-stat-label">Income · {monthLabel}</div>
          <div className="party-stat-value ok">₹ {inr(income.total)}</div>
          <div className="party-stat-sub">{income.count} receipts · cash ₹{inr(income.cash)} · UPI ₹{inr(income.upi)}</div>
        </div>
        <div className="party-card">
          <div className="party-stat-label">Expenses · {monthLabel}</div>
          <div className="party-stat-value due">₹ {inr(spends.total)}</div>
          <div className="party-stat-sub">{spends.count} entries across {spends.byType.size} categories</div>
        </div>
        <div className="party-card hero">
          <div className="party-stat-label">Net · {monthLabel}</div>
          <div className={"party-stat-value " + (net >= 0 ? "ok" : "due")}>{net < 0 ? "−" : ""}₹ {inr(Math.abs(net))}</div>
          <div className="party-stat-sub">{net >= 0 ? "surplus this month" : "deficit this month"}</div>
        </div>
      </div>

      {/* income / expense breakdown */}
      <div className="books-grid">
        <div className="party-card">
          <div className="party-stat-label" style={{ marginBottom: 10 }}>Income breakdown</div>
          <div className="books-row"><span>Cash received</span><b className="ok">₹{inr(income.cash)}</b></div>
          <div className="books-row"><span>UPI received</span><b className="ok">₹{inr(income.upi)}</b></div>
          {billedMonth > 0 && <div className="books-row"><span>Billed (quotes of {monthLabel})</span><b>₹{inr(billedMonth)}</b></div>}
          {duesAdded > 0 && <div className="books-row"><span>Dues added (no cash)</span><b className="due">₹{inr(duesAdded)}</b></div>}
          <div className="books-row books-total"><span>Total income</span><b className="ok">₹{inr(income.total)}</b></div>
        </div>
        <div className="party-card">
          <div className="party-stat-label" style={{ marginBottom: 10 }}>Expense breakdown</div>
          {spends.byType.size === 0 && <div className="books-row"><span>No expenses this month</span><b>—</b></div>}
          {[...spends.byType.entries()].sort((a, b) => b[1].amount - a[1].amount).map(([t, g]) => (
            <div className="books-row" key={t}>
              <span>{typeLabel(t as Expense["type"])} <small>· {g.count}</small></span>
              <b className="due">₹{inr(g.amount)}</b>
            </div>
          ))}
          <div className="books-row books-total"><span>Total expenses</span><b className="due">₹{inr(spends.total)}</b></div>
        </div>
      </div>

      {/* every money event of the month — bank-format with running net */}
      <div className="panel-card" style={{ marginTop: 18 }}>
        <div className="pc-head" style={{ justifyContent: "space-between" }}>
          <span>Month ledger · {monthRows.length} {monthRows.length === 1 ? "entry" : "entries"}</span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 12, textTransform: "none", letterSpacing: 0 }}>
            in ₹{inr(income.total)} · out ₹{inr(spends.total)}
          </span>
        </div>
        {monthRows.length ? (
          <div className="bank-ledger" style={{ margin: "10px 12px 12px" }}>
            <div className="bank-hdr">
              <span>Date</span>
              <span>Particulars</span>
              <span className="bank-amt">Out ₹</span>
              <span className="bank-amt">In ₹</span>
              <span className="bank-amt">Net</span>
            </div>
            {monthRows.map((row) => (
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
              <span className="bank-date"></span>
              <span className="bank-parts">Net for {monthLabel}</span>
              <span className="bank-amt dr">₹{inr(spends.total)}</span>
              <span className="bank-amt cr">₹{inr(income.total)}</span>
              <span className={"bank-amt bal " + (net >= 0 ? "ok" : "due")}>₹{inr(Math.abs(net))}</span>
            </div>
          </div>
        ) : (
          <div className="stmt-sub" style={{ padding: "10px 16px", opacity: 0.7 }}>No money moved in {monthLabel}.</div>
        )}
      </div>

      {/* assets & liabilities — live snapshot */}
      <div className="sectitle" style={{ marginTop: 28, fontSize: 22 }}>
        Assets &amp; Liabilities <small>— as of today, from every tab</small>
      </div>
      <div className="books-grid">
        <div className="party-card">
          <div className="party-stat-label" style={{ marginBottom: 10 }}>Assets — what the business holds</div>
          <div className="books-row"><span>Cash in hand <small>· Daybook</small></span><b>₹{inr(snapshot.cashInHand)}</b></div>
          <div className="books-row"><span>UPI with holders <small>· Accounts</small></span><b>₹{inr(snapshot.upiWithHolders)}</b></div>
          <div className="books-row"><span>Customer dues <small>· Balances</small></span><b>₹{inr(snapshot.receivables)}</b></div>
          <div className="books-row"><span>Worker advances <small>· Attendance</small></span><b>₹{inr(snapshot.workerAdvances)}</b></div>
          <div className="books-row books-total"><span>Total assets</span><b className="ok">₹{inr(snapshot.assets)}</b></div>
        </div>
        <div className="party-card">
          <div className="party-stat-label" style={{ marginBottom: 10 }}>Liabilities — what the business owes</div>
          <div className="books-row"><span>Unpaid wages <small>· Attendance</small></span><b>₹{inr(snapshot.unpaidWages)}</b></div>
          <div className="books-row"><span>Customer advances <small>· Balances</small></span><b>₹{inr(snapshot.custAdvances)}</b></div>
          <div className="books-row books-total"><span>Total liabilities</span><b className="due">₹{inr(snapshot.liabilities)}</b></div>
          <div className="books-row books-total" style={{ marginTop: 8 }}>
            <span>Net position</span>
            <b className={snapshot.position >= 0 ? "ok" : "due"}>{snapshot.position < 0 ? "−" : ""}₹{inr(Math.abs(snapshot.position))}</b>
          </div>
        </div>
      </div>
    </div>
  );
}
