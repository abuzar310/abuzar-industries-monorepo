"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { quoteOwnBill } from "@/lib/calc";
import { partyLedger } from "@/lib/payments";
import { getFeatures } from "@/lib/features";
import type { Customer, Doc, Expense } from "@/lib/types";

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
  const feat = getFeatures();
  const [home, setHome] = useState<"txn" | "party">("txn");
  const invIds = new Set(invs.map((d) => d.id));
  const sales = (feat.simpleQuote ? quotes : [...invs, ...quotes])
    .filter(live)
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || ""))
    .slice(0, 40);
  const parties = feat.acceptPayment
    ? partyLedger(quotes, expenses, customers).parties
        .filter((p) => Math.round(p.balance) !== 0)
        .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
        .slice(0, 60)
    : customers.slice(0, 60).map((c) => ({ custId: c.id, name: c.name, balance: 0, phone: c.phone || "" }));

  return (
    <div className="phone-home">
      <div className="phone-pills">
        <button type="button" className={home === "txn" ? "on" : ""} onClick={() => setHome("txn")}>
          Transaction Details
        </button>
        <button type="button" className={home === "party" ? "on" : ""} onClick={() => setHome("party")}>
          Party Details
        </button>
      </div>
      {home === "txn" && sales.map((d) => {
        const bill = quoteOwnBill(d);
        const paid = paidOf(d);
        const sale = invIds.has(d.id);
        return (
          <button key={d.id} type="button" className="phone-card" onClick={() => router.push("/editor/" + d.id)}>
            <div className="phone-card-top">
              <div>
                <b>{d.customerName || "Cash"}</b>
                <span className="phone-stamp">{sale ? "SALE" : "QUOTE"}</span>
              </div>
              <small>#{d.displayNumber || d.number || "—"} · {d.date || ""}</small>
            </div>
            <div className="phone-card-nums">
              <div><i>Total</i><strong>₹ {bill.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
              <div><i>Balance</i><strong>₹ {Math.max(0, bill - paid).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
            </div>
          </button>
        );
      })}
      {home === "party" && parties.map((p) => (
        <button
          key={p.custId || p.name}
          type="button"
          className="phone-card phone-card-row"
          onClick={() => router.push(p.custId ? "/customers/" + p.custId : "/payments")}
        >
          <div>
            <b>{p.name}</b>
            <small>{p.phone || ""}</small>
          </div>
          <div className={p.balance >= 0 ? "get" : "give"}>
            ₹ {Math.abs(p.balance).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            <small>{p.balance >= 0 ? "You'll Get" : "You Give"}</small>
          </div>
        </button>
      ))}
    </div>
  );
}
