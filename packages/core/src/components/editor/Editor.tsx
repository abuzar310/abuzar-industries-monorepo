"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec, clone, listCached, prefSet, put, rpcNextInvoiceNumber } from "@/lib/data";
import { seriesOf } from "@/lib/invoice-id";
import { cftOf, computeDoc, inr, nowIso, permitOf } from "@/lib/calc";
import { getLineClip, setLineClip } from "@/lib/lineClipboard";
import { STATUSES } from "@/lib/constants";
import { brandFor } from "@/lib/brand";
import { useApp } from "@/store/useApp";
import { docStore } from "@/lib/doc";
import { upsertCustomerFromDoc } from "@/lib/customers";
import { createInvoice, createQuotation } from "@/lib/create";
import { findLiveByNumber } from "@/lib/durability";
import { trashDoc } from "@/lib/trash";
import { getFeatures } from "@/lib/features";
import { allExpenses, deleteExpensesBySource, upiAccounts } from "@/lib/expenses";
import { floorQuotePaidFromExpenses, partyLedger, quoteBill, quotePaid, statementsForQuote } from "@/lib/payments";
import { lockAmount } from "@/lib/carpenter-financials";
import { postInvoice } from "@/lib/ledger-autopost";
import { balanceReminderMessage, reminderMessage, sendDocOnWhatsApp, waLink } from "@/lib/whatsapp";
import { generatePdf, printOrSavePdf } from "@/lib/pdf";
import { promoteTempTab, setTempDoc } from "@/lib/editor-tabs";
import { OFFICIAL_DEFAULT_WOOD } from "@/lib/woods";
import { bumpData, toast } from "@/store/app-store";
import { confirmDialog, formDialog } from "@/store/dialog-store";
import type { BoxRect, Carpenter, CommissionLock as CommLock, Customer, Doc, Expense, Row } from "@/lib/types";
import SectionCard from "./SectionCard";
import Totals from "./Totals";
import QuoteCanvas from "./QuoteCanvas";
import MoreMenu from "./MoreMenu";
import PaymentBlock from "./PaymentBlock";
import CommissionLock from "./CommissionLock";
import InvoicePayBlock from "./InvoicePayBlock";
import { applyAdvancesToInvoice } from "@/lib/vouchers";
import InvoicePrintA from "./InvoicePrintA";
import PermitLetter, { type PermitFields } from "./PermitLetter";
import CustomerPicker from "./CustomerPicker";
import CarpenterPicker, { knownCarpenters, type CarpenterHit } from "./CarpenterPicker";
import GstinField from "./GstinField";
import DateField from "./DateField";
import EwayBillPanel from "./EwayBillPanel";
import { showReviewQr } from "@/store/review-qr-store";
import { extractPincode } from "@/lib/ewaybill";

const DIMCOLS: ("l" | "w" | "t" | "pcs")[] = ["l", "w", "t", "pcs"];
const NO_SEL: Set<number> = new Set(); // stable empty selection for non-active boxes

const namesEq = (a: string, b: string) => {
  const x = (a || "").trim().toLowerCase();
  const y = (b || "").trim().toLowerCase();
  return !!x && x === y;
};
/** Carpenter is the buyer when the user picked that mode, or old quotes where both names match. */
const isCarpenterBuyer = (d: Doc) => {
  if (d.buyer === "carpenter") return true;
  if (d.buyer === "party") return false;
  return namesEq(d.customerName, d.site);
};
const customerIdFor = (name: string, phone: string, list: Customer[]) => {
  const n = name.trim().toLowerCase();
  if (!n) return "";
  const p = (phone || "").trim();
  const hit = list.find((c) => {
    if ((c.name || "").toLowerCase() !== n) return false;
    const cp = (c.phone || "").trim();
    return !p || !cp || cp === p;
  });
  return hit?.id || "";
};

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
const WOOD_PRICES: Record<string, number> = {
  teak: 4000,
  "imported teak wood": 4000,
  "white teak": 2600,
};
const DEFAULT_RATES = new Set(Object.values(WOOD_PRICES));

