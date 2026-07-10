"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec, delRec, getRec } from "@/lib/db";
import { cloudDelete } from "@/lib/cloud";
import { computeDoc, inr } from "@/lib/calc";
import { brandFor } from "@/lib/brand";
import { createInvoiceForCustomer, createQuotationForCustomer } from "@/lib/create";
import { getFeatures } from "@/lib/features";
import { customerFinancials } from "@/lib/customers";
import { editCustomerDialog } from "@/lib/customer-form";
import { customerFollowupMessage, waLink } from "@/lib/whatsapp";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import type { Customer, Doc, Expense } from "@/lib/types";
import DocList from "./DocList";

export default function CustomerDetail({ id }: { id: string }) {
  const { ready, dataVersion, brandMode } = useApp();
  const router = useRouter();
  const [cust, setCust] = useState<Customer | null | undefined>(undefined);
  const [quotes, setQuotes] = useState<Doc[]>([]);
  const [invs, setInvs] = useState<Doc[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);

  const load = useCallback(() => {
    Promise.all([
      getRec<Customer>("customers", id),
      allRec<Doc>("quotations"),
      allRec<Doc>("invoices"),
      allRec<Expense>("expenses"),
    ]).then(([c, q, i, e]) => {
      setCust(c ?? null);
      setQuotes(q.filter((d) => d.customerId === id).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")));
      setInvs(i.filter((d) => d.customerId === id).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")));
      setExpenses(e.filter((x) => x.custId === id));
    });
  }, [id]);
  useEffect(() => {
    if (ready) load();
  }, [ready, dataVersion, load]);

  if (cust === undefined) return <div className="sectitle">Customer <small>— loading…</small></div>;
  if (cust === null)
    return (
      <div className="empty">
        <div className="empty-title">Customer not found</div>
        <button className="btn sm" style={{ marginTop: 12 }} onClick={() => router.push("/customers")}>
          ← Back to customers
        </button>
      </div>
    );

  const invoiceMode = getFeatures().invoices;
  const f = customerFinancials(cust.id, quotes, invs, cust.opening || 0, expenses, !invoiceMode);
  const stats = [
    { k: "Quoted", v: "₹ " + inr(f.quotedTotal) },
    ...(invoiceMode ? [{ k: "Invoiced", v: "₹ " + inr(f.invoicedTotal), money: true }] : []),
    { k: "Paid", v: "₹ " + inr(f.paid) },
    ...(f.opening ? [{ k: "Opening dues", v: "₹ " + inr(f.opening) }] : []),
    { k: "Outstanding", v: "₹ " + inr(f.outstanding), danger: f.outstanding > 0.5 },
  ];

  // printable quotations report for this customer (oldest → newest), with per-quote CFT + totals
  const brand = brandFor(brandMode);
  const opening = Math.round((+(cust.opening || 0) || 0) * 100) / 100;
  const qreport = [...quotes].reverse().map((d, i) => {
    const t = computeDoc(d);
    return {
      i: i + 1,
      no: d.number || d.id,
      date: d.date,
      carpenter: d.site || "",
      cft: t.secCft.reduce((s, c) => s + c, 0),
      total: t.grand,
    };
  });
  const qtot = qreport.reduce(
    (s, r) => ({ cft: s.cft + r.cft, total: s.total + r.total }),
    { cft: 0, total: 0 },
  );
  const grandTotal = Math.round((qtot.total + opening) * 100) / 100;
  const canPrint = quotes.length > 0 || opening > 0;
  const today = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const genOn = `${pad2(today.getDate())}-${pad2(today.getMonth() + 1)}-${today.getFullYear()}`;

  async function edit() {
    const c = await editCustomerDialog(cust!);
    if (c) {
      load();
      bumpData();
    }
  }
  async function newDoc() {
    const d = invoiceMode ? await createInvoiceForCustomer(cust!) : await createQuotationForCustomer(cust!);
    router.push("/editor/" + d.id);
  }
  function whatsapp() {
    window.open(waLink(cust!.phone, customerFollowupMessage(cust!.name)), "_blank");
  }
  async function remove() {
    const ok = await confirmDialog({
      title: "Delete " + cust!.name + "?",
      message: "Their quotations and invoices are kept; only the contact is removed.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await delRec("customers", cust!.id);
    await cloudDelete("customers", cust!.id); // tombstone it so the cloud doesn't re-sync it back
    toast("Customer deleted");
    router.push("/customers");
  }

  return (
    <div>
      <div className="cd-screen">
      <button className="btn sm" style={{ marginBottom: 14 }} onClick={() => router.push("/customers")}>
        ← Customers
      </button>

      <div className="custcard" style={{ cursor: "default" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h3 style={{ fontSize: 26 }}>{cust.name}</h3>
            <div className="ph">{cust.phone || "—"}</div>
            <div className="meta2">
              {cust.site && <>Carpenter: {cust.site}<br /></>}
              {cust.address && <>{cust.address}<br /></>}
              {cust.notes && <>Note: {cust.notes}</>}
            </div>
          </div>
          <div className="links" style={{ marginTop: 0 }}>
            <button className="btn primary sm" onClick={newDoc}>{invoiceMode ? "New invoice" : "New quote"}</button>
            <button className="btn wa sm" onClick={whatsapp}>WhatsApp</button>
            <button className="btn sm" onClick={edit}>Edit</button>
            <button className="btn warn sm" onClick={remove}>Delete</button>
          </div>
        </div>
      </div>

      <div className="dash-grid" style={{ marginTop: 16 }}>
        {stats.map((s) => (
          <div className="stat" key={s.k}>
            <div className="k">{s.k}</div>
            <div className={"v" + (s.money ? " money" : "")} style={s.danger ? { color: "var(--danger)" } : undefined}>
              {s.v}
            </div>
          </div>
        ))}
      </div>

      <div className="sectitle" style={{ marginTop: 24, fontSize: 22, display: "flex", alignItems: "center", gap: 12 }}>
        <span>Quotations <small>— {quotes.length}</small></span>
        {canPrint && (
          <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => window.print()}>
            Print / Save PDF
          </button>
        )}
      </div>
      <div className="listwrap">
        <DocList docs={quotes} empty="No quotations for this customer yet." />
      </div>

      {invoiceMode && (
        <>
          <div className="sectitle" style={{ marginTop: 24, fontSize: 22 }}>
            Invoices <small>— {invs.length}</small>
          </div>
          <div className="listwrap">
            <DocList docs={invs} empty="No invoices for this customer yet." />
          </div>
        </>
      )}
      </div>

      {canPrint && (
        <div className="cd-print rep-doc cd-qreport">
          <div className="rep-head">
            <div className="rep-brand">
              <h1>{brand.name || "Quotations"}</h1>
              {brand.addr && <div>{brand.addr}</div>}
              {brand.gstin && <div>GSTIN: {brand.gstin}</div>}
            </div>
            <div className="rep-meta">
              <div className="rep-title">Quotations</div>
              <div className="rep-period">{cust.name}{cust.phone ? " · " + cust.phone : ""}</div>
            </div>
          </div>

          <div className="rep-summary cols3">
            <div><b>{qreport.length}</b><span>Quotations</span></div>
            <div><b>{inr(qtot.cft)}</b><span>Total CFT</span></div>
            <div><b>₹{inr(grandTotal)}</b><span>Total{opening > 0 ? " (incl. opening)" : ""}</span></div>
          </div>

          <table className="rep-table">
            <colgroup>
              <col style={{ width: "5%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "22%" }} />
              <col style={{ width: "31%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "16%" }} />
            </colgroup>
            <thead>
              <tr>
                <th className="c-n">#</th>
                <th>Date</th>
                <th>Quote No</th>
                <th>Carpenter</th>
                <th className="amt">CFT</th>
                <th className="amt">Total ₹</th>
              </tr>
            </thead>
            <tbody>
              {opening > 0 && (
                <tr className="rep-op">
                  <td className="c-n">—</td>
                  <td className="c-date">—</td>
                  <td className="c-no">Opening Balance</td>
                  <td className="c-cust">—</td>
                  <td className="amt">—</td>
                  <td className="amt">{inr(opening)}</td>
                </tr>
              )}
              {qreport.map((r) => (
                <tr key={r.no + "-" + r.i}>
                  <td className="c-n">{r.i}</td>
                  <td className="c-date">{r.date}</td>
                  <td className="c-no">{r.no}</td>
                  <td className="c-cust">{r.carpenter || "—"}</td>
                  <td className="amt">{inr(r.cft)}</td>
                  <td className="amt">{inr(r.total)}</td>
                </tr>
              ))}
              <tr className="rep-tot">
                <td colSpan={4}>
                  Total
                  {opening > 0 ? ` — opening + ${qreport.length} quotation${qreport.length === 1 ? "" : "s"}` : ` — ${qreport.length} quotation${qreport.length === 1 ? "" : "s"}`}
                </td>
                <td className="amt">{inr(qtot.cft)}</td>
                <td className="amt">{inr(grandTotal)}</td>
              </tr>
            </tbody>
          </table>

          <div className="rep-foot">Generated {genOn} · {brand.name}</div>
        </div>
      )}
    </div>
  );
}
