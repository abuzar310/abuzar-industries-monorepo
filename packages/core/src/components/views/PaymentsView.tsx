"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec } from "@/lib/db";
import { inr } from "@/lib/calc";
import { partyLedger, type Party } from "@/lib/payments";
import { USERS } from "@/lib/local-auth";
import { useApp } from "@/store/useApp";
import type { Doc, Expense } from "@/lib/types";

const userName = (id: string) => USERS.find((u) => u.id === id)?.name || id || "—";
const hhmm = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(+d) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};
const pct = (paid: number, billed: number) => (billed <= 0 ? 0 : Math.max(0, Math.min(100, (paid / billed) * 100)));

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
  // only parties who still owe — settled / advance parties are hidden
  const shown = parties
    .filter((p) => p.balance > 0.5)
    .filter((p) => (term ? p.name.toLowerCase().includes(term) || p.phone.includes(term) : true));

  const balClass = (b: number) => (b < -0.5 ? "adv" : b <= 0.5 ? "ok" : "due");
  const balText = (b: number) => (b < -0.5 ? "₹" + inr(-b) : b <= 0.5 ? "Settled" : "₹" + inr(b));
  const balLbl = (b: number) => (b < -0.5 ? "advance" : b <= 0.5 ? "✓ clear" : "due");

  return (
    <div>
      <div className="sectitle">
        Balances <small>— who still owes</small>
      </div>

      {/* overall tracker */}
      <div className="pay-hero">
        <div className="ph-main">
          <span className="ph-k">Total Pending</span>
          <span className="ph-v">₹ {inr(totalPending)}</span>
          <span className="ph-sub">
            {dueCount} {dueCount === 1 ? "party still owes" : "parties still owe"} · ₹{inr(totalPaid)} of ₹{inr(totalBilled)} collected
          </span>
        </div>
        <div className="ph-side">
          <div className="ph-tile rec">
            <small>Received</small>
            <b>₹ {inr(totalPaid)}</b>
          </div>
          <div className="ph-tile">
            <small>Billed</small>
            <b>₹ {inr(totalBilled)}</b>
          </div>
        </div>
      </div>

      {/* search — only shown when someone still owes */}
      {dueCount > 0 && (
        <div className="searchbar" style={{ marginTop: 16 }}>
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
        <div className="listwrap" style={{ marginTop: 12 }}>
          <div className="empty">
            <div className="empty-icon">{!parties.length ? "💰" : dueCount ? "🔍" : "🎉"}</div>
            <div className="empty-title">{!parties.length ? "No billed quotes yet" : dueCount ? "No match" : "All settled"}</div>
            <div className="empty-note">
              {!parties.length
                ? "Create a quote and record a payment — balances show up here."
                : dueCount
                  ? "No outstanding party matches your search."
                  : "Everyone has paid up. Parties appear here only while they still owe."}
            </div>
          </div>
        </div>
      ) : (
        shown.map((p) => <PartyCard key={p.custId || p.name} p={p} open={open} setOpen={setOpen} router={router} balClass={balClass} balText={balText} balLbl={balLbl} />)
      )}
    </div>
  );
}

function PartyCard({
  p,
  open,
  setOpen,
  router,
  balClass,
  balText,
  balLbl,
}: {
  p: Party;
  open: string | null;
  setOpen: (v: string | null) => void;
  router: ReturnType<typeof useRouter>;
  balClass: (b: number) => string;
  balText: (b: number) => string;
  balLbl: (b: number) => string;
}) {
  const pid = p.custId || p.name;
  const isOpen = open === pid;
  const settled = p.balance <= 0.5;
  const bc = balClass(p.balance);
  return (
    <div>
      <button className={"party" + (isOpen ? " on" : "")} onClick={() => setOpen(isOpen ? null : pid)}>
        <div className={"pty-av" + (settled ? " ok" : "")}>{(p.name || "?").charAt(0).toUpperCase()}</div>
        <div className="pty-main">
          <div className="pty-name">
            {p.name}
            {p.phone && <small>{p.phone}</small>}
          </div>
          <div className="pty-bar">
            <i style={{ width: pct(p.paid, p.billed) + "%" }} />
          </div>
          <div className="pty-meta">
            Paid ₹{inr(p.paid)} of ₹{inr(p.billed)} · {p.quoteCount} {p.quoteCount === 1 ? "quote" : "quotes"}
          </div>
        </div>
        <div className={"pty-bal " + bc}>
          {balText(p.balance)}
          <small>{balLbl(p.balance)}</small>
        </div>
      </button>

      {isOpen && (
        <div className="party-body">
          <div className="pbd-stats">
            <div className="st">
              <div className="k">Billed</div>
              <div className="v">₹{inr(p.billed)}</div>
            </div>
            <div className="st">
              <div className="k">Paid</div>
              <div className="v rec">₹{inr(p.paid)}</div>
              <small>Cash ₹{inr(p.cashPaid)} · UPI ₹{inr(p.upiPaid)}</small>
            </div>
            <div className="st">
              <div className="k">Balance</div>
              <div className={"v " + (settled ? "ok" : "due")}>₹{inr(p.balance)}</div>
            </div>
          </div>

          {p.statements.length > 0 && (
            <>
              <div className="pbd-lbl">Payments received · {p.statements.length}</div>
              {p.statements.map((s) => (
                <div className="stmt" key={s.id}>
                  <div className={"stmt-ic " + (s.mode === "upi" ? "upi" : "cash")}>{s.mode === "upi" ? "UPI" : "₹"}</div>
                  <div className="stmt-main">
                    <div className="stmt-to">{s.mode === "upi" ? s.account || "UPI account" : "Cash in hand"}</div>
                    <div className="stmt-sub">
                      {s.quoteNo ? "#" + s.quoteNo + " · " : ""}
                      {s.date}
                      {hhmm(s.at) ? " · " + hhmm(s.at) : ""} · by {userName(s.by)}
                    </div>
                  </div>
                  <div className="stmt-amt">+₹{inr(s.amount)}</div>
                </div>
              ))}
            </>
          )}

          <div className="pbd-lbl">Quotes · tap to open &amp; record</div>
          {p.quotes.map((qd) => {
            const qsettled = qd.balance <= 0.5;
            return (
              <div className="pbd-q" key={qd.id} onClick={() => router.push("/editor/" + qd.id)}>
                <span className="no">#{qd.number}</span>
                <span className="info">
                  Bill ₹{inr(qd.bill)} · paid ₹{inr(qd.paid)}
                </span>
                <span className="bal" style={{ color: qsettled ? "var(--green)" : "var(--danger)" }}>
                  {qsettled ? "✓ clear" : "₹" + inr(qd.balance)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
