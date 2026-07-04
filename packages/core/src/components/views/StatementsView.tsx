"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec } from "@/lib/db";
import { inr } from "@/lib/calc";
import { quoteLedger } from "@/lib/payments";
import { USERS } from "@/lib/local-auth";
import { useApp } from "@/store/useApp";
import type { Doc, Expense } from "@/lib/types";

const userName = (id: string) => USERS.find((u) => u.id === id)?.name || id || "—";
const hhmm = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(+d) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

export default function StatementsView() {
  const { ready, dataVersion } = useApp();
  const router = useRouter();
  const [quotes, setQuotes] = useState<Doc[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [q, setQ] = useState("");
  const [onlyPaid, setOnlyPaid] = useState(false);

  const load = useCallback(() => {
    Promise.all([allRec<Doc>("quotations"), allRec<Expense>("expenses")]).then(([qs, es]) => {
      setQuotes(qs);
      setExpenses(es);
    });
  }, []);
  useEffect(() => {
    if (ready) load();
  }, [ready, dataVersion, load]);

  const { quotes: rows, quoteCount, payCount, totalReceived } = quoteLedger(quotes, expenses);
  const term = q.trim().toLowerCase();
  const shown = rows
    .filter((r) => (onlyPaid ? r.statements.length > 0 : true))
    .filter((r) =>
      term ? r.number.toLowerCase().includes(term) || r.name.toLowerCase().includes(term) || r.phone.includes(term) : true,
    );

  return (
    <div>
      <div className="sectitle">
        Statements <small>— every payment, per quotation</small>
      </div>

      {/* overall summary */}
      <div className="pay-hero">
        <div className="ph-main">
          <span className="ph-k">Payments recorded</span>
          <span className="ph-v">{payCount}</span>
          <span className="ph-sub">
            across {quoteCount} {quoteCount === 1 ? "quotation" : "quotations"} · ₹{inr(totalReceived)} received
          </span>
        </div>
        <div className="ph-side">
          <div className="ph-tile rec">
            <small>Received</small>
            <b>₹ {inr(totalReceived)}</b>
          </div>
          <div className="ph-tile">
            <small>Quotations</small>
            <b>{quoteCount}</b>
          </div>
        </div>
      </div>

      <div className="searchbar" style={{ marginTop: 16 }}>
        <span className="s-ic">⌕</span>
        <input placeholder="Search a quote by number, customer or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
        {q && (
          <button className="s-clear" onClick={() => setQ("")} title="Clear">
            ×
          </button>
        )}
        <span className="s-count">{shown.length}</span>
      </div>
      <label className="modal-field" style={{ flexDirection: "row", alignItems: "center", gap: 8, margin: "8px 2px 0" }}>
        <input type="checkbox" checked={onlyPaid} onChange={(e) => setOnlyPaid(e.target.checked)} style={{ width: "auto" }} />
        <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>Only quotations with a payment</span>
      </label>

      {shown.length === 0 ? (
        <div className="listwrap" style={{ marginTop: 12 }}>
          <div className="empty">
            <div className="empty-icon">{!rows.length ? "🧾" : "🔍"}</div>
            <div className="empty-title">{!rows.length ? "No created quotations yet" : "No match"}</div>
            <div className="empty-note">
              {!rows.length
                ? "Create a quote and record a payment — each quotation's statement shows up here."
                : "No quotation matches your search or filter."}
            </div>
          </div>
        </div>
      ) : (
        shown.map((r) => (
          <div className="panel-card" key={r.id} style={{ marginTop: 12 }}>
            <div
              className="pc-head"
              onClick={() => router.push("/editor/" + r.id)}
              style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}
              title="Open quotation"
            >
              <span>
                #{r.number} · {r.name}
              </span>
              <small style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400, color: "var(--ink-faint)" }}>
                {r.date}
                {r.phone ? " · " + r.phone : ""}
              </small>
              <span
                style={{
                  marginLeft: "auto",
                  fontFamily: "var(--mono)",
                  fontWeight: 700,
                  color: r.balance <= 0.5 ? "var(--green)" : "var(--danger)",
                }}
              >
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
                  <div className="stmt" key={s.id}>
                    <div className={"stmt-ic " + (s.mode === "upi" ? "upi" : "cash")}>{s.mode === "upi" ? "UPI" : "₹"}</div>
                    <div className="stmt-main">
                      <div className="stmt-to">{s.mode === "upi" ? s.account || "UPI account" : "Cash in hand"}</div>
                      <div className="stmt-sub">
                        {s.mode === "upi" ? "UPI" : "Cash"} · {s.date}
                        {hhmm(s.at) ? " · " + hhmm(s.at) : ""} · by {userName(s.by)}
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
    </div>
  );
}
