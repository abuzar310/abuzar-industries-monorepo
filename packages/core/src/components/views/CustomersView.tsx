"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec, delRec, getRec, prefGet, prefSet } from "@/lib/data";
import { inr } from "@/lib/calc";
import { createInvoiceForCustomer, createQuotationForCustomer } from "@/lib/create";
import { getFeatures } from "@/lib/features";
import { customerFinancials } from "@/lib/customers";
import { editCustomerDialog } from "@/lib/customer-form";
import { deleteCarpenter, editCarpenterDialog, listCarpenters } from "@/lib/carpenters";
import { customerFollowupMessage, waLink } from "@/lib/whatsapp";
import { useApp } from "@/store/useApp";
import { bumpData } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import type { Carpenter, Customer, Doc, Expense } from "@/lib/types";

type Mode = "customers" | "carpenters";

function applyCustSearch(list: Customer[], q: string) {
  q = (q || "").trim().toLowerCase();
  if (!q) return list;
  return list.filter((c) =>
    [c.name, c.phone, c.site, c.sitePhone, c.siteVillage, c.siteCity].some((v) =>
      String(v || "")
        .toLowerCase()
        .includes(q),
    ),
  );
}

function applyCarpSearch(list: Carpenter[], q: string) {
  q = (q || "").trim().toLowerCase();
  if (!q) return list;
  return list.filter((c) =>
    [c.name, c.phone, c.village, c.city, c.notes].some((v) =>
      String(v || "")
        .toLowerCase()
        .includes(q),
    ),
  );
}

