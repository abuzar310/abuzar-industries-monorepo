"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec, delRec, getRec, prefGet, prefSet } from "@/lib/data";
import { inr } from "@/lib/calc";
import { createInvoiceForCustomer, createQuotationForCustomer } from "@/lib/create";
import { getFeatures } from "@/lib/features";
import { customerFinancials } from "@/lib/customers";
import { editCustomerDialog } from "@/lib/customer-form";
import { carpenterHref, carpenterKey, shopSelfCarpenter, shopSelfCustomer } from "@/lib/carpenter-financials";
import { editCarpenterDialog, listCarpenters, setCarpenterPhoto } from "@/lib/carpenters";
import { partyMatches } from "@/lib/party-search";
import { customerFollowupMessage, dialPhone, waLink } from "@/lib/whatsapp";
import { useApp } from "@/store/useApp";
import { bumpData, setSearch, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import PartySearchBar from "../PartySearchBar";
import PhotoField from "../PhotoField";
import type { Carpenter, Customer, Doc, Expense } from "@/lib/types";

type Mode = "customers" | "carpenters";

function customerFields(c: Customer) {
  return [c.name, c.phone, c.site, c.sitePhone, c.siteVillage, c.siteCity, c.address, c.notes, c.gstin, c.pincode];
}

function carpenterFields(c: Carpenter) {
  return [c.name, c.phone, c.phoneAlt, c.village, c.city, c.notes];
}

export default function CustomersView() {
  const { dataVersion, searchTerm, cloakMoney } = useApp();
  const router = useRouter();
  const [q, setQ] = useState(searchTerm);
  useEffect(() => {
    setQ(searchTerm);
  }, [searchTerm]);
  function pickQuery(v: string) {
    setQ(v);
    if (!v) setSearch("");
  }
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
  async function saveCarpPhoto(c: Carpenter, photo: string) {
    await setCarpenterPhoto(
      {
        record: c,
        name: c.name,
        phone: c.phone,
        phoneAlt: c.phoneAlt,
        village: c.village || "",
        city: c.city || "",
        notes: c.notes || "",
      },
      photo,
    );
    load();
    bumpData();
    toast(photo ? "Photo saved" : "Photo removed");
  }
  function waCarpenter(e: React.MouseEvent, c: Carpenter, phone?: string) {
    e.stopPropagation();
    const n = (phone || c.phone || "").trim();
    if (!n) return;
    window.open(waLink(n, "Hello " + (c.name || "")), "_blank");
  }
  function callCarpenter(e: React.MouseEvent, c: Carpenter, phone?: string) {
    const n = (phone || c.phone || "").trim();
    if (!n) return;
    dialPhone(n, e);
  }

  const carpTab = !!getFeatures().carpenters;
  const view: Mode = carpTab ? "customers" : mode;
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
    if (!c.phone) return;
    window.open(waLink(c.phone, customerFollowupMessage(c.name)), "_blank");
  }
  function callCustomer(e: React.MouseEvent, c: Customer) {
    if (!c.phone) return;
    dialPhone(c.phone, e);
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

  const query = q.trim();
  const entries = useMemo(() => {
    const src = cloakMoney
      ? []
      : list.filter((c) => !shopSelfCarpenter(c, carpenters) && partyMatches(query, customerFields(c)));
    const next = src.map((c) => ({
      c,
      f: customerFinancials(c.id, quotes, invs, c.opening || 0, expenses, quotesAsBills),
    }));
    if (sortBy === "due") next.sort((a, b) => b.f.outstanding - a.f.outstanding || (a.c.name || "").localeCompare(b.c.name || ""));
    return next;
  }, [cloakMoney, list, carpenters, query, quotes, invs, expenses, quotesAsBills, sortBy]);
  const carpHits = useMemo(() => {
    if (cloakMoney) return [];
    return carpenters.filter((t) => {
      const acct = shopSelfCustomer(t, list);
      if (!acct) return false;
      return partyMatches(query, [...customerFields(acct), ...carpenterFields(t)]);
    });
  }, [cloakMoney, query, carpenters, list]);

  const carpList = useMemo(
    () => (cloakMoney ? [] : carpenters.filter((c) => partyMatches(query, carpenterFields(c)))),
    [cloakMoney, carpenters, query],
  );

  return (
    <div>
      <div className="sectitle">
        {view === "customers" ? (
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
        {!carpTab && (
          <div className="db-seg sm" role="group" aria-label="Customers or carpenters">
            <button className={"seg-btn" + (view === "customers" ? " on" : "")} type="button" onClick={() => pickMode("customers")}>
              Customers
            </button>
            <button className={"seg-btn" + (view === "carpenters" ? " on" : "")} type="button" onClick={() => pickMode("carpenters")}>
              Carpenters
            </button>
          </div>
        )}
        {view === "customers" ? (
          <button className="btn primary sm" onClick={addCustomer}>
            + Add customer
          </button>
        ) : (
          <button className="btn primary sm" onClick={addCarpenter}>
            + Add carpenter
          </button>
        )}
        {view === "customers" && (
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

      <PartySearchBar
        value={q}
        onChange={pickQuery}
        placeholder={view === "customers" ? "Search name, phone, carpenter, GSTIN…" : "Search name, phone, village…"}
        count={view === "customers" ? entries.length + carpHits.length : carpList.length}
        total={view === "customers" ? list.filter((c) => !shopSelfCarpenter(c, carpenters)).length : carpenters.length}
      />

      {view === "customers" ? (
        <>
        <div className="custgrid">
          {entries.length || carpHits.length ? (
            <>
            {carpHits.map((t) => {
              const acct = shopSelfCustomer(t, list);
              return (
                <div
                  className="custcard"
                  key={t.id}
                  onClick={() => router.push(carpenterHref(carpenterKey(t.name), t.id))}
                  style={{ cursor: "pointer" }}
                >
                  <h3>{t.name}</h3>
                  <div className="ph">{t.phone || "—"}</div>
                  <div className="meta2">Carpenter{t.placeRent ? " · rent" : ""}</div>
                  <div className="links">
                    {acct ? (
                      <button
                        className="btn sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push("/customers/" + acct.id);
                        }}
                      >
                        Account
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {entries.map(({ c, f }) => (
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
                  {c.phone ? (
                    <>
                      <button className="btn call sm" onClick={(e) => callCustomer(e, c)}>
                        Call
                      </button>
                      <button className="btn wa sm" onClick={(e) => whatsapp(e, c)}>
                        WhatsApp
                      </button>
                    </>
                  ) : null}
                  <button className="btn warn sm" onClick={(e) => remove(e, c)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
            </>
          ) : (
            <div className="empty">
              <div className="empty-icon">👥</div>
              <div className="empty-title">{query ? "No matches" : "No customers yet"}</div>
              <div className="empty-note">
                {query
                  ? "Try a name, phone digits, carpenter, or GSTIN."
                  : "They're saved automatically when you make a quotation, or add one now."}
              </div>
            </div>
          )}
        </div>
        </>
      ) : (
        <>
        <div className="custgrid">
          {carpList.length ? (
            carpList.map((c) => (
              <div className="custcard" key={c.id} style={{ cursor: "default" }}>
                <div className="carp-card-top">
                  <PhotoField
                    compact
                    size={72}
                    name={c.name}
                    value={c.photo || ""}
                    onChange={(url) => void saveCarpPhoto(c, url)}
                  />
                  <div className="carp-who">
                    <h3>{c.name}</h3>
                    <div className="ph">{c.phone || "—"}</div>
                    {c.phoneAlt ? <div className="ph">Alt {c.phoneAlt}</div> : null}
                  </div>
                </div>
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
                    <>
                      <button className="btn call sm" onClick={(e) => callCarpenter(e, c, c.phone)}>
                        Call
                      </button>
                      <button className="btn wa sm" onClick={(e) => waCarpenter(e, c, c.phone)}>
                        WhatsApp
                      </button>
                    </>
                  )}
                  {c.phoneAlt && c.phoneAlt !== c.phone && (
                    <>
                      <button className="btn call sm" onClick={(e) => callCarpenter(e, c, c.phoneAlt)}>
                        Call alt
                      </button>
                      <button className="btn wa sm" onClick={(e) => waCarpenter(e, c, c.phoneAlt)}>
                        Alt WhatsApp
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="empty">
              <div className="empty-icon">🪚</div>
              <div className="empty-title">{query ? "No matches" : "No carpenters yet"}</div>
              <div className="empty-note">
                {query
                  ? "Try a name, phone digits, village, or city."
                  : "Add a carpenter with name, phone, village, and city — no customer needed."}
              </div>
            </div>
          )}
        </div>
        </>
      )}
    </div>
  );
}
