"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec, delRec, getRec } from "@/lib/db";
import { inr } from "@/lib/calc";
import { createInvoiceForCustomer, createQuotationForCustomer } from "@/lib/create";
import { getFeatures } from "@/lib/features";
import { customerFinancials } from "@/lib/customers";
import { editCustomerDialog } from "@/lib/customer-form";
import { customerFollowupMessage, waLink } from "@/lib/whatsapp";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import type { Customer, Doc } from "@/lib/types";
import DocList from "./DocList";

export default function CustomerDetail({ id }: { id: string }) {
  const { ready, dataVersion } = useApp();
  const router = useRouter();
  const [cust, setCust] = useState<Customer | null | undefined>(undefined);
  const [quotes, setQuotes] = useState<Doc[]>([]);
  const [invs, setInvs] = useState<Doc[]>([]);

  const load = useCallback(() => {
    Promise.all([getRec<Customer>("customers", id), allRec<Doc>("quotations"), allRec<Doc>("invoices")]).then(
      ([c, q, i]) => {
        setCust(c ?? null);
        setQuotes(q.filter((d) => d.customerId === id).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")));
        setInvs(i.filter((d) => d.customerId === id).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")));
      },
    );
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

  const f = customerFinancials(cust.id, quotes, invs);
  const stats = [
    { k: "Quoted", v: "₹ " + inr(f.quotedTotal) },
    { k: "Invoiced", v: "₹ " + inr(f.invoicedTotal), money: true },
    { k: "Paid", v: "₹ " + inr(f.paid) },
    { k: "Outstanding", v: "₹ " + inr(f.outstanding), danger: f.outstanding > 0 },
  ];

  async function edit() {
    const c = await editCustomerDialog(cust!);
    if (c) {
      load();
      bumpData();
    }
  }
  const invoiceMode = getFeatures().invoices;
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
    toast("Customer deleted");
    router.push("/customers");
  }

  return (
    <div>
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

      <div className="sectitle" style={{ marginTop: 24, fontSize: 22 }}>
        Quotations <small>— {quotes.length}</small>
      </div>
      <div className="listwrap">
        <DocList docs={quotes} empty="No quotations for this customer yet." />
      </div>

      <div className="sectitle" style={{ marginTop: 24, fontSize: 22 }}>
        Invoices <small>— {invs.length}</small>
      </div>
      <div className="listwrap">
        <DocList docs={invs} empty="No invoices for this customer yet." />
      </div>
    </div>
  );
}
