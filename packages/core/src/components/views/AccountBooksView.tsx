"use client";
// Accounts (official app): the CASH book and one statement per BANK — every rupee's
// movement date-wise with a running balance. Receipts, payment vouchers, contra
// deposits/withdrawals and journal transfers all land here automatically.
import { useCallback, useEffect, useRef, useState } from "react";
import { allRec } from "@/lib/data";
import { dateSortKey, inr } from "@/lib/calc";
import { allExpenses } from "@/lib/expenses";
import { brandFor } from "@/lib/brand";
import { generatePdf, printOrSavePdf } from "@/lib/pdf";
import { bankBook, cashBook, getBankAccounts, type BookEntry } from "@/lib/vouchers";
import { USERS } from "@/lib/local-auth";
import { useApp } from "@/store/useApp";
import { toast } from "@/store/app-store";
import type { Doc, Expense } from "@/lib/types";

const r2 = (n: number) => Math.round(n * 100) / 100;
const userName = (id: string) => USERS.find((u) => u.id === id)?.name || id || "—";
const pad2 = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) => d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
const toDmy = (v: string) => {
  const [y, m, d] = (v || "").split("-");
  return d && m && y ? `${d}-${m}-${y.slice(2)}` : "";
};

interface Row extends BookEntry {
  bal: number;
}

