"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec, delRec, getRec, prefGet, prefSet } from "@/lib/data";
import { inr } from "@/lib/calc";
import { createInvoiceForCustomer, createQuotationForCustomer } from "@/lib/create";
import { getFeatures } from "@/lib/features";
import { customerFinancials } from "@/lib/customers";
import { editCustomerDialog } from "@/lib/customer-form";
import { customerFollowupMessage, waLink } from "@/lib/whatsapp";
import { useApp } from "@/store/useApp";
import { bumpData } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import type { Customer, Doc, Expense } from "@/lib/types";

function applySearch(list: Customer[], q: string) {
  q = (q || "").trim().toLowerCase();
  if (!q) return list;
  return list.filter((c) => [c.name, c.phone, c.site].some((v) => String(v || "").toLowerCase().includes(q)));
}

export default function CustomersView() {
  const { dataVersion, searchTerm, cloakMoney } = useApp();
  const router = useRouter();
  const [list, setList] = useState<Customer[]>([]);
  const [quotes, setQuotes] = useState<Doc[]>([]);
  const [invs, setInvs] = useState<Doc[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  /** list order — device preference: "az" alphabetical · "due" biggest outstanding first */
  const [sortBy, setSortBy] = useState<"az" | "due">(() => prefGet<"az" | "due">("custSort", "az"));
  const pickSort = (v: "az" | "due") => {
    setSortBy(v);
    prefSet("custSort", v);
  };

  const load = useCallback(() => {
    Promise.all([
      allRec<Customer>("customers"),
      allRec<Doc>("quotations"),
      allRec<Doc>("invoices"),
      allRec<Expense>("expenses"),
    ]).then(([c, q, i, e]) => {
      c.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      setList(c);
      setQuotes(q);
      setInvs(i);
      setExpenses(e);
    });
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
  // quote-only app (unofficial): a Created quotation is the sale, so it counts toward dues.
  const quotesAsBills = !invoiceMode;
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
    await delRec("customers", c.id); // soft delete — the row stays recoverable in the database
    load();
  }

  // financials once per customer, so the list can sort by outstanding
  const entries = applySearch(cloakMoney ? [] : list, searchTerm).map((c) => ({
    c,
    f: customerFinancials(c.id, quotes, invs, c.opening || 0, expenses, quotesAsBills),
  }));
  if (sortBy === "due") entries.sort((a, b) => b.f.outstanding - a.f.outstanding || (a.c.name || "").localeCompare(b.c.name || ""));

  return (
    <div>
      <div className="sectitle">
        Customers <small>— {list.length} contact{list.length === 1 ? "" : "s"}</small>
      </div>
      <div className="rowbtns" style={{ alignItems: "center", gap: 10 }}>
        <button className="btn primary sm" onClick={add}>
          + Add customer
        </button>
        <div className="db-seg sm" style={{ marginLeft: "auto" }} role="group" aria-label="Sort customers">
          <button className={"seg-btn" + (sortBy === "az" ? " on" : "")} type="button" onClick={() => pickSort("az")}>
            A–Z
          </button>
          <button className={"seg-btn" + (sortBy === "due" ? " on" : "")} type="button" onClick={() => pickSort("due")}>
            Outstanding first
          </button>
        </div>
      </div>
      <div className="custgrid">
        {entries.length ? (
          entries.map(({ c, f }) => {
            return (
              <div className="custcard" key={c.id} onClick={() => router.push("/customers/" + c.id)} style={{ cursor: "pointer" }}>
                <h3>{c.name}</h3>
                <div className="ph">{c.phone || "—"}</div>
                <div className="meta2">
                  {c.site && <>Carpenter: {c.site}{c.sitePhone ? " · " + c.sitePhone : ""}<br /></>}
                  <b>{f.quoteCount}</b> quote{f.quoteCount === 1 ? "" : "s"}
                  {invoiceMode && (
                    <> · <b>{f.invoiceCount}</b> invoice{f.invoiceCount === 1 ? "" : "s"}</>
                  )}
                  {f.paid > 0 && (
                    <>
                      <br />
                      <span style={{ color: "var(--ink-faint)" }}>Paid ₹ {inr(f.paid)}</span>
                    </>
                  )}
                  {f.opening > 0 && (
                    <>
                      <br />
                      <span style={{ color: "var(--ink-faint)" }}>Opening dues ₹ {inr(f.opening)}</span>
                    </>
                  )}
                  {f.outstanding > 0.5 && (
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
