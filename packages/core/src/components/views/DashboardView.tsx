"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec } from "@/lib/db";
import { computeDoc, inr } from "@/lib/calc";
import { partyLedger, quoteBill } from "@/lib/payments";
import { computeTrading, docTrade, getStockConfig } from "@/lib/trading";
import { getFeatures } from "@/lib/features";
import { useApp } from "@/store/useApp";
import type { Customer, Doc, Expense, Stock } from "@/lib/types";
import { StatusBadge } from "./DocList";

const MONTHS: [string, string][] = [
  ["01", "Jan"], ["02", "Feb"], ["03", "Mar"], ["04", "Apr"], ["05", "May"], ["06", "Jun"],
  ["07", "Jul"], ["08", "Aug"], ["09", "Sep"], ["10", "Oct"], ["11", "Nov"], ["12", "Dec"],
];

export default function DashboardView() {
  const { dataVersion, user } = useApp();
  const router = useRouter();
  const [quotes, setQuotes] = useState<Doc[]>([]);
  const [invs, setInvs] = useState<Doc[]>([]);
  const [stk, setStk] = useState<Stock[]>([]);
  const [exp, setExp] = useState<Expense[]>([]);
  const [custs, setCusts] = useState<Customer[]>([]);
  const [stockCfg, setStockCfg] = useState({ value: 0, cft: 0, closingCft: null as number | null });
  const [month, setMonth] = useState(""); // "" = all months
  const [year, setYear] = useState(""); // "" = all years

  useEffect(() => {
    let live = true;
    Promise.all([
      allRec<Doc>("quotations"),
      allRec<Doc>("invoices"),
      allRec<Stock>("stock"),
      allRec<Expense>("expenses"),
      allRec<Customer>("customers"),
      getStockConfig(),
    ]).then(([q, i, s, e, c, cfg]) => {
      if (!live) return;
      setQuotes(q);
      setInvs(i);
      setStk(s);
      setExp(e);
      setCusts(c);
      setStockCfg(cfg);
    });
    return () => {
      live = false;
    };
  }, [dataVersion]);

  const feat = getFeatures();

  // period filter over createdAt (ISO "YYYY-MM-…")
  const inPeriod = (createdAt?: string) => {
    const d = createdAt || "";
    if (year && d.slice(0, 4) !== year) return false;
    if (month && d.slice(5, 7) !== month) return false;
    return true;
  };
  const years = useMemo(() => {
    const set = new Set<string>();
    [...quotes, ...invs].forEach((d) => {
      const y = (d.createdAt || "").slice(0, 4);
      if (y) set.add(y);
    });
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [quotes, invs]);
  const monthName = month ? MONTHS.find((m) => m[0] === month)?.[1] : "";
  const periodLabel = !month && !year ? "all time" : [monthName, year].filter(Boolean).join(" ");

  // period sales / count / CFT — Cut Size uses created quotes (no invoices); official uses invoices
  let periodRev = 0;
  let periodCft = 0;
  let periodCount = 0;
  if (feat.simpleQuote) {
    quotes.forEach((qd) => {
      if (qd.status !== "Created" || qd.deletedAt || qd.purgedAt || !inPeriod(qd.createdAt)) return;
      periodRev += quoteBill(qd);
      periodCft += computeDoc(qd).secCft.reduce((s, c) => s + c, 0);
      periodCount++;
    });
  } else {
    invs.forEach((i) => {
      if (i.deletedAt || i.purgedAt || !inPeriod(i.createdAt)) return;
      periodRev += computeDoc(i).grand;
      periodCount++;
    });
  }
  periodRev = Math.round(periodRev * 100) / 100;
  periodCft = Math.round(periodCft * 100) / 100;

  // stock snapshot (all-time): opening + purchases − sold = closing (same as the Stock tab)
  const tr = useMemo(
    () => computeTrading(invs.map(docTrade), { value: stockCfg.value, cft: stockCfg.cft }, stockCfg.closingCft),
    [invs, stockCfg],
  );

  // running (not period-scoped) balances
  const ledger = feat.acceptPayment ? partyLedger(quotes, exp, custs) : null;
  const totalOutstanding = ledger ? ledger.totalPending : 0;
  const dueCount = ledger ? ledger.parties.filter((p) => p.balance > 0.5).length : 0;
  const follow = quotes.filter((q) => q.status === "Follow-up Pending" && !q.deletedAt && !q.purgedAt);
  const lowStock = stk.filter((s) => (+s.cft || 0) <= 0);

  // mini statements: the latest few payments received (full list lives in the Statements tab)
  const quoteById = new Map(quotes.map((q) => [q.id, q] as const));
  const recentPays = exp
    .filter((e) => e.type === "sale" && !!e.sourceId)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    .slice(0, 5);

  type Card = { k: string; v: string; money?: boolean; danger?: boolean; sub?: string; onClick?: () => void };
  const cards: Card[] = [
    { k: "Sales", v: "₹ " + inr(periodRev), money: true, sub: periodLabel, onClick: () => router.push(feat.simpleQuote ? "/quotations" : "/invoices") },
    { k: feat.simpleQuote ? "Quotes" : "Invoices", v: String(periodCount), sub: periodLabel, onClick: () => router.push(feat.simpleQuote ? "/quotations" : "/invoices") },
    ...(feat.simpleQuote ? [{ k: "CFT Sold", v: periodCft.toFixed(2), sub: periodLabel, onClick: () => router.push("/quotations") }] : []),
    ...(!feat.simpleQuote ? [{ k: "CFT Sold", v: tr.saleCft.toFixed(2), sub: "₹ " + inr(tr.saleValue) + " · overall", onClick: () => router.push("/stock") }] : []),
    ...(!feat.simpleQuote ? [{ k: "Closing Stock", v: tr.closingCft.toFixed(2), sub: "₹ " + inr(tr.closingValue) + " · overall", onClick: () => router.push("/stock") }] : []),
    ...(feat.acceptPayment ? [{ k: "Outstanding", v: "₹ " + inr(totalOutstanding), money: true, sub: dueCount ? `${dueCount} ${dueCount === 1 ? "party owes" : "parties owe"} · overall` : "all clear", onClick: () => router.push("/payments") }] : []),
    ...(!feat.simpleQuote ? [{ k: "Follow-ups", v: String(follow.length), sub: "to chase", onClick: () => router.push("/quotations") }] : []),
    ...(!feat.simpleQuote ? [{ k: "Low Stock", v: String(lowStock.length), danger: lowStock.length > 0, sub: "wood type(s)", onClick: () => router.push("/stock") }] : []),
  ];

  return (
    <div>
      <div className="sectitle">
        Dashboard <small>{user ? `— welcome, ${user.name}` : "— business at a glance"}</small>
      </div>

      <div className="dash-section" style={{ marginTop: 6 }}>
        Overview <span>· {periodLabel}</span>
      </div>
      <div className="stmt-filters" style={{ marginBottom: 6 }}>
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
        {(month || year) && (
          <button type="button" className="stmt-clear" onClick={() => { setMonth(""); setYear(""); }}>
            Clear
          </button>
        )}
      </div>

      <div className="dash-grid">
        {cards.map((c) => (
          <div className="stat" key={c.k} onClick={c.onClick} style={{ cursor: "pointer" }}>
            <div className="k">{c.k}</div>
            <div className={"v" + (c.money ? " money" : "")} style={c.danger ? { color: "var(--danger)" } : undefined}>
              {c.v}
            </div>
            {c.sub && <div className="sub">{c.sub}</div>}
          </div>
        ))}
      </div>

      {feat.acceptPayment && (
        <>
          <div className="dash-section" style={{ marginTop: 22 }}>
            Statements
            <button className="dash-link" onClick={() => router.push("/statements")}>View all →</button>
          </div>
          <div className="panel-card">
            {recentPays.length ? (
              recentPays.map((e) => (
                <div className="stmt" key={e.id}>
                  <div className={"stmt-ic " + (e.mode === "upi" ? "upi" : "cash")}>{e.mode === "upi" ? "UPI" : "₹"}</div>
                  <div className="stmt-main">
                    <div className="stmt-to">{quoteById.get(e.sourceId || "")?.customerName || "Payment"}</div>
                    <div className="stmt-sub">
                      {e.mode === "upi" ? e.account || "UPI" : e.toOwner ? "Cash → Owner" : "Cash"} · {e.date}
                    </div>
                  </div>
                  <div className="stmt-amt">+₹{inr(e.amount)}</div>
                </div>
              ))
            ) : (
              <div className="empty">No payments recorded yet.</div>
            )}
          </div>
        </>
      )}

      {!feat.simpleQuote && (
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
      )}
    </div>
  );
}
