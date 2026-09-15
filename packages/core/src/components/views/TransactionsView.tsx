"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchAllTransactions, txnHref, type AllTransaction } from "@/lib/data";
import { clockOf, inr } from "@/lib/calc";
import { useApp } from "@/store/useApp";
import Pager from "@/components/Pager";
import { TabIcon } from "@/components/Icons";

const TXNS_PAGE_SIZE = 100;

const MONTHS: [string, string][] = [
  ["01", "Jan"], ["02", "Feb"], ["03", "Mar"], ["04", "Apr"], ["05", "May"], ["06", "Jun"],
  ["07", "Jul"], ["08", "Aug"], ["09", "Sep"], ["10", "Oct"], ["11", "Nov"], ["12", "Dec"],
];

const TYPE_LABELS: Record<string, string> = {
  expense: "Expense",
  receipt: "Receipt",
  salary: "Salary",
  session_handover: "Handover",
  payment: "Wage",
  advance: "Advance",
  deduction: "Cut",
  repayment: "Repaid",
  receipt_charge: "Due",
};

export default function TransactionsView() {
  const { dataVersion, user, cloakMoney } = useApp();
  const router = useRouter();
  const [txnsRaw, setTxns] = useState<AllTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [totalRaw, setTotal] = useState(0);
  const txns = cloakMoney ? [] : txnsRaw;
  const total = cloakMoney ? 0 : totalRaw;

  // Filters
  const [typeFilter, setTypeFilter] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetchAllTransactions(TXNS_PAGE_SIZE, page * TXNS_PAGE_SIZE, typeFilter)
      .then((r) => {
        if (!live) return;
        setTxns(r.transactions);
        setTotal(r.total);
        setLoading(false);
      })
      .catch(() => {
        if (!live) return;
        setLoading(false);
      });
    return () => { live = false; };
  }, [dataVersion, page, typeFilter]);

  const totalPages = Math.ceil(total / TXNS_PAGE_SIZE) || 1;

  // Client-side filters
  const filtered = useMemo(() => {
    let list = txns;
    if (month) {
      list = list.filter((t) => {
        const [, mm = ""] = (t.date || "").split("-");
        return mm === month;
      });
    }
    if (year) {
      list = list.filter((t) => {
        const [, , yy = ""] = (t.date || "").split("-");
        return "20" + yy === year;
      });
    }
    if (!showDeleted) {
      list = list.filter((t) => !t.deleted);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          (t.party || "").toLowerCase().includes(q) ||
          (t.note || "").toLowerCase().includes(q) ||
          (t.id || "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [txns, month, year, showDeleted, search]);

  // Gather available years from data
  const years = useMemo(() => {
    const set = new Set<string>();
    txns.forEach((t) => {
      const [, , yy = ""] = (t.date || "").split("-");
      if (yy) set.add("20" + yy);
    });
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [txns]);

  const isInflow = (t: AllTransaction) =>
    t.type === "receipt" || t.type === "repayment" || t.type === "payment";

  return (
    <div className="ph-kit">
      <div className="sectitle">
        <span className="phone-ico ph-only"><TabIcon icon="transactions" size={18} /></span>
        Transactions <small><span className="desk-only">— </span>all money movement in one place</small>
      </div>

      {/* Filters bar */}
      <div className="stmt-filters" style={{ marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
        <select
          className="paysel"
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
          aria-label="Filter by type"
        >
          <option value="">All types</option>
          <option value="receipt">Receipts</option>
          <option value="expense">Expenses</option>
          <option value="salary">Salaries</option>
          <option value="payment">Wages</option>
          <option value="advance">Advances</option>
          <option value="deduction">Deductions</option>
          <option value="repayment">Repayments</option>
          <option value="session_handover">Handovers</option>
          <option value="receipt_charge">Dues</option>
        </select>

        <select className="paysel" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Filter by month">
          <option value="">All months</option>
          {MONTHS.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>

        <select className="paysel" value={year} onChange={(e) => setYear(e.target.value)} aria-label="Filter by year">
          <option value="">All years</option>
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>

        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showDeleted}
            onChange={(e) => setShowDeleted(e.target.checked)}
          />
          Show deleted
        </label>

        <input
          className="paysel txn-search"
          type="text"
          placeholder="Search party or note…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {(month || year || typeFilter || showDeleted || search) && (
          <button
            type="button"
            className="stmt-clear"
            onClick={() => { setMonth(""); setYear(""); setTypeFilter(""); setShowDeleted(false); setSearch(""); }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Summary bar */}
      <div className="panel-card" style={{ marginBottom: 8, padding: "8px 14px", display: "flex", gap: 24, flexWrap: "wrap", fontSize: 12 }}>
        <span>Total: <strong>{total}</strong> transactions</span>
        <span>Showing: <strong>{filtered.length}</strong></span>
        <span>
          Inflow: <strong style={{ color: "var(--green)" }}>₹{inr(filtered.filter(isInflow).reduce((s, t) => s + t.amount, 0))}</strong>
        </span>
        <span>
          Outflow: <strong style={{ color: "var(--danger)" }}>₹{inr(filtered.filter((t) => !isInflow(t)).reduce((s, t) => s + t.amount, 0))}</strong>
        </span>
      </div>

      {/* Transactions table */}
      <div className="panel-card" style={{ padding: 0 }}>
        {loading ? (
          <div className="empty" style={{ textAlign: "center", padding: 32 }}>
            Loading transactions…
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">📭</div>
            <div className="empty-title">No transactions match</div>
            <div className="empty-note">Adjust your filters or create a receipt, expense, or daybook entry</div>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="dash-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--t-cream2)", borderBottom: "1px solid var(--line)" }}>
                  <th style={thS}>Date / time</th>
                  <th style={thS}>Type</th>
                  <th style={thS}>Party</th>
                  <th style={{ ...thS, textAlign: "right" }}>Amount</th>
                  <th style={thS}>Mode</th>
                  <th style={thS}>Note</th>
                  <th style={thS}>By</th>
                  <th style={{ ...thS, textAlign: "center" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => {
                  const isIn = isInflow(t);
                  return (
                    <tr
                      key={t.id}
                      style={{
                        borderBottom: "1px solid var(--line)",
                        background: t.deleted ? "rgba(220,53,69,0.04)" : "transparent",
                        opacity: t.deleted ? 0.7 : 1,
                        cursor: "pointer",
                      }}
                      onClick={() => router.push(txnHref(t))}
                      title="Open where this was recorded"
                    >
                      <td style={{ padding: "7px 10px", fontFamily: "var(--mono)", fontSize: 11, color: t.deleted ? "var(--ink-faint)" : "inherit" }}>
                        {t.date}
                        {clockOf(t.createdAt) ? <div className="sub">{clockOf(t.createdAt)}</div> : null}
                      </td>
                      <td style={{ padding: "7px 10px" }}>
                    <span className={"txn-badge " + t.type}>
                      {TYPE_LABELS[t.type] || t.type}
                    </span>
                  </td>
                      <td style={{ padding: "7px 10px", color: t.deleted ? "var(--ink-faint)" : "inherit" }}>
                        <div style={{ fontWeight: 600 }}>{t.party || "—"}</div>
                        {t.partyType && (
                          <div className="sub" style={{ fontSize: 10, color: "var(--ink-faint)" }}>
                            {t.partyType}
                          </div>
                        )}
                      </td>
                      <td style={{
                        padding: "7px 10px",
                        textAlign: "right",
                        fontFamily: "var(--mono)",
                        fontSize: 12,
                        fontWeight: 700,
                        color: t.deleted ? "var(--ink-faint)" : isIn ? "var(--green)" : "var(--danger)",
                      }}>
                        {isIn ? "+" : "−"}₹{inr(t.amount)}
                      </td>
                      <td style={{ padding: "7px 10px", fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-faint)" }}>
                        {t.mode || "—"}
                      </td>
                      <td style={{
                        padding: "7px 10px",
                        color: t.deleted ? "var(--ink-faint)" : "inherit",
                        maxWidth: 240,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}>
                        {t.note || "—"}
                      </td>
                      <td style={{ padding: "7px 10px", fontFamily: "var(--disp)", fontSize: 10, color: "var(--ink-faint)" }}>
                        {t.enteredBy || "—"}
                      </td>
                      <td style={{ padding: "7px 10px", textAlign: "center" }}>
                        {t.deleted ? (
                          <span style={{ color: "var(--danger)", fontSize: 11, fontWeight: 700 }}>DELETED</span>
                        ) : (
                          <span style={{ color: "var(--green)", fontSize: 11, fontWeight: 700 }}>LIVE</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <Pager page={page} pages={totalPages} total={total} onPage={setPage} />
      </div>
    </div>
  );
}

const thS: React.CSSProperties = {
  padding: "6px 10px",
  textAlign: "left",
  fontFamily: "var(--disp)",
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: ".09em",
  textTransform: "uppercase",
  color: "var(--ink-faint)",
};
