"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clone, delRec, metaSet, put } from "@/lib/db";
import { computeDoc, inr, nowIso } from "@/lib/calc";
import { STATUSES } from "@/lib/constants";
import { brandFor } from "@/lib/brand";
import { useApp } from "@/store/useApp";
import { docStore } from "@/lib/doc";
import { nextNumber } from "@/lib/numbering";
import { cloudDelete, setOpenDoc, trySync } from "@/lib/cloud";
import { upsertCustomerFromDoc } from "@/lib/customers";
import { maybeDeductStock } from "@/lib/stock";
import { createInvoice, createQuotation } from "@/lib/create";
import { getFeatures } from "@/lib/features";
import { addExpense } from "@/lib/expenses";
import { quoteMessage, reminderMessage, waLink } from "@/lib/whatsapp";
import { generatePdf } from "@/lib/pdf";
import { folderConnected, saveCopyToFolder, writeDbSnapshot } from "@/lib/backup";
import { setSyncState, toast } from "@/store/app-store";
import { confirmDialog, formDialog } from "@/store/dialog-store";
import type { Doc } from "@/lib/types";
import SectionCard from "./SectionCard";
import Totals from "./Totals";
import MoreMenu from "./MoreMenu";

const DIMCOLS: ("l" | "w" | "t" | "pcs")[] = ["l", "w", "t", "pcs"];

const STATUS_BADGE: Record<string, string> = {
  Draft: "b-draft",
  Created: "b-confirm",
  Sent: "b-sent",
  "Follow-up Pending": "b-follow",
  Confirmed: "b-confirm",
  Rejected: "b-reject",
  "Converted to Invoice": "b-conv",
};
const PAY_BADGE: Record<string, string> = { Paid: "b-paid", Pending: "b-pending", Partial: "b-partial" };