export default function CustomersView() {
  const { dataVersion, searchTerm, cloakMoney } = useApp();
  const router = useRouter();
  const [list, setList] = useState<Customer[]>([]);
  const [carpenters, setCarpenters] = useState<Carpenter[]>([]);
  const [quotes, setQuotes] = useState<Doc[]>([]);
  const [invs, setInvs] = useState<Doc[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [mode, setMode] = useState<Mode>(() => prefGet<Mode>("custPageMode", "customers"));
  /** list order — device preference: "az" alphabetical · "due" biggest outstanding first */
  const [sortBy, setSortBy] = useState<"az" | "due">(() => prefGet<"az" | "due">("custSort", "az"));
  const pickSort = (v: "az" | "due") => {
    setSortBy(v);
    prefSet("custSort", v);
  };
  const pickMode = (v: Mode) => {
    setMode(v);
    prefSet("custPageMode", v);
  };

  const load = useCallback(() => {
    Promise.all([
      allRec<Customer>("customers"),
      listCarpenters(),
      allRec<Doc>("quotations"),
      allRec<Doc>("invoices"),
      allRec<Expense>("expenses"),
    ]).then(([c, carp, q, i, e]) => {
      c.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      setList(c);
      setCarpenters(carp);
      setQuotes(q);
      setInvs(i);
      setExpenses(e);
    });
  }, []);
  useEffect(() => {
    load();
  }, [load, dataVersion]);

  async function addCustomer() {
    const c = await editCustomerDialog();
    if (c) {
      load();
      bumpData();
    }
  }
  async function addCarpenter() {
    const c = await editCarpenterDialog();
    if (c) {
      load();
      bumpData();
    }
  }
  async function editCarpenter(e: React.MouseEvent, c: Carpenter) {
    e.stopPropagation();
    const next = await editCarpenterDialog(c);
    if (next) {
      load();
      bumpData();
    }
  }
  async function removeCarpenter(e: React.MouseEvent, c: Carpenter) {
    e.stopPropagation();
    const ok = await confirmDialog({
      title: "Delete " + c.name + "?",
      message: "Removes this carpenter contact only.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await deleteCarpenter(c.id);
    load();
    bumpData();
  }
  function waCarpenter(e: React.MouseEvent, c: Carpenter) {
    e.stopPropagation();
    if (!c.phone) return;
    window.open(waLink(c.phone, "Hello " + (c.name || "")), "_blank");
  }

  const invoiceMode = getFeatures().invoices;
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
    await delRec("customers", c.id);
    load();
  }

  const entries = applyCustSearch(cloakMoney ? [] : list, searchTerm).map((c) => ({
    c,
    f: customerFinancials(c.id, quotes, invs, c.opening || 0, expenses, quotesAsBills),
  }));
  if (sortBy === "due") entries.sort((a, b) => b.f.outstanding - a.f.outstanding || (a.c.name || "").localeCompare(b.c.name || ""));

  const carpList = applyCarpSearch(cloakMoney ? [] : carpenters, searchTerm);

  return (
    <div>
      <div className="sectitle">
        {mode === "customers" ? (
          <>
            Customers <small>— {list.length} contact{list.length === 1 ? "" : "s"}</small>
          </>
        ) : (
          <>
            Carpenters <small>— {carpenters.length} contact{carpenters.length === 1 ? "" : "s"}</small>
          </>
        )}
      </div>
      <div className="rowbtns" style={{ alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div className="db-seg sm" role="group" aria-label="Customers or carpenters">
          <button className={"seg-btn" + (mode === "customers" ? " on" : "")} type="button" onClick={() => pickMode("customers")}>
            Customers
          </button>
          <button className={"seg-btn" + (mode === "carpenters" ? " on" : "")} type="button" onClick={() => pickMode("carpenters")}>
            Carpenters
          </button>
        </div>
        {mode === "customers" ? (
          <button className="btn primary sm" onClick={addCustomer}>
            + Add customer
          </button>
        ) : (
          <button className="btn primary sm" onClick={addCarpenter}>
            + Add carpenter
          </button>
        )}
        {mode === "customers" && (
          <div className="db-seg sm" style={{ marginLeft: "auto" }} role="group" aria-label="Sort customers">
            <button className={"seg-btn" + (sortBy === "az" ? " on" : "")} type="button" onClick={() => pickSort("az")}>
              A–Z
            </button>
            <button className={"seg-btn" + (sortBy === "due" ? " on" : "")} type="button" onClick={() => pickSort("due")}>
              Outstanding first
            </button>
          </div>
        )}
      </div>

      {mode === "customers" ? (
        <div className="custgrid">
          {entries.length ? (
            entries.map(({ c, f }) => (
              <div className="custcard" key={c.id} onClick={() => router.push("/customers/" + c.id)} style={{ cursor: "pointer" }}>
                <h3>{c.name}</h3>
                <div className="ph">{c.phone || "—"}</div>
                <div className="meta2">
                  {c.site && (
                    <>
                      Carpenter: {c.site}
                      {c.sitePhone ? " · " + c.sitePhone : ""}
                      {(c.siteVillage || c.siteCity) &&
                        " · " + [c.siteVillage, c.siteCity].filter(Boolean).join(", ")}
                      <br />
                    </>
                  )}
                  <b>{f.quoteCount}</b> quote{f.quoteCount === 1 ? "" : "s"}
                  {invoiceMode && (
                    <>
                      {" "}
                      · <b>{f.invoiceCount}</b> invoice{f.invoiceCount === 1 ? "" : "s"}
                    </>
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
            ))
          ) : (
            <div className="empty">
              <div className="empty-icon">👥</div>
              <div className="empty-title">No customers yet</div>
              <div className="empty-note">They&apos;re saved automatically when you make a quotation, or add one now.</div>
            </div>
          )}
        </div>
      ) : (
        <div className="custgrid">
          {carpList.length ? (
            carpList.map((c) => (
              <div className="custcard" key={c.id} style={{ cursor: "default" }}>
                <h3>{c.name}</h3>
                <div className="ph">{c.phone || "—"}</div>
                <div className="meta2">
                  {(c.village || c.city) && (
                    <>
                      {[c.village, c.city].filter(Boolean).join(", ")}
                      <br />
                    </>
                  )}
                  {c.notes && <>Note: {c.notes}</>}
                </div>
                <div className="links">
                  <button className="btn sm" onClick={(e) => editCarpenter(e, c)}>
                    Edit
                  </button>
                  {c.phone && (
                    <button className="btn wa sm" onClick={(e) => waCarpenter(e, c)}>
                      WhatsApp
                    </button>
                  )}
                  <button className="btn warn sm" onClick={(e) => removeCarpenter(e, c)}>
                    Delete
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="empty">
              <div className="empty-icon">🪚</div>
              <div className="empty-title">No carpenters yet</div>
              <div className="empty-note">Add a carpenter with name, phone, village, and city — no customer needed.</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
