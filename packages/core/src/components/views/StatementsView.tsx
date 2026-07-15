"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec } from "@/lib/data";
import { inr } from "@/lib/calc";
import { quoteLedger } from "@/lib/payments";
import { brandFor } from "@/lib/brand";
import { USERS } from "@/lib/local-auth";
import { useApp } from "@/store/useApp";
import type { Customer, Doc, Expense } from "@/lib/types";

const userName = (id: string) => USERS.find((u) => u.id === id)?.name || id || "—";
const hhmm = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(+d) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};
// dd-mm-yy → month / 2-digit-year parts
const parts = (d: string) => {
  const [, mm = "", yy = ""] = (d || "").split("-");
  return { mm, yy };
};
const MONTHS: [string, string][] = [
  ["01", "Jan"], ["02", "Feb"], ["03", "Mar"], ["04", "Apr"], ["05", "May"], ["06", "Jun"],
  ["07", "Jul"], ["08", "Aug"], ["09", "Sep"], ["10", "Oct"], ["11", "Nov"], ["12", "Dec"],
];

export default function StatementsView() {
  const { ready, dataVersion, brandMode } = useApp();
  const brand = brandFor(brandMode);
  const router = useRouter();
  const [quotes, setQuotes] = useState<Doc[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [custs, setCusts] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [onlyPaid, setOnlyPaid] = useState(false);

  const load = useCallback(() => {
    Promise.all([allRec<Doc>("quotations"), allRec<Expense>("expenses"), allRec<Customer>("customers")]).then(([qs, es, cs]) => {
      setQuotes(qs);
      setExpenses(es);
      setCusts(cs);
    });
  }, []);
  useEffect(() => {
    if (ready) load();
  }, [ready, dataVersion, load]);

  const { quotes: rows } = quoteLedger(quotes, expenses);
  const years = [...new Set(rows.map((r) => parts(r.date).yy).filter(Boolean))].sort((a, b) => b.localeCompare(a));
  const term = q.trim().toLowerCase();
  const shown = rows.filter((r) => {
    const { mm, yy } = parts(r.date);
    if (month && mm !== month) return false;
    if (year && yy !== year) return false;
    if (onlyPaid && r.statements.length === 0) return false;
    if (term && !(r.number.toLowerCase().includes(term) || r.name.toLowerCase().includes(term) || r.phone.includes(term)))
      return false;
    return true;
  });
  // summary reflects the active filter, so the numbers always match what's on screen
  const shownReceived = shown.reduce((s, r) => s + r.statements.reduce((t, x) => t + x.amount, 0), 0);
  const shownPayCount = shown.reduce((s, r) => s + r.statements.length, 0);
  // direct receipts/dues (Receipts tab: credited/debited to a customer, no quote) — respect the same filters
  const custName = (id?: string) => custs.find((c) => c.id === id)?.name || "—";
  const directFilter = (e: Expense) => {
    const { mm, yy } = parts(e.date);
    if (month && mm !== month) return false;
    if (year && yy !== year) return false;
    if (term && !custName(e.custId).toLowerCase().includes(term)) return false;
    return true;
  };
  const direct = expenses
    .filter((e) => e.type === "sale" && !!e.custId)
    .filter(directFilter)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const receipts = direct.filter((e) => !e.charge);
  const dues = direct.filter((e) => e.charge);
  // headline "Received" = quote payments + direct receipts, so it reconciles with the Balances tab
  // (which counts both). Direct receipts are still listed separately below.
  const directReceived = receipts.reduce((s, e) => s + (+e.amount || 0), 0);
  const totalReceived = shownReceived + directReceived;
  const totalPayCount = shownPayCount + receipts.length;
  const filtered = !!(month || year || onlyPaid || term);
  const clearAll = () => {
    setQ("");
    setMonth("");
    setYear("");
    setOnlyPaid(false);
  };

  // ---- printable statement (reflects the active filter) ----
  const monthLabel = month ? MONTHS.find(([v]) => v === month)?.[1] || month : "";
  const periodLabel = [monthLabel, year ? "20" + year : ""].filter(Boolean).join(" ") || "All time";
  const filterNote = [onlyPaid ? "With payment only" : "", term ? `\u201C${q.trim()}\u201D` : ""].filter(Boolean).join(" · ");
  const tBilled = shown.reduce((s, r) => s + r.bill, 0);
  const tPaid = shown.reduce((s, r) => s + r.paid, 0);
  const tBal = shown.reduce((s, r) => s + r.balance, 0);
  const duesTotal = dues.reduce((s, e) => s + (+e.amount || 0), 0);
  const gToday = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  const genOn = `${p2(gToday.getDate())}-${p2(gToday.getMonth() + 1)}-${gToday.getFullYear()}`;

  return (
    <div>
      <div className="cd-screen">
      <div className="sectitle" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span>Statements <small>— every payment, per quotation</small></span>
        <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => window.print()}>
          Print / Save PDF
        </button>
      </div>

      {/* summary — tracks the current filter */}
      <div className="pay-hero">
        <div className="ph-main">
          <span className="ph-k">Payments recorded</span>
          <span className="ph-v">{totalPayCount}</span>
          <span className="ph-sub">
            across {shown.length} {shown.length === 1 ? "quotation" : "quotations"}
            {receipts.length > 0 ? " + " + receipts.length + " direct" : ""} · ₹{inr(totalReceived)} received
            {filtered ? " · filtered" : ""}
          </span>
        </div>
        <div className="ph-side">
          <div className="ph-tile rec">
            <small>Received</small>
            <b>₹ {inr(totalReceived)}</b>
          </div>
          <div className="ph-tile">
            <small>Quotations</small>
            <b>{shown.length}</b>
          </div>
        </div>
      </div>

      {/* search */}
      <div className="searchbar" style={{ marginTop: 16 }}>
        <span className="s-ic">⌕</span>
        <input placeholder="Search by quote no., customer or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
        {q && (
          <button className="s-clear" onClick={() => setQ("")} title="Clear">
            ×
          </button>
        )}
        <span className="s-count">{shown.length}</span>
      </div>

      {/* filters — month · year · payment state */}
      <div className="stmt-filters">
        <select className="paysel" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Filter by month">
          <option value="">All months</option>
          {MONTHS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select className="paysel" value={year} onChange={(e) => setYear(e.target.value)} aria-label="Filter by year">
          <option value="">All years</option>
          {years.map((y) => (
            <option key={y} value={y}>
              20{y}
            </option>
          ))}
        </select>
        <div className="db-seg sm">
          <button type="button" className={"seg-btn" + (!onlyPaid ? " on" : "")} onClick={() => setOnlyPaid(false)}>
            All
          </button>
          <button type="button" className={"seg-btn" + (onlyPaid ? " on" : "")} onClick={() => setOnlyPaid(true)}>
            With payment
          </button>
        </div>
        {filtered && (
          <button type="button" className="stmt-clear" onClick={clearAll}>
            Clear
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="listwrap" style={{ marginTop: 12 }}>
          <div className="empty">
            <div className="empty-icon">{!rows.length ? "🧾" : "🔍"}</div>
            <div className="empty-title">{!rows.length ? "No created quotations yet" : "No match"}</div>
            <div className="empty-note">
              {!rows.length
                ? "Create a quote and record a payment — each quotation's statement shows up here."
                : "No quotation matches these filters."}
            </div>
          </div>
        </div>
      ) : (
        shown.map((r) => (
          <div className="panel-card" key={r.id} style={{ marginTop: 12 }}>
            <div className="stmt-qhead" onClick={() => router.push("/editor/" + r.id)} title="Open quotation">
              <span className="sq-no">#{r.number}</span>
              <span className="sq-name">{r.name}</span>
              <small className="sq-date">
                {r.date}
                {r.phone ? " · " + r.phone : ""}
              </small>
              <span className={"sq-bal " + (r.balance <= 0.5 ? "ok" : "due")}>
                {r.balance <= 0.5 ? "✓ clear" : "Due ₹" + inr(r.balance)}
              </span>
            </div>

            <div className="pbd-stats">
              <div className="st">
                <div className="k">Billed</div>
                <div className="v">₹{inr(r.bill)}</div>
              </div>
              <div className="st">
                <div className="k">Paid</div>
                <div className="v rec">₹{inr(r.paid)}</div>
              </div>
              <div className="st">
                <div className="k">Balance</div>
                <div className={"v " + (r.balance <= 0.5 ? "ok" : "due")}>₹{inr(r.balance)}</div>
              </div>
            </div>

            {r.statements.length > 0 ? (
              <>
                <div className="pbd-lbl">Payments received · {r.statements.length}</div>
                {r.statements.map((s) => (
                  <div
                    className="stmt"
                    key={s.id}
                    style={{ cursor: "pointer" }}
                    title={"Open #" + r.number + " at this payment"}
                    onClick={() => router.push("/editor/" + r.id + "?pay=" + encodeURIComponent(s.id))}
                  >
                    <div className={"stmt-ic " + (s.mode === "upi" ? "upi" : "cash")}>{s.mode === "upi" ? "UPI" : "₹"}</div>
                    <div className="stmt-main">
                      <div className="stmt-to">{s.mode === "upi" ? s.account || "UPI account" : s.note || "Cash in hand"}</div>
                      <div className="stmt-sub">
                        {s.mode === "upi" ? "UPI" : "Cash"} · {s.date}
                        {hhmm(s.at) ? " · " + hhmm(s.at) : ""}
                        {s.synthetic ? " · from quote record" : " · by " + userName(s.by)}
                      </div>
                    </div>
                    <div className="stmt-amt">+₹{inr(s.amount)}</div>
                  </div>
                ))}
              </>
            ) : (
              <div className="pbd-lbl" style={{ opacity: 0.7 }}>
                No payment recorded yet
              </div>
            )}
          </div>
        ))
      )}

      {receipts.length > 0 && (
        <>
          <div className="sectitle" style={{ marginTop: 24, fontSize: 22 }}>
            Direct receipts <small>— not tied to a quote · {receipts.length}</small>
          </div>
          <div className="panel-card">
            {receipts.map((e) => (
              <div className="stmt" key={e.id}>
                <div className={"stmt-ic " + (e.mode === "upi" ? "upi" : "cash")}>{e.mode === "upi" ? "UPI" : "₹"}</div>
                <div className="stmt-main">
                  <div className="stmt-to">{custName(e.custId)}</div>
                  <div className="stmt-sub">
                    {e.mode === "upi" ? e.account || "UPI" : e.account ? e.account : e.toOwner ? "Cash → Owner" : e.label || "Cash"} · {e.date}
                    {hhmm(e.createdAt) ? " · " + hhmm(e.createdAt) : ""} · by {userName(e.enteredBy)}
                  </div>
                </div>
                <div className="stmt-amt">+₹{inr(e.amount)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {dues.length > 0 && (
        <>
          <div className="sectitle" style={{ marginTop: 24, fontSize: 22 }}>
            Direct dues <small>— added from Receipts tab · {dues.length}</small>
          </div>
          <div className="panel-card">
            {dues.map((e) => (
              <div className="stmt" key={e.id}>
                <div className="stmt-ic due">Due</div>
                <div className="stmt-main">
                  <div className="stmt-to">{custName(e.custId)}</div>
                  <div className="stmt-sub">
                    {e.note || "Due added"} · {e.date}
                    {hhmm(e.createdAt) ? " · " + hhmm(e.createdAt) : ""} · by {userName(e.enteredBy)}
                  </div>
                </div>
                <div className="stmt-amt due">₹{inr(e.amount)}</div>
              </div>
            ))}
          </div>
        </>
      )}
      </div>

      {/* clean printable statement — only rendered on print, reflects the active filter */}
      <div className="cd-print rep-doc">
        <div className="rep-head">
          <div className="rep-brand">
            <h1>{brand.name || "Statements"}</h1>
            {brand.addr && <div>{brand.addr}</div>}
            {brand.gstin && <div>GSTIN: {brand.gstin}</div>}
          </div>
          <div className="rep-meta">
            <div className="rep-title">Statement</div>
            <div className="rep-period">{periodLabel}</div>
            {filterNote && <div className="rep-period">{filterNote}</div>}
          </div>
        </div>

        <div className="rep-summary cols3">
          <div><b>{shown.length}</b><span>Quotations</span></div>
          <div><b>₹{inr(totalReceived)}</b><span>Received</span></div>
          <div><b>₹{inr(tBal)}</b><span>Outstanding</span></div>
        </div>

        <table className="rep-table">
          <colgroup>
            <col style={{ width: "4%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "23%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "11%" }} />
          </colgroup>
          <thead>
            <tr>
              <th className="c-n">#</th>
              <th>Date</th>
              <th>Quote No</th>
              <th>Customer</th>
              <th>Phone</th>
              <th className="amt">Billed ₹</th>
              <th className="amt">Paid ₹</th>
              <th className="amt">Balance ₹</th>
            </tr>
          </thead>
          <tbody>
            {shown.length ? (
              <>
                {shown.map((r, i) => (
                  <tr key={r.id}>
                    <td className="c-n">{i + 1}</td>
                    <td className="c-date">{r.date}</td>
                    <td className="c-no">{r.number}</td>
                    <td className="c-cust">{r.name}</td>
                    <td className="c-no">{r.phone || "—"}</td>
                    <td className="amt">{inr(r.bill)}</td>
                    <td className="amt">{inr(r.paid)}</td>
                    <td className="amt">{inr(r.balance)}</td>
                  </tr>
                ))}
                <tr className="rep-tot">
                  <td colSpan={5}>Total — {shown.length} quotation{shown.length === 1 ? "" : "s"}</td>
                  <td className="amt">{inr(tBilled)}</td>
                  <td className="amt">{inr(tPaid)}</td>
                  <td className="amt">{inr(tBal)}</td>
                </tr>
              </>
            ) : (
              <tr>
                <td colSpan={8} className="rep-empty">No quotations match this filter.</td>
              </tr>
            )}
          </tbody>
        </table>

        {receipts.length > 0 && (
          <>
            <div className="rep-title" style={{ marginTop: 18, marginBottom: 8 }}>Direct receipts — {receipts.length}</div>
            <table className="rep-table">
              <colgroup>
                <col style={{ width: "5%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "34%" }} />
                <col style={{ width: "29%" }} />
                <col style={{ width: "18%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="c-n">#</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Via</th>
                  <th className="amt">Amount ₹</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((e, i) => (
                  <tr key={e.id}>
                    <td className="c-n">{i + 1}</td>
                    <td className="c-date">{e.date}</td>
                    <td className="c-cust">{custName(e.custId)}</td>
                    <td>{e.mode === "upi" ? e.account || "UPI" : e.account || (e.toOwner ? "Cash → Owner" : e.label || "Cash")}</td>
                    <td className="amt">{inr(+e.amount || 0)}</td>
                  </tr>
                ))}
                <tr className="rep-tot">
                  <td colSpan={4}>Total direct receipts</td>
                  <td className="amt">{inr(directReceived)}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}

        {dues.length > 0 && (
          <>
            <div className="rep-title" style={{ marginTop: 18, marginBottom: 8 }}>Direct dues — {dues.length}</div>
            <table className="rep-table">
              <colgroup>
                <col style={{ width: "5%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "34%" }} />
                <col style={{ width: "29%" }} />
                <col style={{ width: "18%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="c-n">#</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Note</th>
                  <th className="amt">Amount ₹</th>
                </tr>
              </thead>
              <tbody>
                {dues.map((e, i) => (
                  <tr key={e.id}>
                    <td className="c-n">{i + 1}</td>
                    <td className="c-date">{e.date}</td>
                    <td className="c-cust">{custName(e.custId)}</td>
                    <td>{e.note || "Due added"}</td>
                    <td className="amt">{inr(+e.amount || 0)}</td>
                  </tr>
                ))}
                <tr className="rep-tot">
                  <td colSpan={4}>Total dues</td>
                  <td className="amt">{inr(duesTotal)}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}

        <div className="rep-foot">Generated {genOn} · {brand.name}</div>
      </div>
    </div>
  );
}
