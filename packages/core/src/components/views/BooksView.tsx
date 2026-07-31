"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { allRec } from "@/lib/data";
import { inr } from "@/lib/calc";
import { inDaybook, isInflow, openingCarry, spendCategoryOf, spendCatKey, spendDetailOf, SPEND_CATEGORIES } from "@/lib/expenses";
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
          ? (e.custId ? "Received" : "Sale") + (e.mode === "upi" ? " · UPI" : " · Cash") + (e.toOwner ? " → Owner" : "")
          : spendCategoryOf(e);
        const detailBits = inflow
          ? [e.account ? "acct " + e.account : "", e.note, "by " + userName(e.enteredBy)].filter(Boolean)
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
    setLedCat("all");
    setLedFrom("");
    setLedTo("");
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
          <div className="party-stat-sub">
            {income.count} receipts · cash ₹{inr(income.cash)} · UPI ₹{inr(income.upi)}
            {income.upi > 0 ? ` (owner ₹${inr(income.upiOwner)} · other ₹${inr(income.upiOther)})` : ""}
          </div>
        </div>
        <div className="party-card">
          <div className="party-stat-label">Expenses · {monthLabel}</div>
          <div className="party-stat-value due">₹ {inr(spends.total)}</div>
          <div className="party-stat-sub">{spends.count} entries across {spends.byCat.size} categories</div>
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
          <div className="books-row"><span>UPI received by owner</span><b className="ok">₹{inr(income.upiOwner)}</b></div>
          <div className="books-row"><span>UPI others</span><b className="ok">₹{inr(income.upiOther)}</b></div>
          {billedMonth > 0 && <div className="books-row"><span>Billed (quotes of {monthLabel})</span><b>₹{inr(billedMonth)}</b></div>}
          {duesAdded > 0 && <div className="books-row"><span>Dues added (no cash)</span><b className="due">₹{inr(duesAdded)}</b></div>}
          <div className="books-row books-total"><span>Total income</span><b className="ok">₹{inr(income.total)}</b></div>
        </div>
        <div className="party-card">
          <div className="party-stat-label" style={{ marginBottom: 10 }}>Expense breakdown</div>
          {spends.byCat.size === 0 && <div className="books-row"><span>No expenses this month</span><b>—</b></div>}
          {SPEND_CATEGORIES.filter((c) => spends.byCat.has(c.id))
            .sort((a, b) => (spends.byCat.get(b.id)!.amount - spends.byCat.get(a.id)!.amount))
            .map((c) => {
              const g = spends.byCat.get(c.id)!;
              return (
                <div className="books-row" key={c.id}>
                  <span>{c.label} <small>· {g.count}</small></span>
                  <b className="due">₹{inr(g.amount)}</b>
                </div>
              );
            })}
          <div className="books-row books-total"><span>Total expenses</span><b className="due">₹{inr(spends.total)}</b></div>
        </div>
      </div>

      {/* every money event of the month — bank-format with running net */}
      <div className="panel-card" style={{ marginTop: 18 }}>
        <div className="pc-head" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <span>Month ledger · {monthRows.length} {monthRows.length === 1 ? "entry" : "entries"}</span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 12, textTransform: "none", letterSpacing: 0 }}>
            in ₹{inr(ledIn)} · out ₹{inr(ledOut)}
          </span>
        </div>
        <div
          className="books-led-filters"
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
        {monthRows.length ? (
          <div className="bank-ledger" style={{ margin: "0 12px 12px" }}>
            <div className="bank-hdr">
              <span>Date</span>
              <span>Particulars</span>
              <span className="bank-amt">Out ₹</span>
              <span className="bank-amt">In ₹</span>
              <span className="bank-amt">Net</span>
            </div>
            {monthRows.map((row) => {
              // Net Cr/Dr = running balance (surplus Cr, deficit Dr)
              const balDr = row.balance < -0.005;
              // Line tag: money-out = Dr, money-in = Cr
              const lineDr = row.debit > 0.005;
              return (
              <div className="bank-row" key={row.id}>
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
              <span className="bank-parts">{ledFiltered ? "Filtered net" : "Net for " + monthLabel}</span>
              <span className="bank-amt dr">₹{inr(ledOut)}</span>
              <span className="bank-amt cr">₹{inr(ledIn)}</span>
              <span className={"bank-amt bal" + (ledNet < -0.005 ? " dr" : " cr")}>
                ₹{inr(Math.abs(ledNet))}
                <span className={"bal-tag " + (ledNet < -0.005 ? "dr" : "cr")}>{ledNet < -0.005 ? "Dr" : "Cr"}</span>
              </span>
            </div>
          </div>
        ) : (
          <div className="stmt-sub" style={{ padding: "10px 16px", opacity: 0.7 }}>
            {ledFiltered ? "No entries match these filters." : "No money moved in " + monthLabel + "."}
          </div>
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
