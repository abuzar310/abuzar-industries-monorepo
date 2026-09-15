"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec, delRec, getRec } from "@/lib/data";
import { computeDoc, inr } from "@/lib/calc";
import { brandFor } from "@/lib/brand";
import { generatePdf } from "@/lib/pdf";
import { createInvoiceForCustomer, createQuotationForCustomer } from "@/lib/create";
import { getFeatures } from "@/lib/features";
import { carpenterHref, carpenterKey, shopSelfCarpenter } from "@/lib/carpenter-financials";
import { listCarpenters } from "@/lib/carpenters";
import { customerFinancials } from "@/lib/customers";
import { editCustomerDialog } from "@/lib/customer-form";
import { mergeReceiptPieces, quoteOwnBill, type PartyStatement } from "@/lib/payments";
import { balanceReminderMessage, customerFollowupMessage, dialPhone, waLink } from "@/lib/whatsapp";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import type { Carpenter, Customer, Doc, Expense } from "@/lib/types";
import { Paged } from "../Pager";
import PassbookPrint, { type PassbookLine } from "../PassbookPrint";
import PdfButtons from "../PdfButtons";
import { TabIcon } from "../Icons";
import DocList from "./DocList";

export default function CustomerDetail({ id }: { id: string }) {
  const { ready, dataVersion, brandMode } = useApp();
  const router = useRouter();
  const [cust, setCust] = useState<Customer | null | undefined>(undefined);
  const [twin, setTwin] = useState<Carpenter | undefined>(undefined);
  const [quotes, setQuotes] = useState<Doc[]>([]);
  const [invs, setInvs] = useState<Doc[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const printRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    Promise.all([
      getRec<Customer>("customers", id),
      listCarpenters(),
      allRec<Doc>("quotations"),
      allRec<Doc>("invoices"),
      allRec<Expense>("expenses"),
    ]).then(([c, carps, q, i, e]) => {
      setCust(c ?? null);
      setTwin(c ? shopSelfCarpenter(c, carps) : undefined);
      const myQuotes = q.filter((d) => d.customerId === id);
      const qids = new Set(myQuotes.map((d) => d.id));
      setQuotes(myQuotes.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")));
      setInvs(i.filter((d) => d.customerId === id).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")));
      // this customer's money: account receipts/dues (custId) + payments on their quotes (sourceId)
      setExpenses(e.filter((x) => x.custId === id || (x.sourceId ? qids.has(x.sourceId) : false)));
    });
  }, [id]);
  useEffect(() => {
    if (ready) load();
  }, [ready, dataVersion, load]);

  if (cust === undefined) return <div className="ph-kit"><div className="sectitle">Customer <small><span className="desk-only">— </span>loading…</small></div></div>;
  if (cust === null)
    return (
      <div className="ph-kit">
      <div className="empty">
        <div className="empty-title">Customer not found</div>
        <button className="btn sm" style={{ marginTop: 12 }} onClick={() => router.push("/customers")}>
          ← Back to customers
        </button>
      </div>
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
      // the SETTLED figure: the agreed final price when one was fixed, else the computed
      // total — same rule as Balances (quoteBill), so the statement matches what's owed
      total: quoteOwnBill(d),
    };
  });
  const qtot = qreport.reduce(
    (s, r) => ({ cft: s.cft + r.cft, total: s.total + r.total }),
    { cft: 0, total: 0 },
  );
  const grandTotal = Math.round((qtot.total + opening) * 100) / 100;
  // every payment received from this customer — split receipts shown as the ONE amount taken
  const quoteNoById = new Map(quotes.map((d) => [d.id, d.number] as const));
  const payLines: PartyStatement[] = mergeReceiptPieces(
    expenses
      .filter((e) => e.type === "sale" && !e.charge)
      .map((e) => ({
        id: e.id,
        amount: +e.amount || 0,
        mode: e.mode,
        account: e.account || "",
        date: e.date,
        at: e.createdAt || "",
        by: e.enteredBy,
        quoteNo: e.sourceId ? quoteNoById.get(e.sourceId) || "" : "",
        note: e.label || "",
        toOwner: !!e.toOwner,
        rcptId: e.rcptId,
      })),
  ).sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  const paidTotal = Math.round(payLines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  const balanceDue = Math.round((grandTotal - paidTotal) * 100) / 100;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  // Daybook-style account statement: opening → every bill & payment chronologically,
  // with a running balance after each line (ends exactly at the Outstanding figure)
  interface StmtEv {
    key: string; // sortable timestamp
    kind: "quote" | "pay";
    /** payment mode — picks the icon (UPI / ₹ cash) */
    pay?: "upi" | "cash";
    date: string;
    label: string;
    sub: string;
    amount: number;
    id: string;
  }
  const stmtEvents: StmtEv[] = [
    ...quotes.map((d): StmtEv => ({
      key: d.createdAt || "",
      kind: "quote",
      date: d.date,
      label: "Quotation #" + (d.number || d.id),
      sub: d.site ? "Carpenter: " + d.site : "",
      amount: quoteOwnBill(d),
      id: d.id,
    })),
    ...payLines.map((l): StmtEv => ({
      key: l.at || "",
      kind: "pay",
      pay: l.mode === "upi" ? "upi" : "cash",
      date: l.date,
      label: l.mode === "upi" ? l.account || "UPI account" : l.toOwner ? "Cash → Owner" : "Cash",
      sub: (l.note || "").split(" · ").filter((s) => !s.startsWith("settled") && !s.startsWith("on account")).join(" · "),
      amount: l.amount,
      id: l.id,
    })),
  ].sort((a, b) => a.key.localeCompare(b.key));
  const stmtRows = stmtEvents.reduce<{ rows: (StmtEv & { bal: number })[]; bal: number }>(
    (acc, ev) => {
      const bal = r2(acc.bal + (ev.kind === "quote" ? ev.amount : -ev.amount));
      return { rows: [...acc.rows, { ...ev, bal }], bal };
    },
    { rows: [], bal: opening },
  ).rows;
  const canPrint = quotes.length > 0 || opening > 0;
  const custName = cust.name || "customer";
  const stmtPdfRows: PassbookLine[] = [
    ...(opening > 0
      ? [{ key: "open", date: "", who: "Opening Balance", debit: 0, credit: 0, balance: opening, open: true }]
      : []),
    ...stmtRows.map((ev) => ({
      key: ev.kind + ev.id,
      date: ev.date,
      who: ev.kind === "quote" ? "To " + ev.label : "By " + ev.label,
      detail: ev.sub || "",
      debit: ev.kind === "quote" ? ev.amount : 0,
      credit: ev.kind === "pay" ? ev.amount : 0,
      balance: ev.bal,
    })),
    {
      key: "close",
      date: "",
      who: balanceDue > 0.5 ? "Balance due" : balanceDue < -0.5 ? "Advance held" : "Settled",
      debit: 0,
      credit: 0,
      balance: balanceDue,
      close: true,
    },
  ];

  async function runStmtPdf(preview: boolean) {
    if (!printRef.current) return;
    if (!preview) toast("Preparing PDF…");
    try {
      await generatePdf(printRef.current, custName + "-statement", {
        pageBreak: ".bank-row,.acct-print-sum,.acct-print-hdr",
        width: 700,
        title: (brand.name || "Statement") + " — " + custName,
        marginMm: 8,
        preview,
      });
      if (!preview) toast("Statement PDF downloaded \u2713");
    } catch {
      toast("Could not create the PDF");
    }
  }

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
    if (!cust!.phone) return;
    window.open(waLink(cust!.phone, customerFollowupMessage(cust!.name)), "_blank");
  }
  function call() {
    if (!cust!.phone) return;
    dialPhone(cust!.phone);
  }
  /** Standard automated reminder: the account's balance pending from the total — nothing else. */
  function remind() {
    const msg = balanceReminderMessage({
      name: cust!.name,
      total: grandTotal,
      received: paidTotal,
      balance: balanceDue,
    });
    window.open(waLink(cust!.phone, msg), "_blank");
  }
  async function remove() {
    const ok = await confirmDialog({
      title: "Delete " + cust!.name + "?",
      message: "Their quotations and invoices are kept; only the contact is removed.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await delRec("customers", cust!.id); // soft delete — the row stays recoverable in the database
    toast("Customer deleted");
    router.push("/customers");
  }

  return (
    <div className="ph-kit">
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
              {twin ? (
                <>
                  Carpenter
                  {twin.placeRent ? " · rent" : ""}
                  <br />
                </>
              ) : cust.site ? (
                <>
                  Carpenter: {cust.site}
                  {cust.sitePhone ? " · " + cust.sitePhone : ""}
                  {(cust.siteVillage || cust.siteCity) &&
                    " · " + [cust.siteVillage, cust.siteCity].filter(Boolean).join(", ")}
                  <br />
                </>
              ) : null}
              {cust.address && <>{cust.address}<br /></>}
              {cust.notes && <>Note: {cust.notes}</>}
            </div>
          </div>
          <div className="links" style={{ marginTop: 0 }}>
            {twin ? (
              <button
                className="btn sm"
                onClick={() => router.push(carpenterHref(carpenterKey(twin.name), twin.id))}
              >
                Open carpenter
              </button>
            ) : null}
            <button className="btn primary sm" onClick={newDoc}>{invoiceMode ? "New invoice" : "New quote"}</button>
            {cust.phone ? (
              <>
                <button className="btn call sm" onClick={call}>Call</button>
                <button className="btn wa sm" onClick={whatsapp}>WhatsApp</button>
              </>
            ) : null}
            {f.outstanding > 0.5 && (
              <button className="btn wa sm" onClick={remind} title="WhatsApp just the balance figures — total, payments, pending">
                Remind
              </button>
            )}
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

      {(stmtRows.length > 0 || opening > 0) && (
        <>
          <div className="sectitle sectitle-sub cd-stmt-head">
            <span className="phone-ico ph-only"><TabIcon icon="statement" size={16} /></span>
            <span>Account statement <small><span className="desk-only">— </span>every bill &amp; payment, running balance</small></span>
            {canPrint && (
              <span className="cd-stmt-pdf" style={{ marginLeft: "auto", display: "inline-flex", gap: 8 }}>
                <PdfButtons
                  onPreview={() => void runStmtPdf(true)}
                  onDownload={() => void runStmtPdf(false)}
                />
              </span>
            )}
          </div>
          <Paged items={stmtRows} resetKey={id}>
            {(view, info) => (
          <div className="panel-card cs-card">
            {opening > 0 && info.page === 0 && (
              <div className="stmt">
                <div className="stmt-ic due"><span className="desk-only">₹</span><TabIcon icon="scale" size={16} className="ph-only" /></div>
                <div className="stmt-main">
                  <div className="stmt-to">Opening balance</div>
                  <div className="stmt-sub">old dues from before the app</div>
                </div>
                <div className="cs-amt">
                  <div className="stmt-amt due">+₹{inr(opening)}</div>
                  <small className="cs-runbal">bal ₹{inr(opening)}</small>
                </div>
              </div>
            )}
            {view.map((ev) => (
              <div
                className="stmt"
                key={ev.kind + ev.id}
                style={ev.kind === "quote" ? { cursor: "pointer" } : undefined}
                onClick={ev.kind === "quote" ? () => router.push("/editor/" + ev.id) : undefined}
                title={ev.kind === "quote" ? "Open this quotation" : undefined}
              >
                <div className={"stmt-ic " + (ev.kind === "quote" ? "due" : ev.pay === "upi" ? "upi" : "cash")}>
                  <span className="desk-only">{ev.kind === "quote" ? "Bill" : ev.pay === "upi" ? "UPI" : "₹"}</span>
                  <TabIcon icon={ev.kind === "quote" ? "file-text" : ev.pay === "upi" ? "payments" : "wallet"} size={16} className="ph-only" />
                </div>
                <div className="stmt-main">
                  <div className="stmt-to">{ev.label}{ev.sub ? <span className="acct-overall-hint"> · {ev.sub}</span> : null}</div>
                  <div className="stmt-sub">{ev.date}</div>
                </div>
                <div className="cs-amt">
                  <div className={"stmt-amt" + (ev.kind === "quote" ? " due" : "")}>
                    {ev.kind === "quote" ? "+" : "−"}₹{inr(ev.amount)}
                  </div>
                  <small className="cs-runbal">bal ₹{inr(ev.bal)}</small>
                </div>
              </div>
            ))}
            <div className="cs-sum">
              <span>Billed <b>₹{inr(grandTotal)}</b></span>
              <span>Received <b className="in">₹{inr(paidTotal)}</b></span>
              <span className="cs-due">
                {balanceDue > 0.5 ? "Balance due ₹" + inr(balanceDue) : balanceDue < -0.5 ? "Advance ₹" + inr(-balanceDue) : "Settled ✓"}
              </span>
            </div>
          </div>
            )}
          </Paged>
        </>
      )}

      <div className="sectitle sectitle-sub">
        <span className="phone-ico ph-only"><TabIcon icon="clipboard" size={16} /></span>
        <span>Quotations <small><span className="desk-only">— </span>{quotes.length}</small></span>
      </div>
      <div className="listwrap">
        <DocList docs={quotes} empty="No quotations for this customer yet." />
      </div>

      {invoiceMode && (
        <>
          <div className="sectitle sectitle-sub">
            <span className="phone-ico ph-only"><TabIcon icon="invoices" size={16} /></span>
            Invoices <small><span className="desk-only">— </span>{invs.length}</small>
          </div>
          <div className="listwrap">
            <DocList docs={invs} empty="No invoices for this customer yet." />
          </div>
        </>
      )}
      </div>

      {canPrint && (
        <PassbookPrint
          printRef={printRef}
          summary={[
            { k: "Quotations", v: String(qreport.length) },
            { k: "Billed", v: "₹ " + inr(grandTotal) },
            { k: "Received", v: "₹ " + inr(paidTotal) },
            { k: "Balance", v: "₹ " + inr(balanceDue) },
          ]}
          rows={stmtPdfRows}
        />
      )}
    </div>
  );
}
