"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec, clone, delRec, getRec, metaSet, put } from "@/lib/db";
import { cftOf, computeDoc, inr, nowIso } from "@/lib/calc";
import { getLineClip, setLineClip } from "@/lib/lineClipboard";
import { STATUSES } from "@/lib/constants";
import { brandFor } from "@/lib/brand";
import { useApp } from "@/store/useApp";
import { docStore } from "@/lib/doc";
import { nextNumber } from "@/lib/numbering";
import { cloudDelete, setOpenDoc, trySync } from "@/lib/cloud";
import { upsertCustomerFromDoc } from "@/lib/customers";
import { createInvoice, createQuotation } from "@/lib/create";
import { trashDoc } from "@/lib/trash";
import { snapshotBefore } from "@/lib/autobackup";
import { getFeatures } from "@/lib/features";
import { addExpense, allExpenses, deleteExpensesBySource, upiAccounts } from "@/lib/expenses";
import { postInvoice, unpostInvoice } from "@/lib/ledger-autopost";
import { quoteMessage, reminderMessage, waLink } from "@/lib/whatsapp";
import { generatePdf } from "@/lib/pdf";
import { folderConnected, saveCopyToFolder, writeDbSnapshot } from "@/lib/backup";
import { bumpData, setSyncState, toast } from "@/store/app-store";
import { confirmDialog, formDialog } from "@/store/dialog-store";
import type { BoxRect, Customer, Doc, Expense, Row } from "@/lib/types";
import SectionCard from "./SectionCard";
import Totals from "./Totals";
import QuoteCanvas from "./QuoteCanvas";
import MoreMenu from "./MoreMenu";
import PaymentBlock from "./PaymentBlock";
import CustomerPicker from "./CustomerPicker";
import GstinField from "./GstinField";
import DateField from "./DateField";