export default function AccountBooksView() {
  const { ready, dataVersion, brandMode } = useApp();
  const [seg, setSeg] = useState<"cash" | "banks">("cash");
  const [bank, setBank] = useState("");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [invoices, setInvoices] = useState<Doc[]>([]);
  const [banks, setBanks] = useState<string[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const printRef = useRef<HTMLDivElement>(null);

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
  const activeBank = bank || banks[0] || "";
  const bookName = seg === "cash" ? "Cash book" : activeBank || "Bank book";

  // full book (oldest first) → running balance over EVERYTHING, then the date filter
  // only narrows what's DISPLAYED — balances stay true to the whole history
  const bookEntries = seg === "cash" ? cashBook(expenses, invById) : bankBook(expenses, invById, activeBank);
  const fullRows = bookEntries.reduce<{ rows: Row[]; bal: number }>(
    (acc, be) => {
      const bal = r2(acc.bal + (be.in ? +be.e.amount || 0 : -(+be.e.amount || 0)));
      return { rows: [...acc.rows, { ...be, bal }], bal };
    },
    { rows: [], bal: 0 },
  ).rows;

  const inRange = (e: Expense) => {
    const k = dateSortKey(e.date) || "";
    if (from && k < from) return false;
    if (to && k > to) return false;
    return true;
  };
  const rows = fullRows.filter(
    (r) => inRange(r.e) && (!q.trim() || (r.what + " " + (r.e.note || "") + " " + (r.e.label || "")).toLowerCase().includes(q.trim().toLowerCase())),
  );
  const totIn = r2(rows.filter((r) => r.in).reduce((s, r) => s + (+r.e.amount || 0), 0));
  const totOut = r2(rows.filter((r) => !r.in).reduce((s, r) => s + (+r.e.amount || 0), 0));
  const closing = fullRows.length ? fullRows[fullRows.length - 1].bal : 0;
  const shownClosing = rows.length ? rows[rows.length - 1].bal : closing;

  // screen: newest day first, running balance under each amount
  const dayMap = new Map<string, Row[]>();
  for (const r of rows) {
    const arr = dayMap.get(r.e.date) || [];
    arr.push(r);
    dayMap.set(r.e.date, arr);
  }
  const dayGroups = [...dayMap.entries()]
    .map(([date, list]) => ({
      date,
      in: r2(list.filter((x) => x.in).reduce((s, x) => s + (+x.e.amount || 0), 0)),
      out: r2(list.filter((x) => !x.in).reduce((s, x) => s + (+x.e.amount || 0), 0)),
      // newest first inside the day
      list: [...list].reverse(),
    }))
    .sort((a, b) => (dateSortKey(b.date) || "").localeCompare(dateSortKey(a.date) || ""));

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

  return (
    <div>
      <div className="cd-screen">
      <div className="sectitle" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span>Accounts <small>— cash &amp; bank books, every movement</small></span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button
            className="btn primary sm"
            onClick={async () => {
              if ((await printOrSavePdf(printRef.current, bookName.replace(/\s+/g, "-").toLowerCase() + "-" + genOn)) === "pdf") toast("PDF downloaded ✓");
            }}
          >
            Print
          </button>
          <button
            className="btn sm"
            onClick={async () => {
              toast("Preparing PDF…");
              await generatePdf(printRef.current!, bookName.replace(/\s+/g, "-").toLowerCase() + "-" + genOn);
              toast("PDF downloaded ✓");
            }}
          >
            Save PDF
          </button>
        </div>
      </div>

      <div className="db-seg" style={{ marginBottom: 12 }}>
        <button className={"seg-btn" + (seg === "cash" ? " on" : "")} type="button" onClick={() => setSeg("cash")}>
          Cash
        </button>
        <button className={"seg-btn" + (seg === "banks" ? " on" : "")} type="button" onClick={() => setSeg("banks")}>
          Banks
        </button>
        {seg === "banks" && (
          <select className="pb-sel" value={activeBank} onChange={(e) => setBank(e.target.value)} style={{ marginLeft: 10, minWidth: 170 }}>
            {banks.length === 0 && <option value="">— no banks yet —</option>}
            {banks.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        )}
      </div>

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
            Search
            <input type="text" placeholder="customer / payee / note…" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="dash-grid" style={{ marginBottom: 12 }}>
        <div className="stat">
          <div className="k">In</div>
          <div className="v" style={{ color: "var(--green)" }}>₹ {inr(totIn)}</div>
          <div className="sub">{periodLabel}</div>
        </div>
        <div className="stat">
          <div className="k">Out</div>
          <div className="v" style={{ color: "var(--danger)" }}>₹ {inr(totOut)}</div>
          <div className="sub">{periodLabel}</div>
        </div>
        <div className="stat">
          <div className="k">{bookName} balance</div>
          <div className="v money">₹ {inr(closing)}</div>
          <div className="sub">as of today (all time)</div>
        </div>
      </div>

      <div className="panel-card" style={{ padding: "0 0 4px" }}>
        {dayGroups.length ? (
          dayGroups.map((g) => (
            <div className="db-day" key={g.date}>
              <div className="db-day-head">
                <span className="db-day-date">{g.date}</span>
                <span className="db-day-mini">
                  {g.in > 0 ? "in ₹" + inr(g.in) : ""}
                  {g.in > 0 && g.out > 0 ? " · " : ""}
                  {g.out > 0 ? "out ₹" + inr(g.out) : ""}
                </span>
              </div>
              {g.list.map((r) => (
                <div className="stmt" key={r.e.id}>
                  <div className={"stmt-ic " + (r.in ? "cash" : "due")}>{r.in ? "+" : "−"}</div>
                  <div className="stmt-main">
                    <div className="stmt-to">{r.what}</div>
                    <div className="stmt-sub">
                      {(r.e.note && r.what.indexOf(r.e.note) === -1 ? r.e.note + " · " : "")}by {userName(r.e.enteredBy)}
                    </div>
                  </div>
                  <div className="cs-amt">
                    <div className={"stmt-amt" + (r.in ? "" : " due")}>{r.in ? "+" : "−"}₹{inr(r.e.amount)}</div>
                    <small className="cs-runbal">bal ₹{inr(r.bal)}</small>
                  </div>
                </div>
              ))}
            </div>
          ))
        ) : (
          <div className="empty">
            <div className="empty-title">No movements{from || to || q ? " in this filter" : " yet"}</div>
            <div className="empty-note">
              {seg === "cash"
                ? "Cash receipts, cash payment vouchers and contra deposits/withdrawals appear here."
                : "Receipts into this bank, payments from it, contra and journal transfers appear here."}
            </div>
          </div>
        )}
      </div>
      </div>

      {/* ---- printable book (matches the filters) ---- */}
      <div className="cd-print rep-doc" ref={printRef}>
        <div className="rep-head">
          <div className="rep-brand">
            <h1>{brand.name || "Accounts"}</h1>
            {brand.addr && <div>{brand.addr}</div>}
            {brand.gstin && <div>GSTIN: {brand.gstin}</div>}
          </div>
          <div className="rep-meta">
            <div className="rep-title">{bookName}</div>
            <div className="rep-period">{periodLabel}</div>
          </div>
        </div>

        <div className="rep-summary cols4">
          <div><b>{rows.length}</b><span>Entries</span></div>
          <div><b>₹{inr(totIn)}</b><span>In</span></div>
          <div><b>₹{inr(totOut)}</b><span>Out</span></div>
          <div><b>₹{inr(shownClosing)}</b><span>Closing balance</span></div>
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
              <th className="amt">In ₹</th>
              <th className="amt">Out ₹</th>
              <th className="amt">Balance ₹</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.e.id}>
                <td className="c-n">{i + 1}</td>
                <td className="c-date">{r.e.date}</td>
                <td className="c-cust">{r.what}{r.e.note && r.what.indexOf(r.e.note) === -1 ? " · " + r.e.note : ""}</td>
                <td className="amt">{r.in ? inr(r.e.amount) : ""}</td>
                <td className="amt">{r.in ? "" : inr(r.e.amount)}</td>
                <td className="amt">{inr(r.bal)}</td>
              </tr>
            ))}
            <tr className="rep-tot">
              <td colSpan={3}>Total</td>
              <td className="amt">{inr(totIn)}</td>
              <td className="amt">{inr(totOut)}</td>
              <td className="amt">{inr(shownClosing)}</td>
            </tr>
          </tbody>
        </table>

        <div className="rep-foot">Generated {genOn} · {brand.name}</div>
      </div>
    </div>
  );
}
