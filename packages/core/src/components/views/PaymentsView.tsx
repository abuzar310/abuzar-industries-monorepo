"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec } from "@/lib/db";
import { inr } from "@/lib/calc";
import { partyLedger } from "@/lib/payments";
import { USERS } from "@/lib/local-auth";
import { useApp } from "@/store/useApp";
import type { Doc, Expense } from "@/lib/types";

const userName = (id: string) => USERS.find((u) => u.id === id)?.name || id || "—";
const hhmm = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(+d) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

export default function PaymentsView() {
  const { ready, dataVersion } = useApp();
  const router = useRouter();
  const [quotes, setQuotes] = useState<Doc[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(() => {
    Promise.all([allRec<Doc>("quotations"), allRec<Expense>("expenses")]).then(([qs, es]) => {
      setQuotes(qs);
      setExpenses(es);
    });
  }, []);
  useEffect(() => {
    if (ready) load();
  }, [ready, dataVersion, load]);

  const { parties, totalBilled, totalPaid, totalPending } = partyLedger(quotes, expenses);
  const dueCount = parties.filter((p) => p.balance > 0.5).length;
  const term = q.trim().toLowerCase();
  const shown = term ? parties.filter((p) => p.name.toLowerCase().includes(term) || p.phone.includes(term)) : parties;

  return (
    <div>
      <div className="sectitle">
        Payments <small>— party balances &amp; statements</small>
      </div>

      {/* overall tracker */}
      <div className="dash-grid g3" style={{ marginTop: 8 }}>
        <div className="stat">
          <div className="k">Total Pending</div>
          <div className="v" style={{ color: totalPending > 0.5 ? "var(--danger)" : "var(--green)" }}>₹ {inr(totalPending)}</div>
          <div className="sub">{dueCount} {dueCount === 1 ? "party owes" : "parties owe"}</div>
        </div>
        <div className="stat">
          <div className="k">Total Billed</div>
          <div className="v">₹ {inr(totalBilled)}</div>
        </div>
        <div className="stat">
          <div className="k">Total Received</div>
          <div className="v money">₹ {inr(totalPaid)}</div>
        </div>
      </div>

      {parties.length > 6 && (
        <div className="searchbar">
          <span className="s-ic">⌕</span>
          <input placeholder="Search a party by name or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && (
            <button className="s-clear" onClick={() => setQ("")} title="Clear">
              ×
            </button>
          )}
          <span className="s-count">{shown.length}</span>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="listwrap" style={{ marginTop: 16 }}>
          <div className="empty">
            <div className="empty-icon">💰</div>
            <div className="empty-title">{parties.length ? "No match" : "No billed quotes yet"}</div>
            <div className="empty-note">Create a quote and record a payment — balances and statements show up here.</div>
          </div>
        </div>
      ) : (
        shown.map((p) => {
          const pid = p.custId || p.name;
          const isOpen = open === pid;
          const settled = p.balance <= 0.5;
          const advance = p.balance < -0.5;
          return (
            <div className="panel-card" key={pid} style={{ marginTop: 12 }}>
              <div
                className="pc-head"
                style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8, cursor: "pointer", textTransform: "none", letterSpacing: 0 }}
                onClick={() => setOpen(isOpen ? null : pid)}
              >
                <span style={{ fontSize: 15 }}>
                  <span className="um-caret" style={{ marginRight: 7 }}>{isOpen ? "▾" : "▸"}</span>
                  {p.name}
                  {p.phone && <small style={{ color: "var(--ink-faint)", marginLeft: 8, fontFamily: "var(--mono)" }}>{p.phone}</small>}
                </span>
                <span
                  style={{
                    fontFamily: "var(--mono)", fontSize: 13, fontWeight: 700,
                    color: advance ? "var(--blue)" : settled ? "var(--green)" : "var(--danger)",
                  }}
                >
                  {advance ? "Advance ₹" + inr(-p.balance) : settled ? "Settled ✓" : "Due ₹" + inr(p.balance)}
                </span>
              </div>

              {isOpen && (
                <>
                  <div className="dash-grid" style={{ margin: "10px 14px" }}>
                    <div className="stat">
                      <div className="k">Billed</div>
                      <div className="v">₹ {inr(p.billed)}</div>
                      <div className="sub">{p.quoteCount} {p.quoteCount === 1 ? "quote" : "quotes"}</div>
                    </div>
                    <div className="stat">
                      <div className="k">Paid</div>
                      <div className="v money">₹ {inr(p.paid)}</div>
                      <div className="sub">Cash ₹{inr(p.cashPaid)} · UPI ₹{inr(p.upiPaid)}</div>
                    </div>
                    <div className="stat">
                      <div className="k">Balance</div>
                      <div className="v" style={{ color: settled ? "var(--green)" : "var(--danger)" }}>₹ {inr(p.balance)}</div>
                    </div>
                    <div className="stat">
                      <div className="k">Statements</div>
                      <div className="v">{p.statements.length}</div>
                    </div>
                  </div>

                  {/* payment statements */}
                  {p.statements.length > 0 && (
                    <>
                      <div className="pc-sub">Payments received</div>
                      {p.statements.map((s) => (
                        <div className="exprow" key={s.id}>
                          <span className={"exptag " + (s.mode === "upi" ? "in" : "")}>{s.mode === "upi" ? "UPI" : "CASH"}</span>
                          <span className="expnote">
                            {s.mode === "upi" ? s.account || "—" : "Cash in hand"}
                            <small>
                              {s.quoteNo ? "#" + s.quoteNo + " · " : ""}
                              {s.date}
                              {hhmm(s.at) ? " " + hhmm(s.at) : ""} · by {userName(s.by)}
                            </small>
                          </span>
                          <span className="expamt in">+₹ {inr(s.amount)}</span>
                        </div>
                      ))}
                    </>
                  )}

                  {/* the quotes making up the bill (tap to open + record more) */}
                  <div className="pc-sub">Quotes</div>
                  {p.quotes.map((qd) => (
                    <div className="exprow" key={qd.id} style={{ cursor: "pointer" }} onClick={() => router.push("/editor/" + qd.id)}>
                      <span className="exptag">#{qd.number}</span>
                      <span className="expnote">
                        Bill ₹{inr(qd.bill)}
                        <small>Paid ₹{inr(qd.paid)} · {qd.balance <= 0.5 ? "settled" : "balance ₹" + inr(qd.balance)}</small>
                      </span>
                      <span className="expamt" style={{ color: qd.balance <= 0.5 ? "var(--green)" : "var(--danger)" }}>
                        {qd.balance <= 0.5 ? "✓" : "₹ " + inr(qd.balance)}
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
