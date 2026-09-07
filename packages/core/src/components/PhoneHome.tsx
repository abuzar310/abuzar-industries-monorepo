"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { inr, quoteOwnBill, todayStr } from "@/lib/calc";
import { allRec } from "@/lib/data";
import { dayTotals, inDaybook } from "@/lib/expenses";
import { getFeatures } from "@/lib/features";
import { partyLedger } from "@/lib/payments";
import { phoneQuickActions } from "@/lib/phone-nav";
import { purchaseTotals } from "@/lib/purchases";
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
  const { user, cloakMoney, dataVersion } = useApp();
  const feat = getFeatures();
  const isOwner = user?.role === "owner";
  const [buys, setBuys] = useState<Purchase[]>([]);
  const quick = phoneQuickActions(feat);

  useEffect(() => {
    if (!isOwner) return;
    allRec<Purchase>("purchases").then(setBuys);
  }, [isOwner, dataVersion]);

  const salesDocs = (feat.simpleQuote ? quotes : invs).filter(live);
  let sales = 0;
  let officialBuy = 0;
  if (feat.simpleQuote) {
    for (const d of quotes) {
      if (!live(d)) continue;
      const billable =
        d.status === "Created" ||
        (+(d.payCash || 0)) > 0 ||
        (+(d.payUpi || 0)) > 0 ||
        (+(d.payCommission || 0)) > 0 ||
        (+(d.amountPaid || 0)) > 0;
      if (billable) sales += quoteOwnBill(d);
    }
  } else {
    for (const d of invs) {
      if (!live(d)) continue;
      const t = docTrade(d);
      if (t.buy) officialBuy += t.grand;
      else sales += t.grand;
    }
  }

  const ledger = feat.acceptPayment ? partyLedger(quotes, expenses, customers) : null;
  const receivables = ledger ? ledger.totalPending : 0;
  const pendingN = ledger ? ledger.parties.filter((p) => p.balance > 0.5).length : 0;
  const payables = isOwner
    ? (feat.simpleQuote ? purchaseTotals(buys).balance : officialBuy)
    : 0;
  const today = todayStr();
  const cash = feat.acceptPayment
    ? dayTotals(expenses.filter((e) => e.date === today && inDaybook(e))).net
    : 0;

  const recent = salesDocs
    .slice()
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || ""))
    .slice(0, 12);

  const tiles: { k: string; v: string; sub?: string; href: string; hide?: boolean }[] = [
    { k: "Total sales", v: "₹ " + inr(sales), href: feat.simpleQuote ? "/quotations" : "/invoices" },
    { k: "Receivables", v: "₹ " + inr(receivables), sub: pendingN ? pendingN + " parties" : "all clear", href: "/payments", hide: !feat.acceptPayment },
    { k: "Payables", v: "₹ " + inr(payables), href: feat.simpleQuote ? "/buys" : "/invoices", hide: !isOwner },
    { k: "Cash today", v: "₹ " + inr(cash), href: "/expenses", hide: !feat.acceptPayment },
    { k: "Pending payments", v: cloakMoney ? "0" : String(pendingN), href: "/payments", hide: !feat.acceptPayment },
  ];

  const shown = tiles.filter((t) => !t.hide);

  return (
    <div className="phone-home">
      <div className="phone-kpis">
        {shown.map((t, i) => (
          <button key={t.k} type="button" className={"phone-kpi" + (i === 0 ? " phone-kpi-lead" : "")} onClick={() => router.push(t.href)}>
            <i>{t.k}</i>
            <strong>{t.v}</strong>
            {t.sub && <small>{t.sub}</small>}
          </button>
        ))}
      </div>
      <div className="phone-qa">
        {quick.map((q) => (
          <button key={q.href} type="button" onClick={() => router.push(q.href)}>
            + {q.label}
          </button>
        ))}
      </div>
      <h2 className="phone-h">Recent</h2>
      <div className="listwrap">
        {recent.map((d) => {
          const bill = feat.simpleQuote ? quoteOwnBill(d) : docTrade(d).grand;
          const paid = paidOf(d);
          const due = feat.acceptPayment ? Math.max(0, bill - paid) : 0;
          return (
            <button key={d.id} type="button" className="lrow phone-sec-row" onClick={() => router.push("/editor/" + d.id)}>
              <span>
                <span className="nm">{d.customerName || "Cash"}</span>
                <span className="mut">#{d.displayNumber || d.number || "—"} · {d.date || ""}</span>
              </span>
              <span className="amt">₹ {inr(feat.acceptPayment ? due : bill)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
