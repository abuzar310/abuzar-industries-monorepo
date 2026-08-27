"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec, delRec, getRec } from "@/lib/data";
import { computeDoc, inr } from "@/lib/calc";
import { brandFor } from "@/lib/brand";
import { printOrSavePdf } from "@/lib/pdf";
import { createInvoiceForCustomer, createQuotationForCustomer } from "@/lib/create";
import { getFeatures } from "@/lib/features";
import { customerFinancials } from "@/lib/customers";
import { editCustomerDialog } from "@/lib/customer-form";
import { mergeReceiptPieces, quoteBill, type PartyStatement } from "@/lib/payments";
import { balanceReminderMessage, customerFollowupMessage, dialPhone, waLink } from "@/lib/whatsapp";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import type { Customer, Doc, Expense } from "@/lib/types";
import { Paged } from "../Pager";
import DocList from "./DocList";

export default function CustomerDetail({ id }: { id: string }) {
  const { ready, dataVersion, brandMode } = useApp();
  const router = useRouter();
  const [cust, setCust] = useState<Customer | null | undefined>(undefined);
  const [quotes, setQuotes] = useState<Doc[]>([]);
  const [invs, setInvs] = useState<Doc[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const printRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    Promise.all([
      getRec<Customer>("customers", id),
      allRec<Doc>("quotations"),
      allRec<Doc>("invoices"),
      allRec<Expense>("expenses"),
    ]).then(([c, q, i, e]) => {
      setCust(c ?? null);
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
      // the SETTLED figure: the agreed final price when one was fixed, else the computed
      // total — same rule as Balances (quoteBill), so the statement matches what's owed
      total: quoteBill(d),
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
      amount: quoteBill(d),
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
              {cust.site && (
                <>
                  Carpenter: {cust.site}
                  {cust.sitePhone ? " · " + cust.sitePhone : ""}
                  {(cust.siteVillage || cust.siteCity) &&
                    " · " + [cust.siteVillage, cust.siteCity].filter(Boolean).join(", ")}
                  <br />
                </>
              )}
              {cust.address && <>{cust.address}<br /></>}
              {cust.notes && <>Note: {cust.notes}</>}
            </div>
          </div>
          <div className="links" style={{ marginTop: 0 }}>
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
          <div className="sectitle" style={{ marginTop: 24, fontSize: 22, display: "flex", alignItems: "center", gap: 12 }}>
            <span>Account statement <small>— every bill &amp; payment, running balance</small></span>
            {canPrint && (
              <button
                className="btn sm"
                style={{ marginLeft: "auto" }}
                onClick={async () => {
                  if ((await printOrSavePdf(printRef.current, (cust!.name || "customer") + "-statement")) === "pdf") toast("Statement PDF downloaded \u2713");
                }}
              >
                Print / Save PDF
              </button>
            )}
          </div>
          <Paged items={stmtRows} resetKey={id}>
            {(view, info) => (
          <div className="panel-card cs-card">
            {opening > 0 && info.page === 0 && (
              <div className="stmt">
                <div className="stmt-ic due">₹</div>
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
                  {ev.kind === "quote" ? "Bill" : ev.pay === "upi" ? "UPI" : "₹"}
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

      <div className="sectitle" style={{ marginTop: 24, fontSize: 22 }}>
        <span>Quotations <small>— {quotes.length}</small></span>
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
        <div className="cd-print rep-doc cd-qreport" ref={printRef}>
          <div className="rep-head">
            <div className="rep-brand">
              <h1>{brand.name || "Quotations"}</h1>
              {brand.addr && <div>{brand.addr}</div>}
              {brand.gstin && <div>GSTIN: {brand.gstin}</div>}
            </div>
            <div className="rep-meta">
              <div className="rep-title">Account Statement</div>
              <div className="rep-period">{cust.name}{cust.phone ? " · " + cust.phone : ""}</div>
            </div>
          </div>

          <div className="rep-summary cols4">
            <div><b>{qreport.length}</b><span>Quotations</span></div>
            <div><b>₹{inr(grandTotal)}</b><span>Billed{opening > 0 ? " (incl. opening)" : ""}</span></div>
            <div><b>₹{inr(paidTotal)}</b><span>Received</span></div>
            <div><b>₹{inr(balanceDue)}</b><span>Balance due</span></div>
          </div>

          {/* the SAME statement as on screen: opening → every bill & payment, running balance */}
          <table className="rep-table">
            <colgroup>
              <col style={{ width: "5%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "34%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "16%" }} />
            </colgroup>
            <thead>
              <tr>
                <th className="c-n">#</th>
                <th>Date</th>
                <th>Entry</th>
                <th className="amt">Billed ₹</th>
                <th className="amt">Received ₹</th>
                <th className="amt">Balance ₹</th>
              </tr>
            </thead>
            <tbody>
              {opening > 0 && (
                <tr className="rep-op">
                  <td className="c-n">—</td>
                  <td className="c-date">—</td>
                  <td className="c-no">Opening Balance</td>
                  <td className="amt">{inr(opening)}</td>
                  <td className="amt">—</td>
                  <td className="amt">{inr(opening)}</td>
                </tr>
              )}
              {stmtRows.map((ev, i) => (
                <tr key={ev.kind + ev.id}>
                  <td className="c-n">{i + 1}</td>
                  <td className="c-date">{ev.date}</td>
                  <td className="c-cust">
                    {ev.kind === "quote" ? ev.label + (ev.sub ? " · " + ev.sub : "") : "Received · " + [ev.label, ev.sub].filter(Boolean).join(" · ")}
                  </td>
                  <td className="amt">{ev.kind === "quote" ? inr(ev.amount) : ""}</td>
                  <td className="amt">{ev.kind === "pay" ? inr(ev.amount) : ""}</td>
                  <td className="amt">{inr(ev.bal)}</td>
                </tr>
              ))}
              <tr className="rep-tot">
                <td colSpan={3}>Total</td>
                <td className="amt">{inr(grandTotal)}</td>
                <td className="amt">{inr(paidTotal)}</td>
                <td className="amt">{inr(balanceDue)}</td>
              </tr>
              <tr className="rep-tot">
                <td colSpan={5}>{balanceDue > 0.5 ? "Balance due" : balanceDue < -0.5 ? "Advance held" : "Settled"}</td>
                <td className="amt">{inr(Math.abs(balanceDue))}</td>
              </tr>
            </tbody>
          </table>

          <div className="rep-foot">Generated {genOn} · {brand.name}</div>
        </div>
      )}
    </div>
  );
}
