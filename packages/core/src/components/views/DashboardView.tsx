"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec } from "@/lib/db";
import { computeDoc, inr, pad, todayStr } from "@/lib/calc";
import { dayTotals } from "@/lib/expenses";
import { useApp } from "@/store/useApp";
import type { Doc, Expense, Stock } from "@/lib/types";
import { StatusBadge } from "./DocList";

export default function DashboardView() {
  const { dataVersion, user } = useApp();
  const router = useRouter();
  const [quotes, setQuotes] = useState<Doc[]>([]);
  const [invs, setInvs] = useState<Doc[]>([]);
  const [stk, setStk] = useState<Stock[]>([]);
  const [exp, setExp] = useState<Expense[]>([]);

  useEffect(() => {
    let live = true;
    Promise.all([
      allRec<Doc>("quotations"),
      allRec<Doc>("invoices"),
      allRec<Stock>("stock"),
      allRec<Expense>("expenses"),
    ]).then(([q, i, s, e]) => {
      if (!live) return;
      setQuotes(q);
      setInvs(i);
      setStk(s);
      setExp(e);
    });
    return () => {
      live = false;
    };
  }, [dataVersion]);

  const today = todayStr();
  const todayBook = dayTotals(exp.filter((e) => e.date === today));

  const now = new Date();
  const ym = now.getFullYear() + "-" + pad(now.getMonth() + 1);
  let monthRev = 0;
  const receivables = invs
    .map((i) => ({ i, bal: Math.round((computeDoc(i).grand - (+i.amountPaid || 0)) * 100) / 100 }))
    .filter((r) => r.bal > 0.001)
    .sort((a, b) => b.bal - a.bal);
  invs.forEach((i) => {
    if ((i.createdAt || "").slice(0, 7) === ym) monthRev += computeDoc(i).grand;
  });
  const outstanding = receivables.reduce((s, r) => s + r.bal, 0);
  const follow = quotes.filter((q) => q.status === "Follow-up Pending");
  const lowStock = stk.filter((s) => (+s.cft || 0) <= 0);

  const todayCards = [
    { k: "Cash In", v: "₹ " + inr(todayBook.cashIn), money: true },
    { k: "UPI In", v: "₹ " + inr(todayBook.upiIn), money: true },
    { k: "Spent", v: "₹ " + inr(todayBook.spent), danger: todayBook.spent > 0 },
    { k: "Net Today", v: "₹ " + inr(todayBook.net), tone: todayBook.net < 0 ? "danger" : "good" },
  ];
  const overviewCards = [
    { k: "This Month Sales", v: "₹ " + inr(monthRev), money: true, sub: ym, onClick: () => router.push("/invoices") },
    { k: "Outstanding", v: "₹ " + inr(outstanding), danger: outstanding > 0, sub: receivables.length + " invoice(s)" },
    { k: "Follow-ups", v: String(follow.length), sub: "to chase", onClick: () => router.push("/quotations") },
    { k: "Low Stock", v: String(lowStock.length), danger: lowStock.length > 0, sub: "wood type(s)", onClick: () => router.push("/stock") },
  ];

  return (
    <div>
      <div className="sectitle">
        Dashboard <small>{user ? `— welcome, ${user.name}` : "— business at a glance"}</small>
      </div>

      <div className="dash-section">
        Today <span>· {today}</span>
        <button className="dash-link" onClick={() => router.push("/expenses")}>
          Open Daybook →
        </button>
      </div>
      <div className="dash-grid">
        {todayCards.map((c) => (
          <div className="stat" key={c.k}>
            <div className="k">{c.k}</div>
            <div
              className={"v" + (c.money ? " money" : "")}
              style={c.danger ? { color: "var(--danger)" } : c.tone === "good" ? { color: "var(--green)" } : c.tone === "danger" ? { color: "var(--danger)" } : undefined}
            >
              {c.v}
            </div>
          </div>
        ))}
      </div>

      <div className="dash-section" style={{ marginTop: 22 }}>
        Overview
      </div>
      <div className="dash-grid">
        {overviewCards.map((c) => (
          <div
            className="stat"
            key={c.k}
            onClick={c.onClick}
            style={c.onClick ? { cursor: "pointer" } : undefined}
          >
            <div className="k">{c.k}</div>
            <div className={"v" + (c.money ? " money" : "")} style={c.danger ? { color: "var(--danger)" } : undefined}>
              {c.v}
            </div>
            {c.sub && <div className="sub">{c.sub}</div>}
          </div>
        ))}
      </div>

      <div className="panel-card">
        <div className="pc-head">Outstanding Payments</div>
        {receivables.length ? (
          receivables.slice(0, 6).map(({ i, bal }) => (
            <div className="lrow" key={i.id} style={{ cursor: "pointer" }} onClick={() => router.push("/editor/" + i.id)}>
              <span className="id">{i.id}</span>
              <span className="nm">{i.customerName || "—"}</span>
              <span className="mut">{i.phone}</span>
              <span className="mut col-date">{i.date}</span>
              <span className="col-status">
                <StatusBadge doc={i} />
              </span>
              <span className="amt" style={{ color: "var(--danger)" }}>
                ₹ {inr(bal)}
              </span>
            </div>
          ))
        ) : (
          <div className="empty">All invoices settled. ✓</div>
        )}
      </div>

      <div className="panel-card">
        <div className="pc-head">Pending Follow-ups</div>
        {follow.length ? (
          follow.map((q) => (
            <div className="lrow" key={q.id} style={{ cursor: "pointer" }} onClick={() => router.push("/editor/" + q.id)}>
              <span className="id">{q.id}</span>
              <span className="nm">{q.customerName || "—"}</span>
              <span className="mut">{q.phone}</span>
              <span className="mut col-date">{q.date}</span>
              <span className="col-status">
                <StatusBadge doc={q} />
              </span>
              <span className="amt">₹ {inr(computeDoc(q).grand)}</span>
            </div>
          ))
        ) : (
          <div className="empty">No pending follow-ups. 🎉</div>
        )}
      </div>
    </div>
  );
}
