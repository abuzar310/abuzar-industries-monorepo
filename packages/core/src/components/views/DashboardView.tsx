"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec, fetchAllTransactions, type AllTransaction } from "@/lib/data";
import { computeDoc, inr, r2 } from "@/lib/calc";
import { partyLedger, quoteBill, quoteLedger } from "@/lib/payments";
import { computeTrading, docTrade, getStockConfig, type StockConfig } from "@/lib/trading";
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
  const [stockCfg, setStockCfg] = useState<StockConfig>({ value: 0, cft: 0, closingCft: null });
  const [month, setMonth] = useState(""); // "" = all months
  const [year, setYear] = useState(""); // "" = all years

  const feat = getFeatures();

  // All Transactions state
  const [allTxns, setAllTxns] = useState<AllTransaction[]>([]);
  const [txnsLoading, setTxnsLoading] = useState(false);
  const [txnsPage, setTxnsPage] = useState(0);
  const [txnsTotal, setTxnsTotal] = useState(0);
  const TXNS_PAGE_SIZE = 100;

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

  // Fetch all transactions for unified view
  useEffect(() => {
    if (!feat.acceptPayment) return; // only for unofficial app
    let live = true;
    setTxnsLoading(true);
    fetchAllTransactions(TXNS_PAGE_SIZE, txnsPage * TXNS_PAGE_SIZE).then((r) => {
      if (!live) return;
      setAllTxns(r.transactions);
      setTxnsTotal(r.total);
      setTxnsLoading(false);
    }).catch(() => {
      if (!live) return;
      setTxnsLoading(false);
    });
    return () => { live = false; };
  }, [feat.acceptPayment, dataVersion, txnsPage]);

  // period filter over createdAt (ISO "YYYY-MM-…")
  const inPeriod = (createdAt?: string) => {
    const d = createdAt || "";
    if (year && d.slice(0, 4) !== year) return false;
    if (month && d.slice(5, 7) !== month) return false;
    return true;
  };
  // period filter over a business date ("dd-mm-yy") — payments are often backdated,
  // so they're bucketed by when the money actually came in, not when it was typed
  const inPeriodDmy = (dmy?: string) => {
    const [, mm = "", yy = ""] = (dmy || "").split("-");
    if (year && "20" + yy !== year) return false;
    if (month && mm !== month) return false;
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

  // period sales / count / CFT — Cut Size uses created quotes (no invoices); official uses sell invoices
  let periodRev = 0;
  let periodPurchase = 0;
  let periodCft = 0;
  let periodBuyCft = 0;
  let periodSaleCount = 0;
  let periodBuyCount = 0;
  if (feat.simpleQuote) {
    quotes.forEach((qd) => {
      if (qd.deletedAt || qd.purgedAt || !inPeriodDmy(qd.date)) return;
      // a quote is a bill once it's Created OR once money is recorded against it (an
      // advance on a Draft) — the SAME rule as Balances/Statements, so all three agree
      const billable =
        qd.status === "Created" ||
        (+(qd.payCash || 0)) > 0 ||
        (+(qd.payUpi || 0)) > 0 ||
        (+(qd.amountPaid || 0)) > 0;
      if (!billable) return;
      periodRev += quoteBill(qd);
      periodCft += computeDoc(qd).secCft.reduce((s, c) => s + c, 0);
      periodSaleCount++;
    });
  } else {
    invs.forEach((i) => {
      if (i.deletedAt || i.purgedAt || !inPeriod(i.createdAt)) return;
      const t = docTrade(i);
      if (t.buy) {
        periodPurchase += t.grand;
        periodBuyCft += t.cft;
        periodBuyCount++;
      } else {
        periodRev += t.grand;
        periodCft += t.cft;
        periodSaleCount++;
      }
    });
  }
  periodRev = Math.round(periodRev * 100) / 100;
  periodPurchase = Math.round(periodPurchase * 100) / 100;
  periodCft = Math.round(periodCft * 100) / 100;
  periodBuyCft = Math.round(periodBuyCft * 100) / 100;

  // money ACTUALLY received in the period — the EXACT same rule as the Statements tab
  // (payments on live quotations incl. legacy on-quote amounts, + direct customer receipts),
  // so the Sales card always reconciles with Statements. Bin-quote payments and unlinked
  // daybook entries are excluded, exactly as they are there.
  let periodReceived = 0;
  let periodPayCount = 0;
  if (feat.acceptPayment) {
    for (const r of quoteLedger(quotes, exp).quotes) {
      for (const s of r.statements) {
        if (!inPeriodDmy(s.date)) continue;
        periodReceived += +s.amount || 0;
        periodPayCount++;
      }
    }
    exp.forEach((e) => {
      if (e.type !== "sale" || e.charge || !e.custId || !inPeriodDmy(e.date)) return;
      periodReceived += +e.amount || 0;
      periodPayCount++;
    });
    periodReceived = Math.round(periodReceived * 100) / 100;
  }

  // stock snapshot (all-time): opening + purchases − sold = closing (same as the Stock tab)
  const activeInvs = useMemo(
    () => invs.filter((d) => !d.deletedAt && !d.purgedAt),
    [invs],
  );
  const tr = useMemo(
    () =>
      computeTrading(activeInvs.map(docTrade), { value: stockCfg.value, cft: stockCfg.cft }, stockCfg.closingCft, {
        mode: stockCfg.gpMode === "percent" ? "percent" : "stock",
        percent: stockCfg.gpPercent ?? 10,
      }),
    [activeInvs, stockCfg],
  );

  // running (not period-scoped) balances
  const ledger = feat.acceptPayment ? partyLedger(quotes, exp, custs) : null;
  const totalOutstanding = ledger ? ledger.totalPending : 0;
  const dueCount = ledger ? ledger.parties.filter((p) => p.balance > 0.5).length : 0;
  // reconcile with the Balances tab EXACTLY: its Billed = quote bills + old opening dues +
  // directly-added dues. Split out the non-quote part so every card visibly adds up:
  //   Total billed (= Balances) − Received (= Balances collected) = Outstanding
  const allTimeQuotesBilled = feat.simpleQuote
    ? quotes.reduce((s, qd) => {
        if (qd.deletedAt || qd.purgedAt) return s;
        const billable =
          qd.status === "Created" ||
          (+(qd.payCash || 0)) > 0 ||
          (+(qd.payUpi || 0)) > 0 ||
          (+(qd.amountPaid || 0)) > 0;
        return billable ? s + quoteBill(qd) : s;
      }, 0)
    : 0;
  const oldDues = ledger ? Math.round((ledger.totalBilled - allTimeQuotesBilled) * 100) / 100 : 0;
  const follow = quotes.filter((q) => q.status === "Follow-up Pending" && !q.deletedAt && !q.purgedAt);
  const lowStock = stk.filter((s) => (+s.cft || 0) <= 0);

  // mini statements: the latest few payments received (full list lives in the Statements tab)
  const quoteById = new Map(quotes.map((q) => [q.id, q] as const));
  const recentPays = exp
    .filter((e) => e.type === "sale" && !!e.sourceId)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    .slice(0, 5);

  type Card = { k: string; v: string; money?: boolean; danger?: boolean; sub?: string; onClick?: () => void };
  const cards: Card[] = feat.simpleQuote
    ? [
        // "Sales" = money actually RECEIVED in the period; what was merely quoted is "Billed"
        ...(feat.acceptPayment
          ? [
              {
                k: "Sales (received)",
                v: "₹ " + inr(periodReceived),
                money: true,
                sub: `${periodPayCount} payment${periodPayCount === 1 ? "" : "s"} · ${periodLabel}`,
                onClick: () => router.push("/statements?focus=received"),
              },
            ]
          : []),
        {
          k: "Billed (quotes)",
          v: "₹ " + inr(periodRev),
          money: true,
          sub: `${periodSaleCount} quote${periodSaleCount === 1 ? "" : "s"} · ${periodLabel}`,
          onClick: () => router.push("/quotations"),
        },
        // the piece Balances adds on top of quotes — so Dashboard and Balances always agree:
        // Total billed − Received = Outstanding, to the paisa
        ...(feat.acceptPayment && ledger && Math.abs(oldDues) > 0.5
          ? [
              {
                k: "Old dues & charges",
                v: "₹ " + inr(oldDues),
                money: true,
                sub: "opening balances + added dues · overall",
                onClick: () => router.push("/payments?focus=billed"),
              },
              {
                k: "Total billed",
                v: "₹ " + inr(ledger.totalBilled),
                money: true,
                sub: "quotes + old dues · overall — same as Balances",
                onClick: () => router.push("/payments?focus=billed"),
              },
            ]
          : []),
        { k: "Quotes", v: String(periodSaleCount), sub: periodLabel, onClick: () => router.push("/quotations") },
        { k: "CFT Sold", v: periodCft.toFixed(2), sub: periodLabel, onClick: () => router.push("/quotations") },
        ...(feat.acceptPayment
          ? [
              {
                k: "Outstanding",
                v: "₹ " + inr(totalOutstanding),
                money: true,
                sub: dueCount ? `${dueCount} ${dueCount === 1 ? "party owes" : "parties owe"} · overall` : "all clear",
                onClick: () => router.push("/payments?focus=pending"),
              },
            ]
          : []),
      ]
    : [
        { k: "Sales", v: "₹ " + inr(periodRev), money: true, sub: `${periodSaleCount} invoice${periodSaleCount === 1 ? "" : "s"} · ${periodLabel}`, onClick: () => router.push("/invoices") },
        { k: "Purchases", v: "₹ " + inr(periodPurchase), money: true, sub: `${periodBuyCount} bill${periodBuyCount === 1 ? "" : "s"} · ${periodLabel}`, onClick: () => router.push("/invoices") },
        { k: "CFT Bought", v: periodBuyCft.toFixed(2), sub: periodLabel, onClick: () => router.push("/stock") },
        { k: "CFT Sold", v: periodCft.toFixed(2), sub: periodLabel, onClick: () => router.push("/stock") },
        { k: "Closing Stock", v: tr.closingCft.toFixed(2) + " CFT", sub: "₹ " + inr(tr.closingValue) + " · overall", onClick: () => router.push("/stock") },
        { k: "Follow-ups", v: String(follow.length), sub: "to chase", onClick: () => router.push("/quotations") },
        { k: "Low Stock", v: String(lowStock.length), danger: lowStock.length > 0, sub: "wood type(s)", onClick: () => router.push("/stock") },
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

      {!feat.simpleQuote && (
        <>
          <div className="dash-section" style={{ marginTop: 22 }}>
            Stock <span>· overall</span>
            <button className="dash-link" type="button" onClick={() => router.push("/stock")}>
              Open stock →
            </button>
          </div>
          <div className="dash-grid">
            <div className="stat" onClick={() => router.push("/stock")} style={{ cursor: "pointer" }}>
              <div className="k">Opening</div>
              <div className="v">{tr.openCft.toFixed(2)}</div>
              <div className="sub">CFT · ₹ {inr(tr.openValue)}</div>
            </div>
            <div className="stat" onClick={() => router.push("/stock")} style={{ cursor: "pointer" }}>
              <div className="k">+ Bought</div>
              <div className="v">{tr.purchaseCft.toFixed(2)}</div>
              <div className="sub">CFT · ₹ {inr(tr.purchaseTotal)}</div>
            </div>
            <div className="stat" onClick={() => router.push("/stock")} style={{ cursor: "pointer" }}>
              <div className="k">− Sold</div>
              <div className="v">{tr.saleCft.toFixed(2)}</div>
              <div className="sub">CFT · ₹ {inr(tr.saleTotal)}</div>
            </div>
            <div className="stat" onClick={() => router.push("/stock")} style={{ cursor: "pointer" }}>
              <div className="k">Closing</div>
              <div className="v money">{tr.closingCft.toFixed(2)}</div>
              <div className="sub">CFT · ₹ {inr(tr.closingValue)}</div>
            </div>
          </div>
        </>
      )}

      {feat.acceptPayment && (
        <>
          <div className="dash-section" style={{ marginTop: 22 }}>
            Statements
            <button className="dash-link" onClick={() => router.push("/statements")}>View all →</button>
          </div>
          <div className="panel-card">
            {recentPays.length ? (
              recentPays.map((e) => (
                <div
                  className="stmt"
                  key={e.id}
                  style={{ cursor: "pointer" }}
                  title="Open the quotation at this payment"
                  onClick={() => router.push("/editor/" + e.sourceId + "?pay=" + encodeURIComponent(e.id))}
                >
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

      {/* ===== All Transactions (unified view) ===== */}
      {feat.acceptPayment && (
        <div className="panel-card" style={{ marginTop: 16 }}>
          <div className="pc-head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <span>All Transactions</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span className="sub" style={{ fontSize: 12, color: "var(--ink-faint)" }}>
                {txnsTotal} total · page {txnsPage + 1} of {Math.ceil(txnsTotal / TXNS_PAGE_SIZE) || 1}
              </span>
              {txnsPage > 0 && (
                <button className="btn sm" onClick={() => setTxnsPage((p) => p - 1)} disabled={txnsLoading}>
                  ‹ Prev
                </button>
              )}
              <button className="btn sm" onClick={() => setTxnsPage((p) => p + 1)} disabled={txnsLoading || (txnsPage + 1) * TXNS_PAGE_SIZE >= txnsTotal}>
                Next ›
              </button>
            </div>
          </div>

          {txnsLoading ? (
            <div className="empty" style={{ textAlign: "center", padding: 24 }}>Loading transactions…</div>
          ) : allTxns.length === 0 ? (
            <div className="empty">No transactions found.</div>
          ) : (
            <div className="txns-table" style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "var(--t-cream2, #f6f0e4)", borderBottom: "1px solid var(--line)" }}>
                    <th style="padding: 6px 8px; text-align: left; font-family: var(--disp); font-size: 9px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: var(--ink-faint);">Date</th>
                    <th style="padding: 6px 8px; text-align: left; font-family: var(--disp); font-size: 9px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: var(--ink-faint);">Type</th>
                    <th style="padding: 6px 8px; text-align: left; font-family: var(--disp); font-size: 9px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: var(--ink-faint);">Party</th>
                    <th style="padding: 6px 8px; text-align: right; font-family: var(--disp); font-size: 9px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: var(--ink-faint);">Amount</th>
                    <th style="padding: 6px 8px; text-align: left; font-family: var(--disp); font-size: 9px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: var(--ink-faint);">Mode</th>
                    <th style="padding: 6px 8px; text-align: left; font-family: var(--disp); font-size: 9px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: var(--ink-faint);">Note</th>
                    <th style="padding: 6px 8px; text-align: left; font-family: var(--disp); font-size: 9px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: var(--ink-faint);">By</th>
                    <th style="padding: 6px 8px; text-align: center; font-family: var(--disp); font-size: 9px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: var(--ink-faint);">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {allTxns.map((txn) => (
                    <tr key={txn.id} style={{ borderBottom: "1px solid var(--line)", background: txn.deleted ? "rgba(220,53,69,0.04)" : "transparent" }}>
                      <td style={{ padding: "6px 8px", fontFamily: "var(--mono)", fontSize: 11, color: txn.deleted ? "var(--ink-faint)" : "inherit" }}>{txn.date}</td>
                      <td style={{ padding: "6px 8px" }}>
                        <span style={{
                          display: "inline-block",
                          padding: "1px 6px",
                          borderRadius: "999px",
                          fontSize: 10,
                          fontWeight: 700,
                          fontFamily: "var(--disp)",
                          letterSpacing: ".07em",
                          textTransform: "uppercase",
                          background:
                            txn.type === "expense" ? "var(--t-cream2)" :
                            txn.type === "receipt" ? "rgba(76,175,80,0.12)" :
                            txn.type === "payment" ? "rgba(33,150,243,0.12)" :
                            txn.type === "salary" ? "rgba(255,152,0,0.12)" :
                            txn.type === "debt" ? "rgba(148,99,23,0.12)" :
                            txn.type === "deduct" ? "rgba(244,67,54,0.12)" :
                            txn.type === "repaid" ? "rgba(76,175,80,0.12)" :
                            txn.type === "session" ? "rgba(156,39,176,0.12)" :
                            txn.type === "session_handover" ? "rgba(156,39,176,0.12)" :
                            txn.type === "advance" ? "rgba(255,152,0,0.12)" :
                            txn.type === "deduction" ? "rgba(244,67,54,0.12)" :
                            txn.type === "repayment" ? "rgba(76,175,80,0.12)" : "transparent",
                          color:
                            txn.type === "expense" ? "var(--ink)" :
                            txn.type === "receipt" ? "var(--green)" :
                            txn.type === "payment" ? "var(--blue)" :
                            txn.type === "salary" ? "var(--ochre-deep)" :
                            txn.type === "debt" ? "var(--ochre)" :
                            txn.type === "deduct" ? "var(--danger)" :
                            txn.type === "repaid" ? "var(--green)" : "var(--ink)",
                        }}>
                          {txn.type === "expense" ? "Expense" :
                            txn.type === "receipt" ? "Receipt" :
                            txn.type === "payment" ? "Payment" :
                            txn.type === "salary" ? "Wage" :
                            txn.type === "debt" ? "Debt" :
                            txn.type === "deduct" ? "Cut" :
                            txn.type === "repaid" ? "Repaid" :
                            txn.type === "session" ? "Session" :
                            txn.type === "session_handover" ? "Session" :
                            txn.type === "advance" ? "Advance" :
                            txn.type === "deduction" ? "Cut" :
                            txn.type === "repayment" ? "Repaid" : "Charge"}
                        </span>
                      </td>
                      <td style={{ padding: "6px 8px", color: txn.deleted ? "var(--ink-faint)" : "inherit" }}>
                        <div style={{ fontWeight: 600 }}>{txn.party || "—"}</div>
                        {txn.partyType && <div className="sub" style={{ fontSize: 10 }}>{txn.partyType}</div>}
                      </td>
                      <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: "var(--mono)", fontSize: 12, fontWeight: 700, color: txn.deleted ? "var(--ink-faint)" : (txn.type === "receipt" || txn.type === "repaid" || txn.type === "payment" || txn.type === "repayment" ? "var(--green)" : "var(--danger)") }}>
                        {txn.amount > 0 ? (txn.type === "expense" || txn.type === "salary" || txn.type === "debt" || txn.type === "deduct" || txn.type === "advance" || txn.type === "deduction" ? "−" : "+") : ""}₹{inr(txn.amount)}
                      </td>
                      <td style={{ padding: "6px 8px", fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-faint)" }}>{txn.mode || (txn.type === "session" ? "—" : "cash")}</td>
                      <td style={{ padding: "6px 8px", color: txn.deleted ? "var(--ink-faint)" : "inherit", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{txn.note || "—"}</td>
                      <td style={{ padding: "6px 8px", fontFamily: "var(--disp)", fontSize: 10, color: "var(--ink-faint)" }}>{txn.enteredBy || "—"}</td>
                      <td style={{ padding: "6px 8px", textAlign: "center" }}>
                        {txn.deleted ? (
                          <span style={{ color: "var(--danger)", fontSize: 11, fontWeight: 700 }}>DELETED</span>
                        ) : (
                          <span style={{ color: "var(--green)", fontSize: 11, fontWeight: 700 }}>LIVE</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