const DIMCOLS: ("l" | "w" | "t" | "pcs")[] = ["l", "w", "t", "pcs"];
const NO_SEL: Set<number> = new Set(); // stable empty selection for non-active boxes

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
  const [upiAccts, setUpiAccts] = useState<string[]>([]); // past accounts, for quick-pick
  const [expenses, setExpenses] = useState<Expense[]>([]); // this quote's recorded payments (for the mini statements)
  const [customers, setCustomers] = useState<Customer[]>([]); // for the searchable customer picker (avoid duplicates)
  // Excel-style line copy/paste (clipboard is GLOBAL — see lineClipboard — so it works across quotations)
  const [selBox, setSelBox] = useState<number | null>(null); // box whose lines are selected
  const [selRows, setSelRows] = useState<Set<number>>(() => new Set()); // selected row indices in selBox
  const [activeSi, setActiveSi] = useState<number | null>(null); // box the user is in (paste target)
  const dragSi = useRef<number | null>(null); // section index currently being dragged

  const feat = getFeatures();
  const isInv = doc.kind === "invoice";
  const isBuy = isInv && doc.tradeType === "buy"; // purchase invoice
  // entry modes offered per section per app:
  //  invoice → by-size + total-CFT + total-CBM + per-price; unofficial quote → by-size + per-price; official quote → by-size + total-CFT + running-ft
  const secModes: ("cft" | "direct" | "rft" | "pcs" | "cbm")[] =
    isInv ? ["cft", "direct", "cbm", "pcs"] : feat.simpleQuote ? ["cft", "pcs"] : ["cft", "direct", "rft"];
  const totals = useMemo(() => computeDoc(doc), [doc]);
  // CFT and CBM are different units, so keep their running totals separate for the bill summary.
  // Per-price ("pcs") sections price by piece but their L·W·T·Pcs give real CFT — include it here.
  const totalCft = doc.sections.reduce((s, sec, i) => {
    if (sec.calcMode === "cbm" || sec.calcMode === "rft") return s;
    if (sec.calcMode === "pcs") return s + sec.rows.reduce((c, r) => c + cftOf(r), 0);
    return s + (totals.secCft[i] || 0);
  }, 0);
  const totalCbm = doc.sections.reduce(
    (s, sec, i) => (sec.calcMode === "cbm" ? s + (totals.secCft[i] || 0) : s),
    0,
  );
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

  // accept-payment: load this quote's recorded payments for the mini statements
  const loadExpenses = useCallback(() => {
    if (feat.acceptPayment) allExpenses().then(setExpenses);
  }, [feat.acceptPayment]);
  useEffect(() => {
    loadExpenses();
  }, [loadExpenses, doc.id]);

  // load existing customers for the searchable name picker
  useEffect(() => {
    allRec<Customer>("customers").then(setCustomers);
  }, []);

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
  // customer picker: typing a name unlinks (treat as new/edited); picking links to the existing record
  const onCustomerType = (v: string) =>
    update((d) => {
      d.customerName = v;
      d.customerId = "";
    });
  const pickCustomer = (c: Customer) =>
    update((d) => {
      d.customerId = c.id;
      d.customerName = c.name;
      d.phone = c.phone || "";
      d.site = c.site || "";
      d.address = c.address || "";
      d.custGstin = c.gstin || "";
    });
  const onName = (si: number, v: string) =>
    update((d) => {
      d.sections[si].name = v;
      // auto-fill the default rate for known woods (only if the rate is empty or still a default)
      const price = WOOD_PRICES[v.trim().toLowerCase()];
      const cur = +d.sections[si].rate || 0;
      if (price && (cur === 0 || DEFAULT_RATES.has(cur))) d.sections[si].rate = String(price);
    });
  const onRate = (si: number, v: string) => update((d) => (d.sections[si].rate = v));
  const onSetMode = (si: number, mode: "cft" | "direct" | "rft" | "pcs" | "cbm") =>
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

  // ---- line selection (click a line number) → Ctrl/Cmd+C to copy, Ctrl/Cmd+V into another box ----
  const selectRow = (si: number, ri: number) => {
    (document.activeElement as HTMLElement | null)?.blur?.(); // leave edit mode so copy/paste targets lines
    setActiveSi(si);
    if (selBox !== si) {
      setSelBox(si);
      setSelRows(new Set([ri]));
    } else {
      setSelRows((prev) => {
        const n = new Set(prev);
        n.has(ri) ? n.delete(ri) : n.add(ri);
        return n;
      });
    }
  };
  // click the "#" header to select (or clear) every line in the box
  const selectAllRows = (si: number) => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    setActiveSi(si);
    const n = docRef.current.sections[si]?.rows.length || 0;
    if (selBox === si && selRows.size === n && n > 0) {
      setSelRows(new Set()); // all were selected → toggle off
    } else {
      setSelBox(si);
      setSelRows(new Set(Array.from({ length: n }, (_, i) => i)));
    }
  };
  // typing in a box makes it the paste target; switching boxes drops a stale selection
  const onSecFocusIn = (e: React.FocusEvent) => {
    const raw = (e.target as HTMLElement)?.dataset?.si;
    if (raw == null) return;
    const n = +raw;
    setActiveSi(n);
    if (selBox !== n) {
      setSelBox(null);
      setSelRows(new Set());
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k !== "c" && k !== "v") return;
      const ae = document.activeElement as HTMLElement | null;
      if (ae && ae.tagName === "INPUT") return; // editing a field → let the browser copy/paste text
      if (k === "c") {
        if (selBox == null || selRows.size === 0) return;
        const src = docRef.current.sections[selBox];
        if (!src) return;
        const rows = [...selRows].sort((a, b) => a - b).map((i) => src.rows[i]).filter(Boolean) as Row[];
        if (!rows.length) return;
        e.preventDefault();
        setLineClip(rows); // global clipboard → pasteable in any quotation
        toast(`Copied ${rows.length} line${rows.length === 1 ? "" : "s"} — open any quotation, click a line number, then paste`);
      } else {
        const rows = getLineClip();
        if (!rows.length || activeSi == null) return;
        e.preventDefault();
        const si = activeSi;
        update((d) => {
          if (d.sections[si]) d.sections[si].rows.push(...rows);
        });
        toast(`Pasted ${rows.length} line${rows.length === 1 ? "" : "s"}`);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selBox, selRows, activeSi]);

  // ---- drag a box by its header to reorder (auto layout only) ----
  const onDragStartSec = (si: number) => {
    dragSi.current = si;
  };
  const onDropSec = (si: number) => {
    const from = dragSi.current;
    dragSi.current = null;
    if (from == null || from === si) return;
    update((d) => {
      const [moved] = d.sections.splice(from, 1);
      d.sections.splice(si, 0, moved);
    });
  };
  const onAddSec = () =>
    update((d) =>
      d.sections.push({ name: "White Teak", rate: WOOD_PRICES["white teak"], rows: [{ l: "", w: "", t: "", pcs: "" }] }),
    );

  // ---- free-arrange (A4 canvas): drag/resize boxes + the grand total, persisted per-box ----
  const onBox = (si: number, r: BoxRect) => update((d) => (d.sections[si].box = r));
  const onBillBox = (r: BoxRect) => update((d) => (d.billBox = r));
  const toggleFree = () => update((d) => (d.freeLayout = !d.freeLayout));

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
  async function commitNumber(raw: string) {
    const v = raw.trim();
    setEditingNo(false);
    if (!v || v === doc.number) return; // unchanged / empty → keep the current number
    // validate so a rename can never break the flow or overwrite another document
    if (/[/\\?#%]/.test(v)) return toast("A number can't contain / \\ ? # or %");
    const store = docStore(docRef.current);
    if (await getRec(store, v)) return toast("Number " + v + " is already used — pick a free one");
    await snapshotBefore(); // safety restore point before we change the id
    const oldId = docRef.current.id;
    const next = clone(docRef.current);
    next.number = v;
    next.id = v;
    await delRec(store, oldId);
    cloudDelete(store, oldId); // drop the old id from the cloud too, so it can't re-sync as a duplicate
    persist(next);
    docRef.current = next;
    setDoc(next);
    await metaSet("lastOpen", { store: docStore(next), id: v });
    router.replace("/editor/" + v);
    toast("Number changed to " + v);
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
  const onCreate = () => setStatusAndSave("Created", "Quotation " + docRef.current.number + " saved ✓");

  // final accepted price override (round figure); autosaved, doesn't change the itemised total
  const onFinalPrice = (v: string) =>
    update((d) => (d.finalPrice = v.trim() === "" ? undefined : Math.max(0, +v || 0)));

  // per-section Total Price override (empty reverts to quantity × rate)
  const onSecAmt = (si: number, v: string) =>
    update((d) => (d.sections[si].amtOverride = v.trim() === "" ? undefined : Math.max(0, +v || 0)));

  // persist the running cash/UPI totals onto the doc after PaymentBlock adds/removes a payment line
  function setPayAggregates(payCash: number, payUpi: number) {
    const next = clone(docRef.current);
    next.payCash = Math.round(payCash * 100) / 100;
    next.payUpi = Math.round(payUpi * 100) / 100;
    next.amountPaid = Math.round((next.payCash + next.payUpi) * 100) / 100;
    const fp = next.finalPrice != null && next.finalPrice > 0 ? next.finalPrice : computeDoc(next).grand;
    next.paymentStatus = next.amountPaid <= 0 ? "Pending" : next.amountPaid + 0.001 >= fp ? "Paid" : "Partial";
    next.paidLogged = next.amountPaid > 0;
    commit(next, true);
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
      title: "Move " + doc.number + " to Recycle bin?",
      message: "It leaves your lists but isn't lost — restore it anytime from Settings → Recycle bin.",
      confirmLabel: "Move to bin",
    });
    if (!ok) return;
    await snapshotBefore(); // fresh restore point captured just before the delete
    const st = docStore(docRef.current);
    await trashDoc(st, docRef.current.id); // soft-delete: kept locally + in the cloud, always recoverable
    await metaSet("lastOpen", null);
    bumpData();
    toast(doc.number + " moved to Recycle bin");
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
    loadExpenses();
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
      // free-arrange mode places boxes by hand on the A4 canvas — never auto-fit/thin/paginate.
      if (docRef.current.freeLayout) return;
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
      // quote: compact ~0.85cm rows (~26 per column, like the legacy print). Try to fit on ONE page —
      // thin a touch (to no less than 0.7cm) if it's a hair over; when even 0.7cm can't hold it, flow
      // onto the next page (a4multi) at the normal 0.85cm rows. Never balloon the rows.
      sheet.classList.add("a4fill");
      sheet.style.height = pageH - 10 + "px";
      const sections = sheet.querySelector("#sections") as HTMLElement | null;
      const overflows = () =>
        (!!sections && sections.scrollWidth > sections.clientWidth + 2) || sheet.scrollHeight > pageH + 2;
      let rowCm = 0.72;
      sheet.style.setProperty("--sqrow", rowCm + "cm");
      while (rowCm > 0.7 && overflows()) {
        rowCm = Math.round((rowCm - 0.05) * 100) / 100;
        sheet.style.setProperty("--sqrow", rowCm + "cm");
      }
      if (overflows()) {
        // won't fit one page even at the thinnest allowed row → paginate at normal compact rows
        sheet.classList.remove("a4fill");
        sheet.classList.add("a4multi");
        sheet.style.height = "";
        sheet.style.setProperty("--sqrow", "0.72cm");
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
  const freeMode = feat.simpleQuote && !!doc.freeLayout;

  // one wood box (shared by the auto-layout and the free-arrange canvas)
  const renderCard = (si: number) => {
    const sec = doc.sections[si];
    const cft = totals.secCft[si] || 0;
    return (
      <SectionCard
        key={si}
        sec={sec}
        si={si}
        cft={cft}
        modes={secModes}
        selRows={selBox === si ? selRows : NO_SEL}
        reorderable={!freeMode}
        onName={onName}
        onRate={onRate}
        onSetMode={onSetMode}
        onCell={onCell}
        onAmt={onSecAmt}
        onSelRow={selectRow}
        onSelAll={selectAllRows}
        onDragStartSec={onDragStartSec}
        onDropSec={onDropSec}
        onAddRow={onAddRow}
        onDelRow={onDelRow}
        onDelSec={onDelSec}
      />
    );
  };
  const billNode = (
    <Totals
      doc={doc}
      sub={totals.sub}
      gstAmt={totals.gstAmt}
      grand={totals.grand}
      totalCft={totalCft}
      totalCbm={totalCbm}
      onGst={(v) => setField("gst", v)}
      onGstMode={(m) => setField("gstMode", m)}
    />
  );
  // compact masthead rendered inside the A4 canvas in free-arrange mode
  const sqHeader = (
    <>
      <div className="mast-top sq-head">
        <div className="mh-side mh-no">
          <label>Quotation No.</label>
          <input key="numro" className="ro" value={doc.number || ""} readOnly onClick={() => setEditingNo(true)} />
        </div>
        <div className="co-name">Wood Quotation</div>
        <div className="mh-side mh-date">
          <label>Date</label>
          <DateField value={doc.date} onChange={(v) => setField("date", v)} />
        </div>
      </div>
      <div className="cust-block">
        <div className="f">
          <label>Customer Name</label>
          <CustomerPicker value={doc.customerName} customers={customers} onType={onCustomerType} onPick={pickCustomer} />
        </div>
        <div className="f">
          <label>Phone</label>
          <input placeholder="—" value={doc.phone} onChange={(e) => setField("phone", e.target.value)} />
        </div>
        <div className="f">
          <label>Carpenter</label>
          <input placeholder="—" value={doc.site} onChange={(e) => setField("site", e.target.value)} />
        </div>
      </div>
    </>
  );

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
      <div id="sheet" className={(isInv ? "inv" : feat.simpleQuote ? "sq" : "") + (freeMode ? " free" : "")} ref={sheetRef}>
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
        {freeMode ? (
          <QuoteCanvas
            doc={doc}
            header={sqHeader}
            renderCard={renderCard}
            renderBill={() => billNode}
            onBox={onBox}
            onBillBox={onBillBox}
          />
        ) : (
          <>
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
                  <input key="numro" className="ro" value={doc.number || ""} readOnly onClick={() => setEditingNo(true)} />
                )}
              </div>
              <div className="co-name">Wood Quotation</div>
              <div className="mh-side mh-date">
                <label>Date</label>
                <DateField value={doc.date} onChange={(v) => setField("date", v)} />
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
                <input key="numro" className="ro" value={doc.number || ""} readOnly onClick={() => setEditingNo(true)} />
              )}
            </div>
            <div className="f">
              <label>{isBuy ? "Purchase Date" : "Date"}</label>
              <DateField value={doc.date} onChange={(v) => setField("date", v)} />
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
              <CustomerPicker value={doc.customerName} customers={customers} onType={onCustomerType} onPick={pickCustomer} />
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
                <GstinField
                  label={isBuy ? "Supplier GSTIN" : "Customer GSTIN"}
                  value={doc.custGstin || ""}
                  onChange={(v) => setField("custGstin", v)}
                  onUseName={(name) => update((d) => (d.customerName = name))}
                  onUseAddress={(addr) => update((d) => (d.address = addr))}
                />
                <div className="f" style={{ gridColumn: "1 / -1" }}>
                  <label>{isBuy ? "Supplier Address" : "Address"}</label>
                  <input placeholder="—" value={doc.address} onChange={(e) => setField("address", e.target.value)} />
                </div>
                <div className="f">
                  <label>HSN Code</label>
                  <input placeholder="—" value={doc.hsn || ""} onChange={(e) => setField("hsn", e.target.value)} />
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
                {!isBuy && (
                  <>
                    <div className="f">
                      <label>Vehicle No.</label>
                      <input placeholder="—" value={doc.vehicleNo || ""} onChange={(e) => setField("vehicleNo", e.target.value)} />
                    </div>
                    <div className="f" style={{ gridColumn: "1 / -1" }}>
                      <label>Ship To (address)</label>
                      <input placeholder="—" value={doc.shipTo || ""} onChange={(e) => setField("shipTo", e.target.value)} />
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <div id="sections" ref={secRef} onKeyDown={onGridKeyDown} onFocus={onSecFocusIn} className={feat.simpleQuote ? "twocol" : ""}>
          {(() => {
            // Cut Size quote: split the wood boxes into EXACTLY two columns — FILL THE LEFT COLUMN
            // first (each box stacks directly below the previous one), and only start the right column
            // once the left is full (~one page of compact 0.72cm rows ≈ 30 lines). Never three columns.
            if (!feat.simpleQuote) return doc.sections.map((_, si) => renderCard(si));
            // box height ≈ header/footer chrome + rows×0.72cm; a printable column is ~25cm tall.
            const COL_CM = 25;
            const boxCm = (sec: (typeof doc.sections)[number]) => 3 + (sec.rows.length || 1) * 0.72;
            const c1: number[] = [];
            const c2: number[] = [];
            let h1 = 0;
            let filled = false; // once the left column is full, everything else goes to the right
            doc.sections.forEach((sec, i) => {
              const bc = boxCm(sec);
              if (!filled && (c1.length === 0 || h1 + bc <= COL_CM)) {
                c1.push(i);
                h1 += bc;
              } else {
                filled = true;
                c2.push(i);
              }
            });
            // the bill sits at the BOTTOM of the right column (aligned with the taller column's bottom)
            return (
              <>
                <div className="scol">{c1.map(renderCard)}</div>
                <div className="scol">
                  {c2.map(renderCard)}
                  {billNode}
                </div>
              </>
            );
          })()}
        </div>
          </>
        )}
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
            totalCbm={totalCbm}
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
              Save quotation
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
        {feat.simpleQuote && (
          <button className={"btn" + (freeMode ? " primary" : "")} onClick={toggleFree} title="Drag & resize the boxes freely on the A4 page">
            {freeMode ? "✓ Free arrange" : "Free arrange"}
          </button>
        )}
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
            {(user?.role === "owner" || !isInv) && (
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
        <PaymentBlock
          doc={doc}
          quoteGrand={totals.grand}
          expenses={expenses}
          upiAccts={upiAccts}
          by={user?.id || "unknown"}
          isOwner={user?.role === "owner"}
          onFinalPrice={onFinalPrice}
          setAggregates={setPayAggregates}
          onClearAll={onClearPayments}
          reload={loadExpenses}
        />
      )}

      {/* internal note — only for us, never printed */}
      {feat.simpleQuote && !isInv && (
        <div className="panel-card no-print" style={{ marginTop: 12 }}>
          <label className="modal-field" style={{ flexBasis: "100%", width: "100%" }}>
            <span>Internal note <small style={{ color: "var(--ink-faint)" }}>— only for us, never printed</small></span>
            <textarea
              rows={2}
              placeholder="e.g. deliver by Friday, rate negotiated, balance promised next week…"
              value={doc.notes || ""}
              onChange={(e) => setField("notes", e.target.value)}
              style={{ resize: "vertical", width: "100%", fontFamily: "var(--body)", fontSize: 14, padding: "8px 10px" }}
            />
          </label>
        </div>
      )}

      <p className="hint">
        Use the <b>arrow keys</b> to move between L · W · T · Pcs boxes, and <b>Enter</b> to drop to the next row (a new
        row is added automatically). Everything autosaves.
      </p>
    </div>
  );
}