export default function Editor({ initialDoc, action }: { initialDoc: Doc; action?: string }) {
  const router = useRouter();
  const [doc, setDoc] = useState<Doc>(initialDoc);
  const docRef = useRef(doc);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sheetRef = useRef<HTMLDivElement>(null);
  const secRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<{ si: number; ri: number; k: string } | null>(null);
  const [editingNo, setEditingNo] = useState(false);
  const [payCash, setPayCash] = useState("");
  const [payUpi, setPayUpi] = useState("");

  const feat = getFeatures();
  const isInv = doc.kind === "invoice";
  const totals = useMemo(() => computeDoc(doc), [doc]);
  const { brandMode, user } = useApp();
  const brand = brandFor(brandMode);

  // track the open doc so background pulls don't clobber it
  useEffect(() => {
    setOpenDoc(doc.id, docStore(doc));
    return () => setOpenDoc("", "");
  }, [doc.id, doc.kind]);

  // apply queued focus after a row is added / re-rendered
  useEffect(() => {
    const f = pendingFocus.current;
    if (f) {
      pendingFocus.current = null;
      focusDim(f.si, f.ri, f.k);
    }
  });

  // ---- persistence ----
  function persist(d: Doc) {
    d.updatedAt = nowIso();
    d.synced = false;
    put(docStore(d), clone(d));
    setSyncState("queue");
    trySync();
  }
  function scheduleSave() {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(docRef.current), 350);
  }
  function commit(next: Doc, immediate = false) {
    docRef.current = next;
    setDoc(next);
    if (immediate) persist(next);
    else scheduleSave();
  }
  function update(producer: (d: Doc) => void) {
    const next = clone(docRef.current);
    producer(next);
    commit(next);
  }

  // ---- field handlers ----
  const setField = (k: keyof Doc, v: string) =>
    update((d) => ((d as unknown as Record<string, unknown>)[k] = v));
  const onName = (si: number, v: string) => update((d) => (d.sections[si].name = v));
  const onRate = (si: number, v: string) => update((d) => (d.sections[si].rate = v));
  const onCell = (si: number, ri: number, k: "l" | "w" | "t" | "pcs", v: string) => {
    const clean = v.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
    update((d) => (d.sections[si].rows[ri][k] = clean));
  };
  const onAddRow = (si: number) => update((d) => d.sections[si].rows.push({ l: "", w: "", t: "", pcs: "" }));
  const onDelRow = (si: number, ri: number) =>
    update((d) => {
      d.sections[si].rows.splice(ri, 1);
      if (!d.sections[si].rows.length) d.sections[si].rows.push({ l: "", w: "", t: "", pcs: "" });
    });
  const onDelSec = (si: number) => update((d) => d.sections.length > 1 && d.sections.splice(si, 1));
  const onAddSec = () =>
    update((d) =>
      d.sections.push({ name: "Wood type " + (d.sections.length + 1), rate: 0, rows: [{ l: "", w: "", t: "", pcs: "" }] }),
    );

  // ---- arrow-key grid navigation (identical behaviour to legacy) ----
  function findDim(si: number, ri: number, k: string) {
    return secRef.current?.querySelector<HTMLInputElement>(
      `input.dim[data-si="${si}"][data-ri="${ri}"][data-k="${k}"]`,
    );
  }
  function focusDim(si: number, ri: number, k: string) {
    const el = findDim(si, ri, k);
    if (el) {
      el.focus();
      const v = el.value;
      try {
        el.setSelectionRange(v.length, v.length);
      } catch {}
    }
    return !!el;
  }
  function onGridKeyDown(e: React.KeyboardEvent) {
    const t = e.target as HTMLInputElement;
    if (!t.classList || !t.classList.contains("dim")) return;
    const c = e.nativeEvent.code || "";
    const up = c === "ArrowUp" || (!c && e.key === "ArrowUp");
    const down = c === "ArrowDown" || (!c && e.key === "ArrowDown");
    const left = c === "ArrowLeft" || (!c && e.key === "ArrowLeft");
    const right = c === "ArrowRight" || (!c && e.key === "ArrowRight");
    const enter = c === "Enter" || c === "NumpadEnter" || (!c && e.key === "Enter");
    if (!(up || down || left || right || enter)) return;
    const si = +t.dataset.si!;
    const ri = +t.dataset.ri!;
    const ci = DIMCOLS.indexOf(t.dataset.k as "l");
    const d = docRef.current;
    if (ci < 0 || !d.sections[si]) return;
    const rows = d.sections[si].rows.length;
    let cs: number | null = null,
      ce: number | null = null;
    try {
      cs = t.selectionStart;
      ce = t.selectionEnd;
    } catch {}
    const atStart = cs === 0 && ce === 0;
    const atEnd = cs === t.value.length && ce === t.value.length;
    const addRowAndFocus = (k: "l" | "w" | "t" | "pcs") => {
      pendingFocus.current = { si, ri: ri + 1, k };
      onAddRow(si);
    };
    if (up) {
      e.preventDefault();
      if (ri > 0) focusDim(si, ri - 1, DIMCOLS[ci]);
    } else if (down || enter) {
      e.preventDefault();
      if (ri < rows - 1) focusDim(si, ri + 1, DIMCOLS[ci]);
      else addRowAndFocus(DIMCOLS[ci]);
    } else if (right) {
      if (atEnd) {
        e.preventDefault();
        if (ci < DIMCOLS.length - 1) focusDim(si, ri, DIMCOLS[ci + 1]);
        else if (ri < rows - 1) focusDim(si, ri + 1, DIMCOLS[0]);
        else addRowAndFocus(DIMCOLS[0]);
      }
    } else if (left) {
      if (atStart) {
        e.preventDefault();
        if (ci > 0) focusDim(si, ri, DIMCOLS[ci - 1]);
        else if (ri > 0) focusDim(si, ri - 1, DIMCOLS[DIMCOLS.length - 1]);
      }
    }
  }

  // ---- status / payment ----
  const onStatus = (v: string) => update((d) => (d.status = v));
  const onTradeType = (v: string) => update((d) => (d.tradeType = v === "buy" ? "buy" : "sell"));
  async function onPayment(v: string) {
    const next = clone(docRef.current);
    next.paymentStatus = v;
    if (v === "Paid") {
      next.amountPaid = computeDoc(next).grand;
      const deducted = await maybeDeductStock(next);
      if (deducted) toast("Stock deducted for " + next.number);
    }
    commit(next);
  }

  // ---- document number inline edit ----
  function commitNumber(raw: string) {
    setEditingNo(false);
    const v = raw.trim();
    if (!v || v === doc.number) return;
    const oldStore = docStore(docRef.current);
    const oldId = docRef.current.id;
    const next = clone(docRef.current);
    next.number = v;
    next.id = v;
    delRec(oldStore, oldId);
    persist(next);
    docRef.current = next;
    setDoc(next);
    metaSet("lastOpen", { store: docStore(next), id: v });
    router.replace("/editor/" + v);
  }

  // ---- App A: single-source save (Draft / Create) + accept payment ----
  async function setStatusAndSave(status: string, msg: string) {
    const next = clone(docRef.current);
    next.status = status;
    await upsertCustomerFromDoc(next);
    commit(next, true);
    if (folderConnected()) {
      try {
        await writeDbSnapshot();
      } catch {}
    }
    toast(msg);
  }
  const onSaveDraft = () => setStatusAndSave("Draft", "Saved as draft");
  const onCreate = () => setStatusAndSave("Created", "Quotation " + docRef.current.number + " created ✓");

  async function onAcceptPayment() {
    const grand = computeDoc(docRef.current).grand;
    const cash = Math.max(0, +payCash || 0);
    const upi = Math.max(0, +payUpi || 0);
    if (cash + upi <= 0) return toast("Enter a cash or UPI amount");
    const cust = (docRef.current.customerName || "").trim() || "Walk-in";
    const note = cust + " · " + docRef.current.number;
    const by = user?.id || "unknown";
    if (cash > 0) await addExpense({ type: "sale", amount: cash, mode: "cash", note, enteredBy: by });
    if (upi > 0) await addExpense({ type: "sale", amount: upi, mode: "upi", note, enteredBy: by });
    const next = clone(docRef.current);
    next.payCash = cash;
    next.payUpi = upi;
    next.amountPaid = Math.round((cash + upi) * 100) / 100;
    next.paidLogged = true;
    next.paymentStatus = next.amountPaid + 0.001 >= grand ? "Paid" : "Partial";
    commit(next, true);
    setPayCash("");
    setPayUpi("");
    toast("Payment recorded · added to Daybook");
  }

  // ---- actions ----
  async function onSaveClick() {
    const next = clone(docRef.current);
    await upsertCustomerFromDoc(next);
    commit(next, true);
    if (folderConnected()) {
      try {
        await writeDbSnapshot();
      } catch {}
    }
    toast(
      "Saved ✓  " + next.number + " — reopen from " + (next.kind === "invoice" ? "Invoices" : "Quotations") + " to edit",
    );
  }
  async function onPrint() {
    const next = clone(docRef.current);
    await upsertCustomerFromDoc(next);
    commit(next, true);
    window.print();
  }
  async function onPdf() {
    const next = clone(docRef.current);
    try {
      await upsertCustomerFromDoc(next);
      commit(next, true);
    } catch {}
    try {
      if (sheetRef.current) await generatePdf(sheetRef.current, next.number);
      toast("PDF downloaded ✓");
    } catch (e) {
      toast("PDF error: " + ((e as Error)?.message || e));
    }
  }
  async function onWaSend() {
    const next = clone(docRef.current);
    await upsertCustomerFromDoc(next);
    commit(next, true);
    window.open(waLink(next.phone, quoteMessage(next)), "_blank");
  }
  function onWaRemind() {
    window.open(waLink(doc.phone, reminderMessage(doc)), "_blank");
  }
  async function onConvert() {
    if (docRef.current.kind === "invoice") return;
    const cur = clone(docRef.current);
    await upsertCustomerFromDoc(cur);
    const invId = await nextNumber("invoice");
    const inv = clone(cur);
    inv.id = invId;
    inv.number = invId;
    inv.kind = "invoice";
    inv.quotationId = cur.id;
    inv.status = "Converted to Invoice";
    inv.paymentStatus = "Pending";
    inv.amountPaid = 0;
    inv.stockDeducted = false;
    inv.createdAt = nowIso();
    inv.updatedAt = nowIso();
    inv.synced = false;
    await put("invoices", inv);
    cur.status = "Converted to Invoice";
    cur.updatedAt = nowIso();
    cur.synced = false;
    await put("quotations", clone(cur));
    await metaSet("lastOpen", { store: "invoices", id: invId });
    trySync();
    toast("Invoice " + invId + " created · prices locked");
    router.push("/editor/" + invId);
  }
  async function onRecordPayment() {
    const grand = computeDoc(docRef.current).grand;
    const cur = +docRef.current.amountPaid || 0;
    const res = await formDialog({
      title: "Record payment",
      message: `${docRef.current.number} · Grand total ₹${inr(grand)}`,
      fields: [
        {
          name: "amount",
          label: "Total received so far (₹)",
          type: "number",
          inputMode: "decimal",
          value: cur ? String(cur) : "",
          placeholder: "0",
        },
      ],
      submitLabel: "Save payment",
    });
    if (res === null) return;
    const paid = Math.max(0, +res.amount || 0);
    const next = clone(docRef.current);
    next.amountPaid = paid;
    next.paymentStatus = paid <= 0 ? "Pending" : paid + 0.001 >= grand ? "Paid" : "Partial";
    if (next.paymentStatus === "Paid") {
      next.amountPaid = grand;
      await maybeDeductStock(next);
    }
    commit(next);
    toast("Payment recorded · " + next.paymentStatus);
  }
  async function onFolder() {
    if (!folderConnected()) {
      toast("Connect a data folder first (Settings)");
      router.push("/settings");
      return;
    }
    const next = clone(docRef.current);
    await upsertCustomerFromDoc(next);
    commit(next, true);
    try {
      const sub = await saveCopyToFolder(next);
      toast("Saved " + next.number + ".html to " + sub + "/");
    } catch {
      toast("Could not write file");
    }
  }
  async function onDelete() {
    const ok = await confirmDialog({
      title: "Delete " + doc.number + "?",
      message: "This permanently removes it from this device and the cloud. This cannot be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    const st = docStore(docRef.current);
    const id = docRef.current.id;
    await delRec(st, id);
    await cloudDelete(st, id);
    await metaSet("lastOpen", null);
    toast(doc.number + " deleted");
    router.push(st === "invoices" ? "/invoices" : "/quotations");
  }
  async function onNewQuote() {
    const d = await createQuotation();
    toast("New " + d.id + " created");
    router.push("/editor/" + d.id);
  }
  async function onNewInvoice() {
    const d = await createInvoice();
    toast("New invoice " + d.id + " created");
    router.push("/editor/" + d.id);
  }

  // ---- one-shot action requested from a list row (?action=print|wa) ----
  const ranAction = useRef(false);
  useEffect(() => {
    if (ranAction.current || !action) return;
    ranAction.current = true;
    if (action === "print") onPrint();
    else if (action === "wa") onWaSend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- fit-to-one-page on print ----
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const fit = () => {
      const probe = document.createElement("div");
      probe.style.cssText = "position:absolute;left:-9999px;top:0;width:190mm;height:277mm;visibility:hidden";
      document.body.appendChild(probe);
      const pageW = probe.offsetWidth;
      const pageH = probe.offsetHeight;
      probe.remove();
      sheet.style.zoom = "1";
      sheet.style.width = pageW + "px";
      const need = sheet.scrollHeight;
      if (need > pageH) sheet.style.zoom = (pageH / need).toFixed(4);
    };
    const unfit = () => {
      sheet.style.width = "";
      sheet.style.zoom = "1";
    };
    window.addEventListener("beforeprint", fit);
    window.addEventListener("afterprint", unfit);
    return () => {
      window.removeEventListener("beforeprint", fit);
      window.removeEventListener("afterprint", unfit);
    };
  }, []);

  const badgeCls = isInv ? PAY_BADGE[doc.paymentStatus] || "b-pending" : STATUS_BADGE[doc.status] || "b-draft";
  const badgeText = isInv ? "Invoice · " + (doc.paymentStatus || "Pending") : doc.status;
  const showLink = isInv && !!doc.quotationId;

  return (
    <div className="view active" id="v-editor">
      {/* top toolbar */}
      <div className="doctool">
        <span className="lab">New</span>
        <button className="btn sm" onClick={onNewQuote}>
          + Quotation
        </button>
        {feat.invoices && (
          <button className="btn sm" onClick={onNewInvoice}>
            + Invoice
          </button>
        )}
        {isInv && (
          <>
            <span className="lab" style={{ marginLeft: 8 }}>
              Trade
            </span>
            <select className="paysel" value={doc.tradeType || "sell"} onChange={(e) => onTradeType(e.target.value)}>
              <option value="sell">Selling</option>
              <option value="buy">Buying</option>
            </select>
          </>
        )}
        {!feat.simpleQuote && (
          <>
            <span className="lab" style={{ marginLeft: 8 }}>
              Status
            </span>
            {isInv ? (
              <select className="paysel" value={doc.paymentStatus} onChange={(e) => onPayment(e.target.value)}>
                <option>Pending</option>
                <option>Partial</option>
                <option>Paid</option>
              </select>
            ) : (
              <select className="statussel" value={doc.status} onChange={(e) => onStatus(e.target.value)}>
                {STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            )}
          </>
        )}
        <span className={"badge " + badgeCls} style={{ marginLeft: "auto" }}>
          {badgeText}
        </span>
      </div>

      {/* printable sheet */}
      <div id="sheet" className={isInv ? "inv" : ""} ref={sheetRef}>
        {isInv && (
          <div className="wmark" aria-hidden="true">
            <span>{brand.name}</span>
          </div>
        )}
        <div className="mast">
          <div className="mast-top">
            <div className="brand-row">
              {brand.logo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="logo" alt={brand.name} src="/logo.png" />
              )}
              <div className="brand">
                <div className="co-name">
                  {brand.name}{" "}
                  <span className="kindtag">
                    {isInv ? (doc.tradeType === "buy" ? "Purchase Invoice" : "Tax Invoice") : "Quotation"}
                  </span>
                </div>
                {isInv && brand.goods && <div className="co-goods">{brand.goods}</div>}
                <div className="co-meta">
                  {brand.addr && <div>{brand.addr}</div>}
                  <div>
                    {brand.phone && (
                      <>
                        <b>Ph</b> {brand.phone}
                      </>
                    )}
                    {brand.gstin && (
                      <>
                        {brand.phone ? " · " : ""}
                        <b>GSTIN</b> {brand.gstin}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className={"meta" + (showLink ? "" : " two")}>
            <div className="f">
              <label>{isInv ? "Invoice No." : "Quotation No."}</label>
              {editingNo ? (
                <input
                  className="ro"
                  autoFocus
                  defaultValue={doc.number}
                  onBlur={(e) => commitNumber(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === "Tab") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditingNo(false);
                  }}
                />
              ) : (
                <input className="ro" value={doc.number} readOnly onClick={() => setEditingNo(true)} />
              )}
            </div>
            <div className="f">
              <label>Date</label>
              <input value={doc.date} onChange={(e) => setField("date", e.target.value)} />
            </div>
            {showLink && (
              <div className="f">
                <label>Linked</label>
                <div className="ro">{doc.quotationId || "—"}</div>
              </div>
            )}
          </div>
          <div className="cust-block">
            <div className="f">
              <label>Customer Name</label>
              <input
                placeholder="—"
                value={doc.customerName}
                onChange={(e) => setField("customerName", e.target.value)}
              />
            </div>
            <div className="f">
              <label>Phone</label>
              <input placeholder="—" value={doc.phone} onChange={(e) => setField("phone", e.target.value)} />
            </div>
            <div className="f">
              <label>Site</label>
              <input placeholder="—" value={doc.site} onChange={(e) => setField("site", e.target.value)} />
            </div>
            {isInv && (
              <>
                <div className="f">
                  <label>Address</label>
                  <input placeholder="—" value={doc.address} onChange={(e) => setField("address", e.target.value)} />
                </div>
                <div className="f">
                  <label>Customer GSTIN</label>
                  <input placeholder="—" value={doc.custGstin || ""} onChange={(e) => setField("custGstin", e.target.value)} />
                </div>
                <div className="f">
                  <label>Payment</label>
                  <select value={doc.payType || ""} onChange={(e) => setField("payType", e.target.value)}>
                    <option value="">—</option>
                    <option>Cash</option>
                    <option>UPI</option>
                    <option>Bank Transfer</option>
                    <option>Credit</option>
                  </select>
                </div>
              </>
            )}
          </div>
        </div>

        <div id="sections" ref={secRef} onKeyDown={onGridKeyDown}>
          {doc.sections.map((sec, si) => {
            const cft = totals.secCft[si] || 0;
            const amt = Math.round(cft * (+sec.rate || 0) * 100) / 100;
            return (
              <SectionCard
                key={si}
                sec={sec}
                si={si}
                cft={cft}
                amt={amt}
                onName={onName}
                onRate={onRate}
                onCell={onCell}
                onAddRow={onAddRow}
                onDelRow={onDelRow}
                onDelSec={onDelSec}
              />
            );
          })}
        </div>
        <button className="add-sec" onClick={onAddSec}>
          + Add wood type
        </button>

        <Totals doc={doc} sub={totals.sub} gstAmt={totals.gstAmt} grand={totals.grand} onGst={(v) => setField("gst", v)} />

        {isInv && (
          <div className="inv-foot">
            <div className="inv-cols">
              <div className="inv-bank">
                <div className="ib-h">Bank Details</div>
                <div>{brand.bank?.name || "—"}</div>
                <div>A/c No: {brand.bank?.ac || "—"}</div>
                <div>IFSC: {brand.bank?.ifsc || "—"}</div>
              </div>
              {brand.terms && brand.terms.length > 0 && (
                <div className="inv-terms">
                  <div className="ib-h">Terms &amp; Conditions</div>
                  <ol>
                    {brand.terms.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
            <div className="inv-sign">
              <div className="sign-box">
                <div className="sign-line" />
                <div className="sign-role">Customer Signature</div>
              </div>
              <div className="sign-box">
                <div className="sign-for">For {brand.name}</div>
                <div className="sign-line" />
                <div className="sign-role">Proprietor · Authorised Signature</div>
              </div>
            </div>
            <div className="inv-thanks">Thank you for your business 🙏</div>
          </div>
        )}
      </div>

      {/* bottom actions — tight primary row + overflow */}
      <div className="doctool">
        {feat.simpleQuote ? (
          <>
            <button className="btn" onClick={onSaveDraft}>
              Save draft
            </button>
            <button className="btn primary" onClick={onCreate}>
              Create quotation
            </button>
          </>
        ) : (
          <button className="btn primary" onClick={onSaveClick}>
            Save
          </button>
        )}
        <button className="btn wa" onClick={onWaSend}>
          WhatsApp
        </button>
        <button className="btn go" onClick={onPrint}>
          Print
        </button>
        {feat.invoices &&
          (!isInv ? (
            <button className="btn" onClick={onConvert}>
              Convert to Invoice
            </button>
          ) : (
            <button className="btn" onClick={onRecordPayment}>
              Record Payment
            </button>
          ))}
        <div style={{ marginLeft: "auto" }}>
          <MoreMenu>
            <button onClick={onPdf}>Download PDF</button>
            {!isInv && <button onClick={onWaRemind}>WhatsApp reminder</button>}
            <button onClick={onFolder}>Save copy to folder</button>
            <div className="moremenu-sep" />
            <button className="danger" onClick={onDelete}>
              Delete {isInv ? "invoice" : "quotation"}
            </button>
          </MoreMenu>
        </div>
      </div>

      {/* App A: accept payment on a created quotation → posts to the Daybook */}
      {feat.acceptPayment && !isInv && doc.status === "Created" && (
        doc.paidLogged ? (
          <div className="panel-card" style={{ marginTop: 12, padding: "14px 16px" }}>
            <b>Payment received</b> — ₹{inr(doc.payCash || 0)} cash + ₹{inr(doc.payUpi || 0)} UPI
            <span style={{ color: "var(--ink-faint)" }}> · added to Daybook</span>
          </div>
        ) : (
          <div className="panel-card daybook-entry" style={{ marginTop: 12 }}>
            <div style={{ flexBasis: "100%", fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-faint)" }}>
              Accept payment — Grand total ₹{inr(totals.grand)}
            </div>
            <label className="modal-field">
              <span>Cash (₹)</span>
              <input type="number" inputMode="decimal" placeholder={inr(totals.grand)} value={payCash} onChange={(e) => setPayCash(e.target.value)} />
            </label>
            <label className="modal-field">
              <span>UPI (₹)</span>
              <input type="number" inputMode="decimal" placeholder="0" value={payUpi} onChange={(e) => setPayUpi(e.target.value)} />
            </label>
            <button className="btn sm" type="button" onClick={() => setPayCash(String(totals.grand))}>
              Full in cash
            </button>
            <button className="btn primary" type="button" onClick={onAcceptPayment}>
              Accept payment
            </button>
          </div>
        )
      )}

      <p className="hint">
        Use the <b>arrow keys</b> to move between L · W · T · Pcs boxes, and <b>Enter</b> to drop to the next row (a new
        row is added automatically). Everything autosaves.
      </p>
    </div>
  );
}
