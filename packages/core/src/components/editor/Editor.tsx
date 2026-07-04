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
import { createInvoice, createQuotation } from "@/lib/create";
import { getFeatures } from "@/lib/features";
import { addExpense, deleteExpensesBySource, upiAccounts } from "@/lib/expenses";
import { postInvoice, unpostInvoice } from "@/lib/ledger-autopost";
import { quoteMessage, reminderMessage, waLink } from "@/lib/whatsapp";
import { generatePdf } from "@/lib/pdf";
import { folderConnected, saveCopyToFolder, writeDbSnapshot } from "@/lib/backup";
import { bumpData, setSyncState, toast } from "@/store/app-store";
import { confirmDialog, formDialog } from "@/store/dialog-store";
import type { Doc } from "@/lib/types";
import SectionCard from "./SectionCard";
import Totals from "./Totals";
import MoreMenu from "./MoreMenu";
import AccountPicker from "@/components/AccountPicker";

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

// Default per-CFT rates for common woods (auto-filled when a wood is chosen and the rate is still a default).
const WOOD_PRICES: Record<string, number> = { teak: 4000, "white teak": 2600 };
const DEFAULT_RATES = new Set(Object.values(WOOD_PRICES));

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
  const [payUpiAcct, setPayUpiAcct] = useState(""); // which account the UPI landed in
  const [upiAccts, setUpiAccts] = useState<string[]>([]); // past accounts, for quick-pick

  const feat = getFeatures();
  const isInv = doc.kind === "invoice";
  const isBuy = isInv && doc.tradeType === "buy"; // purchase invoice
  // entry modes offered per section per app:
  //  invoice → by-size + total-CFT; unofficial quote → by-size + per-price; official quote → by-size + total-CFT + running-ft
  const secModes: ("cft" | "direct" | "rft" | "pcs")[] =
    isInv ? ["cft", "direct"] : feat.simpleQuote ? ["cft", "pcs"] : ["cft", "direct", "rft"];
  const totals = useMemo(() => computeDoc(doc), [doc]);
  const totalCft = totals.secCft.reduce((s, c) => s + c, 0);
  // accept-payment: final = round-figure override or the computed grand; balance clears over time
  const finalPrice = doc.finalPrice != null && doc.finalPrice > 0 ? doc.finalPrice : totals.grand;
  const paidSoFar = Math.round(((doc.payCash || 0) + (doc.payUpi || 0)) * 100) / 100;
  const payBalance = Math.round((finalPrice - paidSoFar) * 100) / 100;
  const settled = payBalance <= 0.5;
  const { brandMode, user } = useApp();
  const brand = brandFor(brandMode);
  const invBank = brand.banks?.[doc.bankIdx ?? 0] || brand.bank; // chosen bank for this invoice

  // track the open doc so background pulls don't clobber it
  useEffect(() => {
    setOpenDoc(doc.id, docStore(doc));
    return () => setOpenDoc("", "");
  }, [doc.id, doc.kind]);

  // accept-payment: load the UPI accounts used before, for the "to whom" quick-pick
  useEffect(() => {
    if (feat.acceptPayment) upiAccounts().then(setUpiAccts);
  }, [feat.acceptPayment]);

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
    // optional: mirror this invoice into the Tally ledger (no-op unless the toggle is on)
    if (d.kind === "invoice") postInvoice(d).catch(() => {});
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
  const onName = (si: number, v: string) =>
    update((d) => {
      d.sections[si].name = v;
      // auto-fill the default rate for known woods (only if the rate is empty or still a default)
      const price = WOOD_PRICES[v.trim().toLowerCase()];
      const cur = +d.sections[si].rate || 0;
      if (price && (cur === 0 || DEFAULT_RATES.has(cur))) d.sections[si].rate = String(price);
    });
  const onRate = (si: number, v: string) => update((d) => (d.sections[si].rate = v));
  const onSetMode = (si: number, mode: "cft" | "direct" | "rft" | "pcs") =>
    update((d) => (d.sections[si].calcMode = mode));
  const onCell = (si: number, ri: number, k: "l" | "w" | "t" | "pcs" | "cft", v: string) => {
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
      d.sections.push({ name: "White Teak", rate: WOOD_PRICES["white teak"], rows: [{ l: "", w: "", t: "", pcs: "" }] }),
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

  // final accepted price override (round figure); autosaved, doesn't change the itemised total
  const onFinalPrice = (v: string) =>
    update((d) => (d.finalPrice = v.trim() === "" ? undefined : Math.max(0, +v || 0)));

  async function onAcceptPayment() {
    const d0 = docRef.current;
    const grand = computeDoc(d0).grand;
    const finalP = d0.finalPrice != null && d0.finalPrice > 0 ? d0.finalPrice : grand;
    const cash = Math.max(0, +payCash || 0);
    const upi = Math.max(0, +payUpi || 0);
    if (cash + upi <= 0) return toast("Enter a cash or UPI amount");
    const acct = payUpiAcct.trim();
    if (upi > 0 && !acct) return toast("Enter the UPI account (to whom it came)");
    const cust = (d0.customerName || "").trim() || "Walk-in";
    const note = cust + " · " + d0.number;
    const by = user?.id || "unknown";
    if (cash > 0) await addExpense({ type: "sale", amount: cash, mode: "cash", note, enteredBy: by, sourceId: d0.id });
    if (upi > 0) await addExpense({ type: "sale", amount: upi, mode: "upi", note, account: acct, enteredBy: by, sourceId: d0.id });
    if (upi > 0 && !upiAccts.includes(acct)) setUpiAccts((a) => [...a, acct].sort());
    const next = clone(d0);
    next.finalPrice = finalP;
    next.payCash = Math.round(((next.payCash || 0) + cash) * 100) / 100; // cumulative — clear over time
    next.payUpi = Math.round(((next.payUpi || 0) + upi) * 100) / 100;
    next.amountPaid = Math.round((next.payCash + next.payUpi) * 100) / 100;
    next.paidLogged = true;
    next.paymentStatus = next.amountPaid + 0.001 >= finalP ? "Paid" : "Partial";
    commit(next, true);
    setPayCash("");
    setPayUpi("");
    setPayUpiAcct("");
    toast("Payment recorded" + (cash > 0 ? " · cash → Daybook" : "") + (upi > 0 ? " · UPI → " + acct : ""));
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
    // cascade: remove any daybook entries this doc's payments created
    const n = await deleteExpensesBySource(id);
    if (st === "invoices") await unpostInvoice(id); // remove any auto-posted ledger vouchers
    await metaSet("lastOpen", null);
    bumpData();
    toast(doc.number + " deleted" + (n ? " · " + n + " daybook entr" + (n === 1 ? "y" : "ies") + " removed" : ""));
    router.push(st === "invoices" ? "/invoices" : "/quotations");
  }
  async function onClearPayments() {
    const ok = await confirmDialog({
      title: "Clear payments?",
      message: "Deletes the daybook entries created from this quote's payments and resets it to unpaid.",
      confirmLabel: "Clear payments",
      danger: true,
    });
    if (!ok) return;
    await deleteExpensesBySource(docRef.current.id);
    const next = clone(docRef.current);
    next.payCash = 0;
    next.payUpi = 0;
    next.amountPaid = 0;
    next.paidLogged = false;
    next.paymentStatus = "Pending";
    commit(next, true);
    bumpData();
    toast("Payments cleared");
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
      // printable A4 area for a 6mm @page margin (210-12 × 297-12) — near-full-bleed so the
      // sheet uses almost all of the paper left-to-right
      probe.style.cssText = "position:absolute;left:-9999px;top:0;width:198mm;height:285mm;visibility:hidden";
      document.body.appendChild(probe);
      const pageW = probe.offsetWidth;
      const pageH = probe.offsetHeight;
      probe.remove();
      sheet.classList.remove("inv-tight");
      sheet.style.zoom = "1";
      sheet.style.width = pageW + "px";
      if (isInv) {
        // Invoices fill a full A4 via CSS; never zoom them (that letterboxes them).
        // If two boxes overrun the page, compress the totals + bank/sign boxes instead.
        if (sheet.scrollHeight > pageH + 2) sheet.classList.add("inv-tight");
        sheet.style.width = "";
        return;
      }
      // quote: thick fixed rows (~1.5cm), boxes flow down the left column then the right. Keep the
      // rows at 1.5cm always; if it doesn't fit one A4, DON'T shrink — let it flow onto more pages.
      sheet.classList.add("a4fill");
      sheet.style.setProperty("--sqrow", "1.5cm");
      sheet.style.height = pageH - 10 + "px";
      const sections = sheet.querySelector("#sections") as HTMLElement | null;
      const overflows =
        (!!sections && sections.scrollWidth > sections.clientWidth + 2) || sheet.scrollHeight > pageH + 2;
      if (overflows) {
        // too many rows for one page — drop the single-page lock and paginate at full 1.5cm rows
        sheet.classList.remove("a4fill");
        sheet.classList.add("a4multi");
        sheet.style.height = "";
      }
    };
    const unfit = () => {
      sheet.style.width = "";
      sheet.style.height = "";
      sheet.style.zoom = "1";
      sheet.style.removeProperty("--sqrow");
      sheet.classList.remove("inv-tight");
      sheet.classList.remove("a4fill");
      sheet.classList.remove("a4multi");
    };
    window.addEventListener("beforeprint", fit);
    window.addEventListener("afterprint", unfit);
    return () => {
      window.removeEventListener("beforeprint", fit);
      window.removeEventListener("afterprint", unfit);
    };
  }, [isInv]);

  const badgeCls = isInv ? "b-conv" : STATUS_BADGE[doc.status] || "b-draft";
  const badgeText = isInv ? (isBuy ? "Purchase Invoice" : "Invoice") : doc.status;
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
            <span className="lab" style={{ marginLeft: 8 }}>
              Tax
            </span>
            <select className="paysel" value={doc.gstKind || "split"} onChange={(e) => setField("gstKind", e.target.value)}>
              <option value="split">SGST + CGST</option>
              <option value="igst">IGST (interstate)</option>
            </select>
            {!isBuy && (brand.banks?.length || 0) > 1 && (
              <>
                <span className="lab" style={{ marginLeft: 8 }}>
                  Bank
                </span>
                <select className="paysel" value={doc.bankIdx ?? 0} onChange={(e) => update((d) => (d.bankIdx = +e.target.value || 0))}>
                  {brand.banks!.map((b, i) => (
                    <option key={i} value={i}>
                      {b.name.split(",")[0]}
                    </option>
                  ))}
                </select>
              </>
            )}
          </>
        )}
        {!feat.simpleQuote && !isInv && (
          <>
            <span className="lab" style={{ marginLeft: 8 }}>
              Status
            </span>
            <select className="statussel" value={doc.status} onChange={(e) => onStatus(e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </>
        )}
        <span className={"badge " + badgeCls} style={{ marginLeft: "auto" }}>
          {badgeText}
        </span>
      </div>

      {/* printable sheet */}
      <div id="sheet" className={isInv ? "inv" : feat.simpleQuote ? "sq" : ""} ref={sheetRef}>
        {isInv && !isBuy && (
          <div className="wmark" aria-hidden="true">
            <span>{brand.name}</span>
          </div>
        )}
        {isInv && !isBuy && (
          <div className="inv-tag-top">
            <span>Tax Invoice</span>
          </div>
        )}
        <div className={"mast" + (isInv && !isBuy ? " mast-c" : "")}>
          {feat.simpleQuote ? (
            // Cut Size quote: No. on the left, "Wood Quotation" centered, Date on the right — one line
            <div className="mast-top sq-head">
              <div className="mh-side mh-no">
                <label>Quotation No.</label>
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
              <div className="co-name">Wood Quotation</div>
              <div className="mh-side mh-date">
                <label>Date</label>
                <input value={doc.date} onChange={(e) => setField("date", e.target.value)} />
              </div>
            </div>
          ) : (
            <div className="mast-top">
              <div className="brand-row">
                {!isBuy && brand.logo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="logo" alt={brand.name} src="/logo.png" />
                )}
                <div className="brand">
                  <div className="co-name">
                    {isBuy ? (
                      <>
                        Purchase <span className="kindtag">Invoice</span>
                      </>
                    ) : isInv ? (
                      brand.name
                    ) : (
                      <>
                        {brand.name} <span className="kindtag">Quotation</span>
                      </>
                    )}
                  </div>
                  {!isBuy && isInv && brand.goods && <div className="co-goods">{brand.goods}</div>}
                  {isBuy ? (
                    <div className="co-meta">
                      <div>Purchased by {brand.name}{brand.gstin ? " · GSTIN " + brand.gstin : ""}</div>
                    </div>
                  ) : (
                    <div className="co-meta">
                      {brand.addr && <div>{brand.addr}</div>}
                      {brand.gstin && (
                        <div>
                          <b>GSTIN</b> {brand.gstin}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          {!feat.simpleQuote && (
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
              <label>{isBuy ? "Purchase Date" : "Date"}</label>
              <input value={doc.date} onChange={(e) => setField("date", e.target.value)} />
            </div>
            {showLink && (
              <div className="f">
                <label>Linked</label>
                <div className="ro">{doc.quotationId || "—"}</div>
              </div>
            )}
          </div>
          )}
          <div className="cust-block">
            <div className="f">
              <label>{isBuy ? "Supplier Name" : "Customer Name"}</label>
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
            {!isInv && (
              <div className="f">
                <label>Carpenter</label>
                <input placeholder="—" value={doc.site} onChange={(e) => setField("site", e.target.value)} />
              </div>
            )}
            {isInv && (
              <>
                <div className="f">
                  <label>{isBuy ? "Supplier Address" : "Address"}</label>
                  <input placeholder="—" value={doc.address} onChange={(e) => setField("address", e.target.value)} />
                </div>
                <div className="f">
                  <label>{isBuy ? "Supplier GSTIN" : "Customer GSTIN"}</label>
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

        <div id="sections" ref={secRef} onKeyDown={onGridKeyDown} className={feat.simpleQuote ? "twocol" : ""}>
          {(() => {
            const card = (si: number) => {
              const sec = doc.sections[si];
              const cft = totals.secCft[si] || 0;
              const amt = Math.round(cft * (+sec.rate || 0) * 100) / 100;
              return (
                <SectionCard
                  key={si}
                  sec={sec}
                  si={si}
                  cft={cft}
                  amt={amt}
                  modes={secModes}
                  onName={onName}
                  onRate={onRate}
                  onSetMode={onSetMode}
                  onCell={onCell}
                  onAddRow={onAddRow}
                  onDelRow={onDelRow}
                  onDelSec={onDelSec}
                />
              );
            };
            // Cut Size quote: split the wood boxes into EXACTLY two columns — fill the left column
            // (up to ~one page of thick rows) then start the right. Never more than two columns.
            if (!feat.simpleQuote) return doc.sections.map((_, si) => card(si));
            const CAP = 16; // rows that fill one column at the thick ~1.5cm height (fit() thins them if needed)
            const c1: number[] = [];
            const c2: number[] = [];
            let n1 = 0;
            let filled = false;
            doc.sections.forEach((sec, i) => {
              const rows = sec.rows.length || 1;
              if (!filled && (c1.length === 0 || n1 + rows <= CAP)) {
                c1.push(i);
                n1 += rows;
              } else {
                filled = true;
                c2.push(i);
              }
            });
            // the bill sits at the BOTTOM of the right column (pushed down, aligned with the
            // bottom of the taller column) — see .scol .totals{margin-top:auto}
            const bill = (
              <Totals
                doc={doc}
                sub={totals.sub}
                gstAmt={totals.gstAmt}
                grand={totals.grand}
                totalCft={totalCft}
                onGst={(v) => setField("gst", v)}
                onGstMode={(m) => setField("gstMode", m)}
              />
            );
            return (
              <>
                <div className="scol">{c1.map(card)}</div>
                <div className="scol">
                  {c2.map(card)}
                  {bill}
                </div>
              </>
            );
          })()}
        </div>
        <button className="add-sec" onClick={onAddSec}>
          + Add wood type
        </button>
        <datalist id="woodtypes">
          {["Teak", "White Teak", "Nagpur Teak", "CP Teak", "Ghana Teak", "Honne", "Neem", "Sagwan", "Rosewood"].map((w) => (
            <option key={w} value={w} />
          ))}
        </datalist>

        {!feat.simpleQuote && (
          <Totals
            doc={doc}
            sub={totals.sub}
            gstAmt={totals.gstAmt}
            grand={totals.grand}
            totalCft={totalCft}
            onGst={(v) => setField("gst", v)}
            onGstMode={(m) => setField("gstMode", m)}
          />
        )}

        {isInv && (
          <div className="inv-foot">
            {!isBuy && (
              <div className="inv-cols">
                <div className="inv-bank">
                  <div className="ib-h">Bank Details</div>
                  <div>{invBank?.name || "—"}</div>
                  <div>A/c Name: {invBank?.acName || brand.name}</div>
                  <div>A/c No: {invBank?.ac || "—"}</div>
                  <div>IFSC: {invBank?.ifsc || "—"}</div>
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
            )}
            <div className="inv-sign">
              <div className="sign-box">
                <div className="sign-line" />
                <div className="sign-role">{isBuy ? "Supplier Signature" : "Customer Signature"}</div>
              </div>
              <div className="sign-box">
                <div className="sign-for">{isBuy ? "Received by " + brand.name : "For " + brand.name}</div>
                <div className="sign-line" />
                <div className="sign-role">{isBuy ? "Authorised Signature" : "Proprietor · Authorised Signature"}</div>
              </div>
            </div>
            {!isBuy && <div className="inv-thanks">Thank you for your business 🙏</div>}
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
        {feat.invoices && !isInv && (
          <button className="btn" onClick={onConvert}>
            Convert to Invoice
          </button>
        )}
        <div style={{ marginLeft: "auto" }}>
          <MoreMenu>
            <button onClick={onPdf}>Download PDF</button>
            {!isInv && <button onClick={onWaRemind}>WhatsApp reminder</button>}
            <button onClick={onFolder}>Save copy to folder</button>
            {user?.role === "owner" && (
              <>
                <div className="moremenu-sep" />
                <button className="danger" onClick={onDelete}>
                  Delete {isInv ? "invoice" : "quotation"}
                </button>
              </>
            )}
          </MoreMenu>
        </div>
      </div>

      {/* App A: accept payment on a created quotation → final price + cash/UPI → Daybook */}
      {feat.acceptPayment && !isInv && (
        <div className="panel-card daybook-entry no-print" style={{ marginTop: 12 }}>
          <label className="modal-field">
            <span>Final price ₹ <small style={{ color: "var(--ink-faint)" }}>(quote ₹{inr(totals.grand)})</small></span>
            <input
              type="number"
              inputMode="decimal"
              placeholder={inr(totals.grand)}
              value={doc.finalPrice != null ? doc.finalPrice : ""}
              onChange={(e) => onFinalPrice(e.target.value)}
            />
          </label>
          <div style={{ flexBasis: "100%", fontFamily: "var(--mono)", fontSize: 13 }}>
            Received ₹{inr(paidSoFar)} of ₹{inr(finalPrice)} ·{" "}
            {settled ? (
              <b style={{ color: "var(--green)" }}>Settled ✓</b>
            ) : (
              <b style={{ color: "var(--danger)" }}>Balance ₹{inr(payBalance)}</b>
            )}
          </div>
          {!settled && (
            <>
              <label className="modal-field">
                <span>Cash now</span>
                <input type="number" inputMode="decimal" placeholder="0" value={payCash} onChange={(e) => setPayCash(e.target.value)} />
              </label>
              <label className="modal-field">
                <span>UPI now</span>
                <input type="number" inputMode="decimal" placeholder="0" value={payUpi} onChange={(e) => setPayUpi(e.target.value)} />
              </label>
              {+payUpi > 0 && (
                <div className="modal-field acct-field">
                  <span>UPI to which account?</span>
                  <AccountPicker value={payUpiAcct} onChange={setPayUpiAcct} accounts={upiAccts} />
                </div>
              )}
              <button className="btn sm" type="button" onClick={() => { setPayCash(String(payBalance)); setPayUpi(""); }}>
                Full → Cash
              </button>
              <button className="btn sm" type="button" onClick={() => { setPayUpi(String(payBalance)); setPayCash(""); }}>
                Full → UPI
              </button>
              <button className="btn primary" type="button" onClick={onAcceptPayment}>
                Record payment
              </button>
            </>
          )}
          {paidSoFar > 0 && (
            <div style={{ flexBasis: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "var(--ink-faint)", fontFamily: "var(--mono)" }}>
                Paid so far: ₹{inr(doc.payCash || 0)} cash + ₹{inr(doc.payUpi || 0)} UPI
              </span>
              <button className="btn warn sm" type="button" onClick={onClearPayments}>
                Clear payments
              </button>
            </div>
          )}
        </div>
      )}

      <p className="hint">
        Use the <b>arrow keys</b> to move between L · W · T · Pcs boxes, and <b>Enter</b> to drop to the next row (a new
        row is added automatically). Everything autosaves.
      </p>
    </div>
  );
}
