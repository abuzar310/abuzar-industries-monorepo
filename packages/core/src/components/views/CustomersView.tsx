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
import { bumpData } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import type { Customer, Doc } from "@/lib/types";

function applySearch(list: Customer[], q: string) {
  q = (q || "").trim().toLowerCase();
  if (!q) return list;
  return list.filter((c) => [c.name, c.phone, c.site].some((v) => String(v || "").toLowerCase().includes(q)));
}

export default function CustomersView() {
  const { dataVersion, searchTerm } = useApp();
  const router = useRouter();
  const [list, setList] = useState<Customer[]>([]);
  const [quotes, setQuotes] = useState<Doc[]>([]);
  const [invs, setInvs] = useState<Doc[]>([]);

  const load = useCallback(() => {
    Promise.all([allRec<Customer>("customers"), allRec<Doc>("quotations"), allRec<Doc>("invoices")]).then(
      ([c, q, i]) => {
        c.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        setList(c);
        setQuotes(q);
        setInvs(i);
      },
    );
  }, []);
  useEffect(() => {
    load();
  }, [load, dataVersion]);

  async function add() {
    const c = await editCustomerDialog();
    if (c) {
      load();
      bumpData();
    }
  }
  const invoiceMode = getFeatures().invoices;
  async function newDoc(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    const c = await getRec<Customer>("customers", id);
    if (!c) return;
    const d = invoiceMode ? await createInvoiceForCustomer(c) : await createQuotationForCustomer(c);
    router.push("/editor/" + d.id);
  }
  function whatsapp(e: React.MouseEvent, c: Customer) {
    e.stopPropagation();
    window.open(waLink(c.phone, customerFollowupMessage(c.name)), "_blank");
  }
  async function remove(e: React.MouseEvent, c: Customer) {
    e.stopPropagation();
    const ok = await confirmDialog({
      title: "Delete " + c.name + "?",
      message: "Their quotations and invoices are kept; only the contact is removed.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await delRec("customers", c.id);
    load();
  }

  const shown = applySearch(list, searchTerm);

  return (
    <div>
      <div className="sectitle">
        Customers <small>— {list.length} contact{list.length === 1 ? "" : "s"}</small>
      </div>
      <div className="rowbtns">
        <button className="btn primary sm" onClick={add}>
          + Add customer
        </button>
      </div>
      <div className="custgrid">
        {shown.length ? (
          shown.map((c) => {
            const f = customerFinancials(c.id, quotes, invs);
            return (
              <div className="custcard" key={c.id} onClick={() => router.push("/customers/" + c.id)} style={{ cursor: "pointer" }}>
                <h3>{c.name}</h3>
                <div className="ph">{c.phone || "—"}</div>
                <div className="meta2">
                  {c.site && <>Site: {c.site}<br /></>}
                  <b>{f.quoteCount}</b> quote{f.quoteCount === 1 ? "" : "s"} · <b>{f.invoiceCount}</b> invoice
                  {f.invoiceCount === 1 ? "" : "s"}
                  {f.outstanding > 0 && (
                    <>
                      <br />
                      <span style={{ color: "var(--danger)" }}>₹ {inr(f.outstanding)} outstanding</span>
                    </>
                  )}
                </div>
                <div className="links">
                  <button className="btn sm" onClick={(e) => newDoc(e, c.id)}>
                    {invoiceMode ? "New invoice" : "New quote"}
                  </button>
                  <button className="btn wa sm" onClick={(e) => whatsapp(e, c)}>
                    WhatsApp
                  </button>
                  <button className="btn warn sm" onClick={(e) => remove(e, c)}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="empty">
            <div className="empty-icon">👥</div>
            <div className="empty-title">No customers yet</div>
            <div className="empty-note">They&apos;re saved automatically when you make a quotation, or add one now.</div>
          </div>
        )}
      </div>
    </div>
  );
}
