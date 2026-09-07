"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TabIcon } from "@/components/Icons";
import { dateSortKey, inr, quoteOwnBill, todayStr } from "@/lib/calc";
import { cloakAvailable, toggleCloak } from "@/lib/cloak";
import { allRec } from "@/lib/data";
import { dayTotals, inDaybook } from "@/lib/expenses";
import { getFeatures } from "@/lib/features";
import { partyLedger } from "@/lib/payments";
import { phoneQuickActions } from "@/lib/phone-nav";
import { paidTotal, purchaseTotals, totalPurchase } from "@/lib/purchases";
import { canToggleCloak } from "@/lib/staff-role";
import { docTrade } from "@/lib/trading";
import { useApp } from "@/store/useApp";
import type { Customer, Doc, Expense, Purchase } from "@/lib/types";

function live(d: Doc) {
  return !d.deletedAt && !d.purgedAt;
}

function paidOf(d: Doc) {
  const n = +(d.amountPaid || 0);
  if (n) return n;
  return (+(d.payCash || 0)) + (+(d.payUpi || 0));
}

function hello(name?: string) {
  const h = new Date().getHours();
  const w = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const n = (name || "").trim().split(/\s+/)[0];
  return n ? w + ", " + n : w;
}

function ymNow() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

function ymPrev(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

function ymOf(display: string) {
  const k = dateSortKey(display);
  return k ? k.slice(0, 7) : "";
}

function rupee(n: number, cloak: boolean) {
  return cloak ? "••••" : "₹ " + inr(n);
}

function docBill(d: Doc, simple: boolean) {
  return simple ? quoteOwnBill(d) : docTrade(d).grand;
}

function isBillable(d: Doc) {
  return (
    d.status === "Created" ||
    (+(d.payCash || 0)) > 0 ||
    (+(d.payUpi || 0)) > 0 ||
    (+(d.payCommission || 0)) > 0 ||
    (+(d.amountPaid || 0)) > 0
  );
}

type Act = { id: string; href: string; kind: string; title: string; sub: string; amt: number; sort: string; icon: string };

export default function PhoneHome({
  quotes,
  invs,
  customers,
  expenses,
}: {
  quotes: Doc[];
  invs: Doc[];
  customers: Customer[];
  expenses: Expense[];
}) {
  const router = useRouter();
  const { user, cloakMoney, dataVersion, websitePending } = useApp();
  const feat = getFeatures();
  const isOwner = user?.role === "owner";
  const [buys, setBuys] = useState<Purchase[]>([]);
  const [monthOnly, setMonthOnly] = useState(true);
  const quick = phoneQuickActions(feat);
  const cloaked = !!cloakMoney;
  const canCloak = cloakAvailable() && canToggleCloak(user?.role);
  const curYm = ymNow();
  const lastYm = ymPrev(curYm);

  useEffect(() => {
    if (!isOwner) return;
    allRec<Purchase>("purchases").then(setBuys);
  }, [isOwner, dataVersion]);

  function inScope(display: string) {
    if (!monthOnly) return true;
    const ym = ymOf(display);
    return !ym || ym === curYm;
  }

  const salesDocs = (feat.simpleQuote ? quotes : invs).filter(live);
  let sales = 0;
  let salesLast = 0;
  let officialBuy = 0;
  for (const d of salesDocs) {
    const ym = ymOf(d.date);
    if (feat.simpleQuote) {
      if (!isBillable(d)) continue;
      const grand = quoteOwnBill(d);
      if (inScope(d.date)) sales += grand;
      if (monthOnly && ym === lastYm) salesLast += grand;
      continue;
    }
    const t = docTrade(d);
    if (t.buy) {
      if (isOwner && inScope(d.date)) officialBuy += t.grand;
      continue;
    }
    if (inScope(d.date)) sales += t.grand;
    if (monthOnly && ym === lastYm) salesLast += t.grand;
  }

  const ledger = feat.acceptPayment ? partyLedger(quotes, expenses, customers) : null;
  const receivables = ledger ? ledger.totalPending : 0;
  const pendingN = ledger ? ledger.parties.filter((p) => p.balance > 0.5).length : 0;
  const payables = isOwner
    ? (feat.simpleQuote ? purchaseTotals(buys).balance : officialBuy)
    : 0;
  const recIn = feat.acceptPayment
    ? expenses.filter((e) => e.type === "sale" && !e.charge && inScope(e.date)).reduce((s, e) => s + (+e.amount || 0), 0)
    : 0;
  const payOut = isOwner
    ? buys.filter((p) => inScope(p.date)).reduce((s, p) => s + paidTotal(p), 0)
    : 0;
  const cash = feat.acceptPayment
    ? dayTotals(expenses.filter((e) => inDaybook(e) && (monthOnly ? inScope(e.date) : e.date === todayStr()))).net
    : 0;
  const cashToday = feat.acceptPayment
    ? dayTotals(expenses.filter((e) => e.date === todayStr() && inDaybook(e))).net
    : 0;

  const grow = monthOnly && salesLast > 0.5 ? Math.round(((sales - salesLast) / salesLast) * 1000) / 10 : null;
  const pendingQuotes = quotes.filter((d) => live(d) && paidOf(d) < 0.5 && (d.status === "Created" || d.status === "Draft")).length;

  const minis = [
    { k: "Receivables", v: rupee(receivables, cloaked), sub: recIn > 0.5 ? rupee(recIn, cloaked) : "", tone: "ok", icon: "rupee", href: "/payments", hide: !feat.acceptPayment },
    { k: "Payables", v: rupee(payables, cloaked), sub: payOut > 0.5 ? rupee(payOut, cloaked) : "", tone: "warn", icon: "file-text", href: feat.simpleQuote ? "/buys" : "/invoices", hide: !isOwner },
    { k: "Cash balance", v: rupee(cash, cloaked), sub: monthOnly && Math.abs(cashToday) > 0.5 ? rupee(cashToday, cloaked) : "", tone: "ok", icon: "wallet", href: "/expenses", hide: !feat.acceptPayment },
  ].filter((t) => !t.hide);

  const attention = [
    { k: "Payments pending", sub: "Amt: " + rupee(receivables, cloaked) + " · " + pendingN + " parties", pill: pendingN + " pending", tone: "ok", icon: "payments", href: "/payments", hide: !feat.acceptPayment || pendingN < 1 },
    { k: "Outstanding amounts", sub: rupee(receivables, cloaked) + " still due", pill: pendingN + " parties", tone: "warn", icon: "scale", href: "/payments", hide: !feat.acceptPayment || receivables < 0.5 },
    { k: "Quotations pending", sub: pendingQuotes + " quotations awaiting payment", pill: pendingQuotes + " pending", tone: "gold", icon: "clipboard", href: "/quotations", hide: pendingQuotes < 1 },
    { k: "New business alerts", sub: websitePending + " website quotations", pill: String(websitePending), tone: "gold", icon: "bell", href: "/website-quotations", hide: !websitePending },
  ].filter((t) => !t.hide);

  const recent: Act[] = [];
  for (const d of salesDocs) {
    const bill = docBill(d, !!feat.simpleQuote);
    const paid = paidOf(d);
    if (Math.max(bill, paid) < 0.5) continue;
    recent.push({
      id: d.id,
      href: "/editor/" + d.id,
      kind: feat.simpleQuote ? "Quotation raised" : "Invoice generated",
      title: d.customerName || "Cash",
      sub: (d.displayNumber || d.number || "—") + " · " + (d.date || ""),
      amt: feat.acceptPayment ? Math.max(0, bill - paid) || bill : bill,
      sort: dateSortKey(d.date || "") + (d.createdAt || ""),
      icon: feat.simpleQuote ? "file-plus" : "invoices",
    });
  }
  if (feat.acceptPayment) {
    for (const e of expenses) {
      if (e.type !== "sale" || e.charge || !(e.amount > 0.5)) continue;
      recent.push({
        id: "rcpt-" + e.id,
        href: "/receipts",
        kind: "Payment received",
        title: e.party || e.label || "Receipt",
        sub: "Receipt · " + (e.date || ""),
        amt: e.amount,
        sort: dateSortKey(e.date || "") + (e.createdAt || ""),
        icon: "receipt",
      });
    }
  }
  if (isOwner) {
    for (const p of buys) {
      const buy = (p.kind || "buy") === "buy";
      const amt = buy ? totalPurchase(p) : paidTotal(p);
      if (amt < 0.5) continue;
      recent.push({
        id: "buy-" + p.id,
        href: feat.simpleQuote ? "/buys" : "/suppliers",
        kind: buy ? "Purchase order" : "Payment made",
        title: p.buyerName || p.fromName || "Purchase",
        sub: (p.billNo || "PO") + " · " + (p.date || ""),
        amt: buy ? amt : -amt,
        sort: dateSortKey(p.date || "") + (p.createdAt || ""),
        icon: buy ? "bag" : "payments",
      });
    }
  }
  recent.sort((a, b) => b.sort.localeCompare(a.sort));
  const shownRecent = recent.slice(0, 6);

  return (
    <div className="phone-home">
      <p className="phone-hello">
        {hello(user?.name)}
        <TabIcon icon="sun" size={18} />
      </p>
      <div className="phone-sec-h">
        <h2>Business overview</h2>
        {canCloak && (
          <button type="button" className="phone-eye" onClick={() => void toggleCloak()} aria-label={cloaked ? "Show amounts" : "Hide amounts"}>
            <TabIcon icon={cloaked ? "eye-off" : "eye"} size={18} />
          </button>
        )}
      </div>
      <div className="phone-ov">
        <div className="phone-ov-top">
          <button type="button" className="phone-ov-sales" onClick={() => router.push(feat.simpleQuote ? "/quotations" : "/invoices")}>
            <i>Total sales</i>
            <strong>{rupee(sales, cloaked)}</strong>
            {grow != null && <em className={grow >= 0 ? "up" : "dn"}>{grow >= 0 ? "↑" : "↓"} {Math.abs(grow)}%</em>}
          </button>
          <button type="button" className="phone-ov-range" onClick={() => setMonthOnly((v) => !v)}>
            {monthOnly ? "This month" : "All time"}
          </button>
        </div>
        {minis.length > 0 && (
          <div className="phone-ov-minis">
            {minis.map((t) => (
              <button key={t.k} type="button" onClick={() => router.push(t.href)}>
                <span className={"phone-ico " + t.tone}><TabIcon icon={t.icon} size={14} /></span>
                <i>{t.k}</i>
                <b>{t.v}</b>
                {t.sub && <small className={t.tone}>{t.sub}</small>}
              </button>
            ))}
          </div>
        )}
      </div>
      <h2 className="phone-h">Quick actions</h2>
      <div className="phone-qa">
        {quick.map((q) => (
          <button key={q.href + q.label} type="button" className={q.href === "/editor" ? "on" : ""} onClick={() => router.push(q.href)}>
            <TabIcon icon={q.icon} size={22} />
            {q.label}
          </button>
        ))}
      </div>
      {attention.length > 0 && (
        <>
          <div className="phone-sec-h">
            <h2>Needs attention</h2>
            <Link href={feat.acceptPayment ? "/payments" : "/quotations"}>View all</Link>
          </div>
          <div className="phone-list">
            {attention.map((t) => (
              <button key={t.k} type="button" className="phone-att" onClick={() => router.push(t.href)}>
                <span className={"phone-ico " + t.tone}><TabIcon icon={t.icon} size={16} /></span>
                <span>
                  <span className="nm">{t.k}</span>
                  <span className="mut">{t.sub}</span>
                </span>
                <em className={t.tone}>{t.pill}</em>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="phone-sec-h">
        <h2>Recent activity</h2>
        <Link href={feat.simpleQuote ? "/quotations" : "/invoices"}>View all</Link>
      </div>
      <div className="phone-list">
        {shownRecent.map((d) => (
          <button key={d.id} type="button" className="phone-act" onClick={() => router.push(d.href)}>
            <span className="phone-ico"><TabIcon icon={d.icon} size={16} /></span>
            <span>
              <span className="nm">{d.kind}</span>
              <span className="mut">{d.title} · {d.sub}</span>
            </span>
            <span className={"amt" + (d.amt < 0 ? " out" : "")}>{d.amt < 0 ? "− " : ""}{rupee(Math.abs(d.amt), cloaked)}</span>
          </button>
        ))}
        {shownRecent.length === 0 && <div className="empty">No recent activity</div>}
      </div>
    </div>
  );
}