export default function Editor({
  initialDoc,
  action,
  payFocus,
  onDirtyChange,
  active: _active,
  temporary = false,
}: {
  initialDoc: Doc;
  action?: string;
  /** a payment line (expense id) to scroll to + flash — set when arriving from Statements */
  payFocus?: string;
  /** called when the dirty state changes */
  onDirtyChange?: (dirty: boolean) => void;
  /** whether this tab is currently visible (tab-panel active) — passed from tab container */
  active?: boolean;
  /** in-memory comparison tab — never cloud-saved until "Save as new quotation" */
  temporary?: boolean;
}) {
  const router = useRouter();
  const [doc, setDoc] = useState<Doc>(initialDoc);
  const docRef = useRef(doc);
  // Explicit-save model: edits only touch React state and raise the dirty flag;
  // the Save button (or Ctrl/Cmd+S, or any action that uses the doc) persists.
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const inv3aRef = useRef<HTMLDivElement>(null); // the print-only 3A invoice (sell invoices)
  const secRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<{ si: number; ri: number; k: string } | null>(null);
  const [editingNo, setEditingNo] = useState(false);
  const [ewayAutoRun, setEwayAutoRun] = useState(false);
  const [permit, setPermit] = useState<PermitFields | null>(null);
  const [upiAccts, setUpiAccts] = useState<string[]>([]); // past accounts, for quick-pick
  const [expenses, setExpenses] = useState<Expense[]>([]); // this quote's recorded payments (for the mini statements)
  const [customers, setCustomers] = useState<Customer[]>([]); // for the searchable customer picker (avoid duplicates)
  const [quoteDocs, setQuoteDocs] = useState<Doc[]>([]); // carpenter name→phone directory (from past quotes too)
  const [carpenterDir, setCarpenterDir] = useState<Carpenter[]>([]); // standalone carpenter contacts
  // Excel-style line copy/paste (clipboard is GLOBAL — see lineClipboard — so it works across quotations)
  const [selBox, setSelBox] = useState<number | null>(null); // box whose lines are selected
  const [selRows, setSelRows] = useState<Set<number>>(() => new Set()); // selected row indices in selBox
  const [activeSi, setActiveSi] = useState<number | null>(null); // box the user is in (paste target)
  const dragSi = useRef<number | null>(null); // section index currently being dragged

  const feat = getFeatures();
  const isInv = doc.kind === "invoice";
  const isBuy = isInv && doc.tradeType === "buy"; // purchase invoice
  const isRent = isInv && !isBuy && !!doc.rented; // rental invoice: single rent amount, no wood lines
  const carpBuyer = feat.simpleQuote && !isInv && isCarpenterBuyer(doc);
  // entry modes offered per section per app:
  //  invoice → by-size + total-CFT + total-CBM + per-price; unofficial quote → by-size + per-price; official quote → by-size + total-CFT + running-ft
  const secModes: ("cft" | "direct" | "rft" | "pcs" | "cbm")[] =
    isInv ? ["cft", "direct", "cbm", "pcs"] : feat.simpleQuote ? ["cft", "pcs"] : ["cft", "direct", "rft"];
  const totals = useMemo(() => computeDoc(doc), [doc]);
  // CFT and CBM are different units, so keep their running totals separate for the bill summary.
  // Per-price ("pcs") sections price by piece but their L·W·T·Pcs give real CFT — include it here.
  const totalCft = isRent
    ? 0
    : doc.sections.reduce((s, sec, i) => {
        if (sec.calcMode === "cbm" || sec.calcMode === "rft") return s;
        if (sec.calcMode === "pcs") return s + sec.rows.reduce((c, r) => c + cftOf(r), 0);
        return s + (totals.secCft[i] || 0);
      }, 0);
  const totalCbm = isRent
    ? 0
    : doc.sections.reduce((s, sec, i) => (sec.calcMode === "cbm" ? s + (totals.secCft[i] || 0) : s), 0);
  // total pieces across the whole invoice (info line on the bill)
  const totalPcs = isRent
    ? 0
    : doc.sections.reduce((s, sec) => s + sec.rows.reduce((p, r) => p + (Math.round(+r.pcs) || 0), 0), 0);
  const { brandMode, user, cloakMoney, dataVersion } = useApp();
  const brand = brandFor(brandMode);
  const invBank = brand.banks?.[doc.bankIdx ?? 0] || brand.bank; // chosen bank for this invoice

  // accept-payment: load the UPI accounts used before, for the "to whom" quick-pick
  useEffect(() => {
    if (feat.acceptPayment) upiAccounts().then(setUpiAccts);
  }, [feat.acceptPayment]);

  // accept-payment / invoice vouchers: load recorded payments for the mini statements
  const loadExpenses = useCallback(() => {
    if (feat.acceptPayment || feat.vouchers) allExpenses().then(setExpenses);
  }, [feat.acceptPayment, feat.vouchers]);
  useEffect(() => {
    loadExpenses();
  }, [loadExpenses, doc.id]);

  // load existing customers + quotes + carpenter directory for searchable pickers
  useEffect(() => {
    allRec<Customer>("customers").then(setCustomers);
    allRec<Doc>("quotations").then(setQuoteDocs);
    allRec<Carpenter>("carpenters").then(setCarpenterDir);
  }, [dataVersion]);

  const carpenters = useMemo(
    () => knownCarpenters(customers, quoteDocs, carpenterDir),
    [customers, quoteDocs, carpenterDir],
  );

  // apply queued focus after a row is added / re-rendered
  useEffect(() => {
    const f = pendingFocus.current;
    if (f) {
      pendingFocus.current = null;
      focusDim(f.si, f.ri, f.k);
    }
  });

  // ---- persistence ----
  // Undo history stack (Ctrl+Z). Each edit pushes current state before the change.
  const historyRef = useRef<Doc[]>([]);
  const UNDO_MAX = 50;
  const markDirty = (v: boolean) => {
    dirtyRef.current = v;
    setDirty(v);
    onDirtyChange?.(v);
  };
  function persist(d: Doc) {
    d.updatedAt = nowIso();
    if (temporary) {
      // comparison tab — keep only in memory until explicitly saved as a new quotation
      setTempDoc(d.id, d);
      markDirty(true);
      return;
    }
    if (feat.acceptPayment && d.kind !== "invoice") {
      floorQuotePaidFromExpenses(d, listCached<Expense>("expenses"));
    }
    put(docStore(d), clone(d)); // optimistic cache + retrying outbox → the database
    // optional: mirror this invoice into the Tally ledger (no-op unless the toggle is on)
    if (d.kind === "invoice") postInvoice(d).catch(() => {});
    markDirty(false);
  }
  function commit(next: Doc, immediate = false) {
    docRef.current = next;
    setDoc(next);
    if (temporary) {
      setTempDoc(next.id, next);
      markDirty(true);
      return;
    }
    if (immediate) persist(next);
    else markDirty(true);
  }
  function update(producer: (d: Doc) => void) {
    // Push current state onto undo stack before mutating
    const stack = historyRef.current;
    stack.push(clone(docRef.current));
    if (stack.length > UNDO_MAX) stack.shift();
    const next = clone(docRef.current);
    producer(next);
    commit(next);
  }
  /** Undo the last edit — Ctrl+Z restores the previous doc state. */
  function undo() {
    const stack = historyRef.current;
    if (!stack.length) {
      toast("Nothing to undo");
      return;
    }
    const prev = stack.pop()!;
    if (feat.acceptPayment && prev.kind !== "invoice") {
      floorQuotePaidFromExpenses(prev, listCached<Expense>("expenses"));
    }
    docRef.current = prev;
    setDoc(prev);
    markDirty(true);
    toast("Undone ↶");
  }
  /** The Save button / Ctrl+S: link the customer record, then persist. */
  async function saveNow() {
    if (temporary) {
      toast("This is a comparison tab — use Save as new quotation");
      return;
    }
    const next = clone(docRef.current);
    await upsertCustomerFromDoc(next);
    commit(next, true);
  }

  /** Persist a temporary comparison as a real quotation (allocates a new number). */
  async function saveTempAsNew(status: "Draft" | "Created") {
    if (!temporary) return;
    const cur = clone(docRef.current);
    const tempId = cur.id;
    const saved = await createQuotation({
      customerId: cur.customerId,
      customerName: cur.customerName,
      phone: cur.phone,
      site: cur.site,
      sitePhone: cur.sitePhone,
      address: cur.address,
      notes: cur.notes,
      date: cur.date,
      sections: clone(cur.sections),
      gst: cur.gst,
      gstMode: cur.gstMode,
      finalPrice: cur.finalPrice,
      showFinalOnPrint: cur.showFinalOnPrint,
      hidePricesOnPrint: cur.hidePricesOnPrint,
      freeLayout: cur.freeLayout,
      billBox: cur.billBox,
      status,
    });
    await upsertCustomerFromDoc(saved);
    promoteTempTab(tempId, saved);
    bumpData();
    toast(
      status === "Draft"
        ? "Saved as draft " + (saved.displayNumber || saved.number)
        : "Quotation " + (saved.displayNumber || saved.number) + " saved ✓",
    );
    router.replace("/editor/" + saved.id);
  }

  // Ctrl/Cmd+S saves; Ctrl+Z undoes; navigating away (unmount) or closing the tab never loses edits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (temporary) {
          toast("Comparison tab — use Save as new quotation");
          return;
        }
        if (dirtyRef.current) saveNow().then(() => toast("Saved ✓"));
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      }
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current && !temporary) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [temporary]);
  useEffect(
    () => () => {
      // in-app navigation away from a dirty persisted doc — save it rather than lose the edits
      // temporary comparison tabs are NEVER auto-saved to the cloud
      if (!temporary && dirtyRef.current) persist(docRef.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ---- field handlers ----
  const setField = (k: keyof Doc, v: string) =>
    update((d) => ((d as unknown as Record<string, unknown>)[k] = v));
  // customer picker: typing a name unlinks (treat as new/edited); picking links to the existing record
  const onCustomerType = (v: string) =>
    update((d) => {
      d.customerName = v;
      d.customerId = "";
      d.oldBalance = undefined;
    });
  const pickCustomer = (c: Customer) =>
    update((d) => {
      d.customerId = c.id;
      d.customerName = c.name;
      d.phone = c.phone || "";
      d.site = c.site || "";
      d.sitePhone = c.sitePhone || "";
      d.address = c.address || "";
      d.custGstin = c.gstin || "";
      d.custPincode = c.pincode || extractPincode(c.address) || d.custPincode || "";
      d.oldBalance = undefined;
    });
  // carpenter: typing an exact known name (or picking from list) fills carpenter phone when available
  const onCarpenterType = (v: string) =>
    update((d) => {
      d.site = v;
      const hit = carpenters.find((c) => c.name.toLowerCase() === v.trim().toLowerCase());
      if (hit?.phone) d.sitePhone = hit.phone;
      if (isCarpenterBuyer(d)) {
        d.customerName = v;
        if (hit?.phone) d.phone = hit.phone;
        d.customerId = customerIdFor(v, d.phone, customers);
      }
    });
  const pickCarpenter = (c: CarpenterHit) =>
    update((d) => {
      d.site = c.name;
      if (c.phone) d.sitePhone = c.phone;
      if (isCarpenterBuyer(d)) {
        d.customerName = c.name;
        d.phone = c.phone || c.phoneAlt || "";
        d.customerId = customerIdFor(c.name, d.phone, customers);
      }
    });
  const setBuyer = (mode: "party" | "carpenter") =>
    update((d) => {
      d.buyer = mode;
      if (mode === "carpenter") {
        const name = (d.site || d.customerName || "").trim();
        const phone = (d.sitePhone || d.phone || "").trim();
        d.site = name;
        d.sitePhone = phone;
        d.customerName = name;
        d.phone = phone;
        d.customerId = customerIdFor(name, phone, customers);
      } else if (namesEq(d.customerName, d.site)) {
        d.customerName = "";
        d.phone = "";
        d.customerId = "";
      }
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
    update((d) => {
      // official default wood; cut-size keeps the White Teak add-another habit
      if (feat.simpleQuote) {
        d.sections.push({ name: "White Teak", rate: WOOD_PRICES["white teak"], rows: [{ l: "", w: "", t: "", pcs: "" }] });
      } else {
        d.sections.push({
          name: OFFICIAL_DEFAULT_WOOD,
          rate: WOOD_PRICES["imported teak wood"] || 4000,
          rows: [{ l: "", w: "", t: "", pcs: "" }],
        });
      }
    });

  // ---- free-arrange (A4 canvas): drag/resize boxes + the grand total, persisted per-box ----
  const onBox = (si: number, r: BoxRect) => update((d) => (d.sections[si].box = r));
  const onBillBox = (r: BoxRect) => update((d) => (d.billBox = r));
  const toggleFree = () => update((d) => (d.freeLayout = !d.freeLayout));
  const toggleHidePrices = () => update((d) => (d.hidePricesOnPrint = !d.hidePricesOnPrint));

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
  // rental invoice: always CGST+SGST (never IGST), printed as "Rented Invoice".
  // Rented invoices run their OWN number series ("R-1", "R-2", …), so toggling moves the
  // invoice between series and re-numbers it atomically from the server — the numbers
  // of normal sales invoices and rented invoices never mix.
  async function onRented(v: boolean) {
    const next = clone(docRef.current);
    next.rented = v;
    if (v) next.gstKind = "split";
    try {
      // exceptId = this invoice — its own (possibly still-saving) number never blocks it,
      // so toggling on→off→on always lands back on R-1, not R-2.
      const number = await rpcNextInvoiceNumber(v ? "rent" : "sell", next.id);
      next.number = number;
      commit(next, true); // explicit action — saves immediately under the new series number
      toast(v ? "Rented invoice — number " + number : "Regular invoice — number " + number);
    } catch {
      commit(next); // offline — keep the edit; the number can be fixed manually
      toast("Couldn't fetch a " + (v ? "rented" : "sales") + " series number — check the number");
    }
  }
  const onRentAmount = (v: string) =>
    update((d) => (d.rentAmount = v.trim() === "" ? undefined : Math.max(0, +v || 0)));
  const onRentDesc = (v: string) => update((d) => (d.rentDesc = v));

  // ---- document number inline edit ----
  // DURABILITY: only the printed `number` changes. The primary key `id` is permanent — we used
  // to delete+recreate the cloud row on rename, which is how invoices silently vanished.
  async function commitNumber(raw: string) {
    const v = raw.trim();
    setEditingNo(false);
    if (!v || v === doc.number) return; // unchanged / empty → keep the current number
    if (/[/\\?#%]/.test(v)) return toast("A number can't contain / \\ ? # or %");
    const store = docStore(docRef.current);
    // invoices: uniqueness is checked within the doc's own series (sell / buy / rent)
    const series = docRef.current.kind === "invoice" ? seriesOf(docRef.current) : undefined;
    const taken = await findLiveByNumber(store, v, docRef.current.id, series);
    if (taken) return toast("Number " + v + " is already used — pick a free one");
    const next = clone(docRef.current);
    next.number = v;
    commit(next, true); // explicit action — saves immediately
    toast("Number changed to " + v);
  }

  // ---- App A: single-source save (Draft / Create) + accept payment ----
  async function setStatusAndSave(status: string, msg: string) {
    const next = clone(docRef.current);
    next.status = status;
    await upsertCustomerFromDoc(next);
    commit(next, true); // commit → persist → mirrors a durable copy to the local folder too
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

  // persist cash / UPI / commission totals after PaymentBlock adds or removes a line
  function setPayAggregates(payCash: number, payUpi: number, payCommission?: number) {
    const next = clone(docRef.current);
    next.payCash = Math.round(payCash * 100) / 100;
    next.payUpi = Math.round(payUpi * 100) / 100;
    if (payCommission !== undefined) next.payCommission = Math.round(payCommission * 100) / 100;
    next.amountPaid = quotePaid(next);
    const fp = quoteBill(next);
    next.paymentStatus = next.amountPaid <= 0 ? "Pending" : next.amountPaid + 0.001 >= fp ? "Paid" : "Partial";
    next.paidLogged = next.amountPaid > 0;
    commit(next, true);
  }

  function setCommLock(lock: CommLock | undefined) {
    const next = clone(docRef.current);
    if (lock) next.commLock = lock;
    else delete next.commLock;
    commit(next, true);
    bumpData();
  }

  async function deleteCommLockOnDoc() {
    const ok = await confirmDialog({
      title: "Delete this lock?",
      message:
        "Removes the decided amount from Carpenters pending. The quotation stays. Money already given stays in history.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setCommLock(undefined);
    toast("Lock deleted");
  }

  /** Typed new name → create/link customer so advances can sit on their account. */
  async function ensureCustomer(): Promise<string | null> {
    const cur = clone(docRef.current);
    const name = (cur.customerName || "").trim();
    if (!name) return null;
    if (cur.customerId) return cur.customerId;
    const cust = await upsertCustomerFromDoc(cur);
    if (!cust?.id) return null;
    commit(cur, true); // writes customerId onto the quotation
    allRec<Customer>("customers").then(setCustomers);
    return cust.id;
  }

  // ---- actions ----
  async function onSaveClick() {
    await saveNow();
    const next = docRef.current;
    toast(
      "Saved ✓  " + next.number + " — reopen from " + (next.kind === "invoice" ? "Invoices" : "Quotations") + " to edit",
    );
  }
  /** What Print / PDF / WhatsApp render: sell invoices use the printed 3A Woodmark
   *  sheet; everything else keeps rendering the on-screen sheet. */
  const printNode = () => (inv3aRef.current ? inv3aRef.current : sheetRef.current);
  async function onPrint() {
    await saveNow(); // never print an unsaved doc
    // Android / installed app: no print dialog — the sheet downloads as a PDF instead
    if ((await printOrSavePdf(printNode(), docRef.current.number || docRef.current.id)) === "pdf")
      toast("PDF downloaded \u2713");
  }
  async function onPermit() {
    await saveNow();
    if (!(docRef.current.customerName || "").trim()) return toast("Pick a customer first");
    const res = await formDialog({
      title: "Permit letter",
      message: "Customer, CFT and pieces come from this invoice. Enter the old permit leaf and book.",
      fields: [
        { name: "leaf", label: "Leaf no", required: true, value: permit?.leaf || "" },
        { name: "book", label: "Book no", required: true, value: permit?.book || "" },
        { name: "form", label: "Old permit form no", required: true, value: permit?.form || "" },
        { name: "oldDate", label: "Old permit date (dd/mm/yy)", required: true, value: permit?.oldDate || "" },
      ],
      submitLabel: "Show letter",
    });
    if (!res) return;
    setPermit({
      leaf: (res.leaf || "").trim(),
      book: (res.book || "").trim(),
      form: (res.form || "").trim(),
      oldDate: (res.oldDate || "").trim(),
    });
  }
  async function onPdf() {
    try {
      await saveNow();
    } catch {}
    try {
      if (printNode()) await generatePdf(printNode()!, docRef.current.number);
      toast("PDF downloaded ✓");
    } catch (e) {
      toast("PDF error: " + ((e as Error)?.message || e));
    }
  }
  async function onWaSend() {
    await saveNow();
    if (!printNode()) return;
    try {
      toast("Preparing PDF…");
      const how = await sendDocOnWhatsApp(printNode()!, docRef.current);
      if (how === "shared") toast("PDF + message attached — pick the customer in WhatsApp");
      else if (how === "direct") toast("PDF downloaded · WhatsApp opened with the message ✓");
      else if (how === "fallback") toast("PDF downloaded — attach it in the WhatsApp chat that opened");
    } catch (e) {
      toast("WhatsApp send error: " + ((e as Error)?.message || e));
    }
  }
  function onWaRemind() {
    window.open(waLink(doc.phone, reminderMessage(doc)), "_blank");
  }
  /** Standard automated reminder: the balance pending from the total — nothing else. */
  function onWaBalance() {
    const d = docRef.current;
    const total = quoteBill(d);
    const received = (payLines || []).reduce((s, l) => s + l.amount, 0);
    const balance = Math.max(0, Math.round((total - received) * 100) / 100);
    const msg = balanceReminderMessage({
      name: d.customerName,
      ref: (d.kind === "invoice" ? "Invoice " : "Quotation ") + d.number,
      total,
      received,
      balance,
    });
    window.open(waLink(d.phone, msg), "_blank");
  }
  async function onConvert() {
    if (docRef.current.kind === "invoice") return;
    const cur = clone(docRef.current);
    await upsertCustomerFromDoc(cur);
    // Collision-proof id + number — allocated atomically by the database.
    const inv = await createInvoice({
      customerId: cur.customerId,
      customerName: cur.customerName,
      phone: cur.phone,
      site: cur.site,
      sitePhone: cur.sitePhone || "",
      address: cur.address,
      notes: cur.notes,
      custGstin: cur.custGstin || "",
      sections: clone(cur.sections),
      gst: cur.gst,
      gstKind: cur.gstKind,
      hsn: cur.hsn,
      shipTo: cur.shipTo,
      vehicleNo: cur.vehicleNo,
      bankIdx: cur.bankIdx,
      finalPrice: cur.finalPrice,
      quotationId: cur.id,
      status: "Converted to Invoice",
      date: cur.date,
    });
    cur.status = "Converted to Invoice";
    commit(cur, true); // saves the source quote before navigating away
    // any advance sitting on the customer's account clears onto the new invoice automatically
    const adv = feat.vouchers ? await applyAdvancesToInvoice(inv, { persist: true }) : { applied: 0 };
    toast(
      "Invoice " + inv.number + " created · prices locked" +
        (adv.applied > 0 ? " · ₹" + inr(adv.applied) + " advance applied" : ""),
    );
    router.push("/editor/" + inv.id);
  }
  async function onDelete() {
    const ok = await confirmDialog({
      title: "Move " + doc.number + " to Recycle bin?",
      message: "It leaves your lists but isn't lost — restore it anytime from Settings → Recycle bin.",
      confirmLabel: "Move to bin",
    });
    if (!ok) return;
    markDirty(false); // deleting — never re-save the doc on unmount
    const st = docStore(docRef.current);
    await trashDoc(st, docRef.current.id); // soft-delete: kept in the cloud, always recoverable
    prefSet("lastOpen", null);
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
    next.payCommission = 0;
    next.amountPaid = 0;
    next.paidLogged = false;
    next.paymentStatus = "Pending";
    commit(next, true);
    bumpData();
    loadExpenses();
    toast("Payments cleared");
  }
  async function onNewQuote() {
    // allocate a real quotation (+ on the tab bar opens a temporary compare tab)
    const d = await createQuotation();
    toast("New quotation " + (d.displayNumber || d.number) + " created");
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
    else if (action === "remind-balance") onWaBalance();
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
        // Goal: one clean full-A4 page. min-height (NOT a fixed height) fills the page so the footer
        // anchors to the bottom, while every block keeps its natural size — nothing gets squished or
        // clipped (e.g. the amount-in-words line). If the content genuinely overruns one page, compress
        // (inv-tight) and, if still over, scale it down uniformly to fit exactly one page.
        sheet.style.minHeight = pageH + "px";
        if (sheet.scrollHeight > pageH + 2) {
          sheet.classList.add("inv-tight");
          if (sheet.scrollHeight > pageH + 2) {
            sheet.style.zoom = String(Math.max(0.72, pageH / sheet.scrollHeight));
          }
        }
        return; // keep width + min-height for print; unfit() restores them afterwards
      }
      // quote: compact ~0.72cm rows. Fit ONE page when possible.
      // Match PDF / inv3a (272mm of the 285mm printable area) — pageH-14px (~281mm) still
      // tips browser print onto a blank page 2. Never use overflow:hidden (clips bill/QR).
      const printH = Math.max(120, Math.round(pageH * (272 / 285)));
      sheet.classList.add("a4fill");
      sheet.style.height = printH + "px";
      sheet.style.maxHeight = printH + "px";
      const sections = sheet.querySelector("#sections") as HTMLElement | null;
      const overflows = () =>
        (!!sections && sections.scrollWidth > sections.clientWidth + 2) ||
        sheet.scrollHeight > printH + 2;
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
        sheet.style.maxHeight = "";
        sheet.style.setProperty("--sqrow", "0.72cm");
      }
    };
    const unfit = () => {
      sheet.style.width = "";
      sheet.style.height = "";
      sheet.style.maxHeight = "";
      sheet.style.minHeight = "";
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
  const badgeText = isInv ? (isBuy ? "Purchase Invoice" : doc.rented ? "Rented Invoice" : "Invoice") : doc.status;
  const showLink = isInv && !!doc.quotationId;
  const freeMode = feat.simpleQuote && !!doc.freeLayout;
  const commLockedAmt = !isInv && !temporary ? lockAmount(doc) : 0;

  // panic cloak: open quote must not show customer/lines — look like nothing is open
  if (cloakMoney && feat.simpleQuote) {
    return (
      <div className="view active" id="v-editor">
        <div className="doctool">
          <span className="lab">New</span>
          <button className="btn sm" onClick={onNewQuote}>
            + Quotation
          </button>
        </div>
        <div className="empty" style={{ padding: 48, textAlign: "center" }}>
          No quotation open.
        </div>
      </div>
    );
  }

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
  // this quote's recorded payments — printed as the settlement block when the toggle is on
  const payLines = !isInv ? statementsForQuote(doc, expenses) : undefined;
  // ₹ held as “Advance for next quote” from this quotation (not applied as payment here)
  const advanceAmt = !isInv
    ? Math.round(
        expenses
          .filter(
            (e) =>
              e.type === "sale" &&
              e.refQuoteId === doc.id &&
              !e.sourceId &&
              !e.charge &&
              !!e.custId,
          )
          .reduce((s, e) => s + (+e.amount || 0), 0) * 100,
      ) / 100
    : 0;
  // what's still pending on this quote (final price if agreed, else the computed total)
  const remBalance = !isInv
    ? Math.max(
        0,
        Math.round(
          (quoteBill(doc) -
            (payLines || []).reduce((s, l) => s + l.amount, 0)) * 100,
        ) / 100,
      )
    : 0;
  const priorById = useMemo(() => {
    const m = new Map<string, number>();
    if (isInv) return m;
    const others = quoteDocs.filter((d) => d.id !== doc.id);
    const rest = expenses.filter((e) => e.sourceId !== doc.id);
    for (const p of partyLedger(others, rest, customers).parties) {
      if (p.balance <= 0.5) continue;
      if (p.custId) m.set(p.custId, p.balance);
      const n = (p.name || "").trim().toLowerCase();
      if (n) m.set("n:" + n, p.balance);
    }
    return m;
  }, [isInv, quoteDocs, expenses, customers, doc.id]);
  const priorDue =
    priorById.get(doc.customerId) || priorById.get("n:" + (doc.customerName || "").trim().toLowerCase()) || 0;
  const dueOf = (c: Customer) =>
    priorById.get(c.id) || priorById.get("n:" + (c.name || "").trim().toLowerCase()) || 0;
  const totalsExtra = !isInv
    ? {
        priorDue,
        onPermitFee: (v: string) =>
          update((d) => {
            d.permitFee = v.trim() === "" ? undefined : Math.max(0, +v || 0);
          }),
        onPermitLabel: (v: string) => update((d) => (d.permitLabel = v)),
        onOldBalance: (n: number) =>
          update((d) => {
            d.oldBalance = n > 0.005 ? Math.round(n * 100) / 100 : undefined;
          }),
      }
    : {};
  const billNode = (
    <Totals
      doc={doc}
      sub={totals.sub}
      gstAmt={totals.gstAmt}
      grand={totals.grand}
      totalCft={totalCft}
      totalCbm={totalCbm}
      totalPcs={totalPcs}
      payLines={payLines}
      advanceAmt={advanceAmt}
      onGst={(v) => setField("gst", v)}
      onGstMode={(m) => setField("gstMode", m)}
      {...totalsExtra}
    />
  );
  const quotePartyFields = feat.simpleQuote && !isInv && (
    <>
      <div className={"carp-mode no-print" + (carpBuyer ? " on" : "")}>
        <button
          type="button"
          className="carp-mode-sw"
          role="switch"
          aria-checked={carpBuyer}
          title={carpBuyer ? "Carpenter is buying — Customer is hidden" : "Turn on when the carpenter came for wood himself"}
          onClick={() => setBuyer(carpBuyer ? "party" : "carpenter")}
        >
          <span className="carp-sw" aria-hidden />
          Carpenter mode
        </button>
        <span className="carp-mode-hint">{carpBuyer ? "Customer hidden — bill under carpenter" : "House owner? Leave off"}</span>
      </div>
      {carpBuyer ? (
        <div className="cust-block c2">
          <div className="f">
            <label>Carpenter</label>
            <CarpenterPicker value={doc.site} carpenters={carpenters} onType={onCarpenterType} onPick={pickCarpenter} />
          </div>
          <div className="f">
            <label>Phone</label>
            <input
              placeholder="—"
              value={doc.sitePhone || ""}
              onChange={(e) => {
                const v = e.target.value;
                update((d) => {
                  d.sitePhone = v;
                  d.phone = v;
                  d.customerId = customerIdFor(d.customerName, v, customers);
                });
              }}
            />
          </div>
        </div>
      ) : (
        <div className="cust-block c4">
          <div className="f">
            <label>Customer Name</label>
            <CustomerPicker value={doc.customerName} customers={customers} dueOf={dueOf} onType={onCustomerType} onPick={pickCustomer} />
          </div>
          <div className="f">
            <label>Phone</label>
            <input placeholder="—" value={doc.phone} onChange={(e) => setField("phone", e.target.value)} />
          </div>
          <div className="f">
            <label>Carpenter</label>
            <CarpenterPicker value={doc.site} carpenters={carpenters} onType={onCarpenterType} onPick={pickCarpenter} />
          </div>
          <div className="f">
            <label>Carpenter phone</label>
            <input placeholder="—" value={doc.sitePhone || ""} onChange={(e) => setField("sitePhone", e.target.value)} />
          </div>
        </div>
      )}
    </>
  );
  // compact masthead rendered inside the A4 canvas in free-arrange mode
  const sqHeader = (
    <>
      <div className="mast-top sq-head">
        <div className="mh-side mh-no">
          <label>Quotation No.</label>
          <input
            key="numro"
            className="ro"
            value={temporary ? "Compare · unsaved" : doc.number || ""}
            readOnly
            onClick={() => !temporary && setEditingNo(true)}
          />
        </div>
        <div className="co-name">Wood Quotation</div>
        <div className="mh-side mh-date">
          <label>Date</label>
          <DateField value={doc.date} onChange={(v) => setField("date", v)} />
        </div>
      </div>
      {quotePartyFields}
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
            {!doc.rented && (
              <>
                <span className="lab" style={{ marginLeft: 8 }}>
                  Tax
                </span>
                <select className="paysel" value={doc.gstKind || "split"} onChange={(e) => setField("gstKind", e.target.value)}>
                  <option value="split">SGST + CGST</option>
                  <option value="igst">IGST (interstate)</option>
                </select>
              </>
            )}
            {!isBuy && (
              <label className="rentchk" style={{ marginLeft: 8 }} title="Rental invoice — always CGST+SGST, printed as “Rented Invoice”">
                <input type="checkbox" checked={!!doc.rented} onChange={(e) => onRented(e.target.checked)} />
                Rented
              </label>
            )}
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
        {temporary ? (
          <button
            className="btn primary sm save-btn save-needed temp-save"
            style={{ marginLeft: "auto" }}
            title="Allocate a new quotation number and keep this comparison"
            onClick={() => saveTempAsNew("Created")}
          >
            Save as new quotation
          </button>
        ) : (
          <button
            className={"btn primary sm save-btn" + (dirty ? " save-needed" : " save-clean")}
            style={{ marginLeft: "auto" }}
            disabled={!dirty}
            title={dirty ? "Save changes (Ctrl+S)" : "All changes saved"}
            onClick={() => saveNow().then(() => toast("Saved ✓"))}
          >
            {dirty ? "Save" : "Saved ✓"}
          </button>
        )}
        <span className={"badge " + (temporary ? "b-follow" : badgeCls)}>
          {temporary ? "COMPARE · UNSAVED" : badgeText}
        </span>
        {commLockedAmt > 0 && (
          <button
            type="button"
            className="badge b-lock"
            title="Open commission lock"
            onClick={() =>
              document.getElementById("comm-lock")?.scrollIntoView({ behavior: "smooth", block: "center" })
            }
          >
            Locked ₹{inr(commLockedAmt)}
          </button>
        )}
      </div>

      {/* printable sheet */}
      <div
        id="sheet"
        className={
          (isInv ? "inv" : feat.simpleQuote ? "sq" : "") +
          (freeMode ? " free" : "") +
          (isInv && !isBuy && !isRent ? " p3a" : "") +
          (!isInv && (doc.hidePricesOnPrint || cloakMoney) ? " hide-prices" : "")
        }
        ref={sheetRef}
      >
        {isInv && !isBuy && (
          <div className="wmark" aria-hidden="true">
            <span>{brand.name}</span>
          </div>
        )}
        {isInv && !isBuy && (
          <div className="inv-tag-top">
            <span>{doc.rented ? "Rented Invoice" : "Tax Invoice"}</span>
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
                {temporary ? (
                  <input key="numro" className="ro" value="Compare · unsaved" readOnly />
                ) : editingNo ? (
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
                        {(brand.name || "Abuzar Industries") + " "}
                        <span className="kindtag">Purchase Invoice</span>
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
                      {brand.addr && <div className={isInv ? "co-addr" : undefined}>{brand.addr}</div>}
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
          <div className={"meta" + (isInv ? " invrow" : showLink ? "" : " two")}>
            <div className="f">
              <label>{isInv ? "Invoice No." : "Quotation No."}</label>
              {temporary ? (
                <input key="numro" className="ro" value="Compare · unsaved" readOnly />
              ) : editingNo ? (
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
            {isInv && (
              <>
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
                <div className="f">
                  <label>HSN Code</label>
                  <input placeholder="—" value={doc.hsn || ""} onChange={(e) => setField("hsn", e.target.value)} />
                </div>
              </>
            )}
            <div className="f">
              <label>{isBuy ? "Purchase Date" : "Date"}</label>
              <DateField value={doc.date} onChange={(v) => setField("date", v)} />
            </div>
            {isInv && !isBuy && !isRent && (
              <div className="f">
                <label>Vehicle No.</label>
                <input placeholder="—" value={doc.vehicleNo || ""} onChange={(e) => setField("vehicleNo", e.target.value)} />
              </div>
            )}
            {showLink && (
              <div className="f">
                <label>Linked</label>
                <div className="ro">{doc.quotationId || "—"}</div>
              </div>
            )}
          </div>
          )}
          {commLockedAmt > 0 && (
            <div className="comm-lock-bar no-print">
              <span className="comm-lock-stamp">Locked</span>
              <span className="comm-lock-bar-txt">
                Commission ₹{inr(commLockedAmt)}
                {doc.commLock?.carpenter ? " · " + doc.commLock.carpenter : ""}
              </span>
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  document.getElementById("comm-lock")?.scrollIntoView({ behavior: "smooth", block: "center" });
                  window.dispatchEvent(new Event("abuzar-comm-lock-edit"));
                }}
              >
                Edit
              </button>
              <button type="button" className="btn warn sm" onClick={() => void deleteCommLockOnDoc()}>
                Delete
              </button>
            </div>
          )}
          {feat.simpleQuote && !isInv ? (
            quotePartyFields
          ) : (
          <div className={"cust-block" + (!isInv || (isInv && !isBuy && !isRent) ? " c4" : "")}>
            <div className="f">
              <label>{isBuy ? "Supplier Name" : "Customer Name"}</label>
              <CustomerPicker value={doc.customerName} customers={customers} onType={onCustomerType} onPick={pickCustomer} />
            </div>
            <div className="f">
              <label>Phone</label>
              <input placeholder="—" value={doc.phone} onChange={(e) => setField("phone", e.target.value)} />
            </div>
            {!isInv && (
              <>
                <div className="f">
                  <label>Carpenter</label>
                  <CarpenterPicker value={doc.site} carpenters={carpenters} onType={onCarpenterType} onPick={pickCarpenter} />
                </div>
                <div className="f">
                  <label>Carpenter phone</label>
                  <input placeholder="—" value={doc.sitePhone || ""} onChange={(e) => setField("sitePhone", e.target.value)} />
                </div>
              </>
            )}
            {isInv && (
              <>
                <GstinField
                  label={isBuy ? "Supplier GSTIN" : "Customer GSTIN"}
                  value={doc.custGstin || ""}
                  onChange={(v) => setField("custGstin", v)}
                  onUseName={(name) => update((d) => (d.customerName = name))}
                  onUseAddress={(addr) =>
                    update((d) => {
                      d.address = addr;
                      const pin = extractPincode(addr);
                      if (pin && !d.custPincode) d.custPincode = pin;
                    })
                  }
                />
                {!isBuy && !isRent && (
                  <div className="f">
                    <label>Ship To (address)</label>
                    <input placeholder="—" value={doc.shipTo || ""} onChange={(e) => setField("shipTo", e.target.value)} />
                  </div>
                )}
                {isInv && !isBuy && !isRent && (
                  <div className="f">
                    <label>PIN code</label>
                    <input
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="6 digits"
                      value={doc.custPincode || ""}
                      onChange={(e) => setField("custPincode", e.target.value.replace(/\D/g, "").slice(0, 6))}
                    />
                  </div>
                )}
                <div className="f" style={{ gridColumn: "1 / -1" }}>
                  <label>{isBuy ? "Supplier Address" : "Address"}</label>
                  <input placeholder="—" value={doc.address} onChange={(e) => setField("address", e.target.value)} />
                </div>
              </>
            )}
          </div>
          )}
        </div>

        <div id="sections" ref={secRef} onKeyDown={onGridKeyDown} onFocus={onSecFocusIn} className={feat.simpleQuote ? "twocol" : ""}>
          {(() => {
            // rented invoice: a single custom "Rent" line instead of wood boxes.
            if (isRent)
              return (
                <div className="rentline">
                  <div className="rl-head">
                    <span>#</span>
                    <span>Description</span>
                    <span>Amount ₹</span>
                  </div>
                  <div className="rl-row">
                    <span className="rl-sl">1</span>
                    <input
                      className="rl-desc"
                      value={doc.rentDesc ?? "Rent"}
                      placeholder="Rent"
                      aria-label="Rent description"
                      onChange={(e) => onRentDesc(e.target.value)}
                    />
                    <span className="rl-amt">
                      <span className="amt-edit no-print">
                        ₹{" "}
                        <input
                          type="number"
                          inputMode="decimal"
                          aria-label="Rent amount"
                          placeholder="0"
                          value={doc.rentAmount ?? ""}
                          onChange={(e) => onRentAmount(e.target.value)}
                        />
                      </span>
                      <b className="amt-print">₹ {inr(doc.rentAmount ?? 0)}</b>
                    </span>
                  </div>
                </div>
              );
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
        {!isRent && (
          <button className="add-sec" onClick={onAddSec}>
            + Add wood type
          </button>
        )}
        {!feat.simpleQuote && (
          <Totals
            doc={doc}
            sub={totals.sub}
            gstAmt={totals.gstAmt}
            grand={totals.grand}
            totalCft={totalCft}
            totalCbm={totalCbm}
            totalPcs={totalPcs}
            payLines={payLines}
            advanceAmt={advanceAmt}
            onGst={(v) => setField("gst", v)}
            onGstMode={(m) => setField("gstMode", m)}
            {...totalsExtra}
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
            {!isBuy && (
              <div className="inv-thanks">Thank you for your business 🙏</div>
            )}
          </div>
        )}
      </div>

      {/* bottom actions — tight primary row + overflow */}
      <div className="doctool">
        {temporary ? (
          <>
            <button className="btn temp-save" onClick={() => saveTempAsNew("Draft")}>
              Save as draft
            </button>
            <button className="btn primary temp-save" onClick={() => saveTempAsNew("Created")}>
              Save as new quotation
            </button>
          </>
        ) : feat.simpleQuote ? (
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
        <button className="btn wa" onClick={onWaSend} disabled={temporary} title={temporary ? "Save as new quotation first" : undefined}>
          WhatsApp
        </button>
        {feat.acceptPayment && !isInv && remBalance > 0.5 && (
          <button className="btn wa" onClick={onWaBalance} title="WhatsApp just the balance figures — total, received, pending">
            Remind
          </button>
        )}
        <button className="btn go" onClick={onPrint} disabled={temporary} title={temporary ? "Save as new quotation first" : undefined}>
          Print
        </button>
        {feat.invoices && !feat.simpleQuote && isInv && !isBuy && !isRent && (
          <button
            type="button"
            className="btn primary"
            title="Save invoice, download NIC JSON, open e-way portal"
            onClick={() => {
              document.getElementById("eway-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
              setEwayAutoRun(true);
            }}
          >
            E-way
          </button>
        )}
        {!isInv && (
          <button
            className={"btn" + (doc.hidePricesOnPrint ? " primary" : "")}
            onClick={toggleHidePrices}
            title="When on, Print / PDF omit rates, prices, and bill totals — sizes and quantities only"
          >
            {doc.hidePricesOnPrint ? "✓ Hide prices" : "Hide prices"}
          </button>
        )}
        {feat.simpleQuote && (
          <button className={"btn" + (freeMode ? " primary" : "")} onClick={toggleFree} title="Drag & resize the boxes freely on the A4 page">
            {freeMode ? "✓ Free arrange" : "Free arrange"}
          </button>
        )}
        {!isBuy && (
          <button
            type="button"
            className="btn"
            onClick={() => showReviewQr({ force: true })}
            title="Show the Google review QR for the customer to scan"
          >
            Review
          </button>
        )}
        {feat.invoices && isInv && !isBuy && !isRent && (
          <button
            type="button"
            className="btn"
            onClick={() => void onPermit()}
            title="Forest permit letter — customer, CFT and pieces from this invoice"
          >
            Permit
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

      {/* the PRINTED tax invoice (3A Woodmark) — print & Save-PDF only, never on screen */}
      {isInv && !isBuy && !isRent && (
        <InvoicePrintA ref={inv3aRef} doc={doc} totals={totals} brand={brand} bank={invBank} totalCft={totalCft || 0} />
      )}

      {/* App A: accept payment on a created quotation → final price + cash/UPI → Daybook */}
      {feat.acceptPayment && !isInv && temporary && (
        <div className="panel-card no-print" style={{ marginTop: 12, borderColor: "var(--ochre)" }}>
          <p style={{ margin: 0, fontFamily: "var(--disp)", fontWeight: 600, color: "var(--ochre-deep)" }}>
            Comparison tab — nothing is saved yet.
          </p>
          <p style={{ margin: "6px 0 10px", color: "var(--ink-soft)", fontSize: 13 }}>
            Enter rates and sizes freely. When you want to keep it, save as a draft or new quotation (allocates a number).
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn temp-save" onClick={() => saveTempAsNew("Draft")}>
              Save as draft
            </button>
            <button type="button" className="btn primary temp-save" onClick={() => saveTempAsNew("Created")}>
              Save as new quotation
            </button>
          </div>
        </div>
      )}
      {feat.acceptPayment && !isInv && !temporary && (
        <PaymentBlock
          doc={doc}
          quoteGrand={Math.round((totals.grand - permitOf(doc)) * 100) / 100}
          expenses={expenses}
          customers={customers}
          quotes={quoteDocs}
          upiAccts={upiAccts}
          by={user?.id || "unknown"}
          isOwner={user?.role === "owner"}
          onFinalPrice={onFinalPrice}
          onShowFinalOnPrint={(v) => update((d) => (d.showFinalOnPrint = v))}
          setAggregates={setPayAggregates}
          onClearAll={onClearPayments}
          reload={loadExpenses}
          highlightId={payFocus}
          ensureCustomer={ensureCustomer}
        />
      )}
      {feat.acceptPayment && !isInv && !temporary && (
        <CommissionLock
          doc={doc}
          expenses={expenses}
          customers={customers}
          carpenters={carpenters}
          by={user?.id || "unknown"}
          onCommit={setCommLock}
          onApplied={loadExpenses}
        />
      )}

      {/* official: record money received against this invoice (cash capped ₹10k/day) — internal, never printed */}
      {feat.vouchers && isInv && !isBuy && !isRent && (
        <InvoicePayBlock
          doc={doc}
          grand={totals.grand}
          expenses={expenses}
          by={user?.id || "unknown"}
          setAggregates={setPayAggregates}
          reload={loadExpenses}
        />
      )}

      {/* official sell invoice: e-way via NIC bulk JSON (only free path without GSP Client ID) */}
      {feat.invoices && !feat.simpleQuote && isInv && !isBuy && !isRent && (
        <EwayBillPanel
          doc={doc}
          onChange={(patch) =>
            update((d) => {
              Object.assign(d, patch);
            })
          }
          onPersist={() => saveNow()}
          autoRun={ewayAutoRun}
          onAutoRunDone={() => setEwayAutoRun(false)}
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
        row is added automatically). Click <b>Save</b> (or press <b>Ctrl+S</b>) to save your changes.
      </p>
      {permit && (
        <PermitLetter
          customerName={doc.customerName}
          cft={totalCft || 0}
          pcs={totalPcs || 0}
          date={doc.date}
          fields={permit}
          onClose={() => setPermit(null)}
        />
      )}
    </div>
  );
}
