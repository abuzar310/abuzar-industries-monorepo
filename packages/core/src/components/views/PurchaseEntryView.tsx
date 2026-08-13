"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec, clone, put } from "@/lib/data";
import { computeDoc, cbmToCft, inr, nowIso, todayStr } from "@/lib/calc";
import { createInvoice } from "@/lib/create";
import { editSupplierDialog } from "@/lib/customer-form";
import { seedSuppliersFromPurchases, upsertSupplierFromDoc } from "@/lib/suppliers";
import { brandFor } from "@/lib/brand";
import { printOrSavePdf } from "@/lib/pdf";
import { useBindPagePdf } from "@/lib/page-pdf";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import CustomerPicker from "@/components/editor/CustomerPicker";
import type { Doc, Supplier } from "@/lib/types";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Read taxable amount + measure (CFT/CBM) out of a purchase doc. */
function readPurchase(d: Doc) {
  const sec = (d.sections || [])[0];
  const amount = sec?.amtOverride != null ? +sec.amtOverride || 0 : computeDoc(d).sub;
  const qty = +(sec?.rows?.[0]?.cft ?? 0) || 0;
  const unit: "cft" | "cbm" = sec?.calcMode === "cbm" ? "cbm" : "cft";
  return { amount, qty, unit };
}

/** Write the simple purchase fields onto a Doc (keeps tradeType=buy + one measure section). */
function writePurchase(
  d: Doc,
  f: {
    date: string;
    customerId: string;
    customerName: string;
    phone: string;
    address: string;
    custGstin: string;
    supplierBillNo: string;
    amount: number;
    qty: number;
    unit: "cft" | "cbm";
    gstKind: "split" | "igst";
    gst: number;
  },
): Doc {
  const next = clone(d);
  next.kind = "invoice";
  next.tradeType = "buy";
  next.date = f.date;
  next.customerId = f.customerId;
  next.customerName = f.customerName;
  next.phone = f.phone;
  next.address = f.address;
  next.custGstin = f.custGstin;
  next.supplierBillNo = f.supplierBillNo;
  next.gst = f.gst;
  next.gstMode = "percent";
  next.gstKind = f.gstKind;
  next.sections = [
    {
      name: "Purchase",
      rate: 0,
      amtOverride: r2(f.amount),
      calcMode: f.unit === "cbm" ? "cbm" : "direct",
      rows: [{ l: "", w: "", t: "", pcs: "", cft: f.qty || 0 }],
    },
  ];
  next.updatedAt = nowIso();
  return next;
}

interface Props {
  /** Existing purchase to edit; omit for a fresh entry. */
  initialDoc?: Doc;
  /** e.g. "print" from ?action= */
  action?: string;
}

export default function PurchaseEntryView({ initialDoc, action }: Props) {
  const { ready, dataVersion, brandMode } = useApp();
  const brand = brandFor(brandMode);
  const router = useRouter();
  const sheetRef = useRef<HTMLDivElement>(null);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [picked, setPicked] = useState<Supplier | null>(null);
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayStr());
  const [billNo, setBillNo] = useState("");
  const [gstin, setGstin] = useState("");
  const [address, setAddress] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState<"cft" | "cbm">("cft");
  const [amount, setAmount] = useState("");
  const [gstKind, setGstKind] = useState<"split" | "igst">("split");
  const [gstRate, setGstRate] = useState("18");
  const [saving, setSaving] = useState(false);
  const [doc, setDoc] = useState<Doc | null>(initialDoc || null);

  const loadSuppliers = useCallback(() => {
    allRec<Supplier>("suppliers").then(setSuppliers);
  }, []);

  useEffect(() => {
    if (!ready) return;
    seedSuppliersFromPurchases()
      .catch(() => {})
      .finally(loadSuppliers);
  }, [ready, dataVersion, loadSuppliers]);

  // hydrate form from an existing purchase
  useEffect(() => {
    if (!initialDoc) return;
    setDoc(initialDoc);
    setName(initialDoc.customerName || "");
    setDate(initialDoc.date || todayStr());
    setBillNo(initialDoc.supplierBillNo || "");
    setGstin(initialDoc.custGstin || "");
    setAddress(initialDoc.address || "");
    setGstKind(initialDoc.gstKind === "igst" ? "igst" : "split");
    setGstRate(String(initialDoc.gst ?? 18));
    const { amount: a, qty: q, unit: u } = readPurchase(initialDoc);
    setAmount(a ? String(a) : "");
    setQty(q ? String(q) : "");
    setUnit(u);
    if (initialDoc.customerId) {
      allRec<Supplier>("suppliers").then((list) => {
        const c0 = list.find((x) => x.id === initialDoc.customerId) || null;
        setPicked(c0);
      });
    }
  }, [initialDoc]);

  useEffect(() => {
    if (action === "print" && doc) {
      const t = setTimeout(() => void printOrSavePdf(sheetRef.current, doc.number || doc.id), 400);
      return () => clearTimeout(t);
    }
  }, [action, doc]);

  const taxable = Math.max(0, +amount || 0);
  const rate = Math.max(0, +gstRate || 0);
  const gstAmt = r2((taxable * rate) / 100);
  const grand = r2(taxable + gstAmt);
  const qtyN = Math.max(0, +qty || 0);
  const unitLabel = unit === "cbm" ? "CBM" : "CFT";
  const cftStored = unit === "cbm" ? cbmToCft(qtyN) : qtyN;

  const gstSplit = useMemo(() => {
    if (gstKind === "igst") return { igst: gstAmt, cgst: 0, sgst: 0 };
    const half = r2(gstAmt / 2);
    return { igst: 0, cgst: half, sgst: r2(gstAmt - half) };
  }, [gstAmt, gstKind]);

  function pickSupplier(c: Supplier) {
    setPicked(c);
    setName(c.name);
    setGstin(c.gstin || "");
    setAddress(c.address || "");
  }
  function onType(v: string) {
    setName(v);
    setPicked(null);
  }

  async function addSupplier() {
    const c = await editSupplierDialog();
    if (!c) return;
    loadSuppliers();
    bumpData();
    pickSupplier(c);
    toast("Supplier " + c.name + " added");
  }

  async function save() {
    if (!name.trim()) return toast("Pick or enter a supplier");
    if (taxable <= 0) return toast("Enter the amount");
    if (!billNo.trim()) return toast("Enter the supplier bill / invoice number");
    setSaving(true);
    try {
      let base = doc;
      if (!base) {
        base = await createInvoice({ tradeType: "buy" });
      }
      const next = writePurchase(base, {
        date: date.trim() || todayStr(),
        customerId: picked?.id || base.customerId || "",
        customerName: name.trim(),
        phone: picked?.phone || base.phone || "",
        address: address.trim(),
        custGstin: gstin.trim(),
        supplierBillNo: billNo.trim(),
        amount: taxable,
        qty: qtyN,
        unit,
        gstKind,
        gst: rate,
      });
      await upsertSupplierFromDoc(next);
      await put("invoices", next);
      setDoc(next);
      bumpData();
      toast("Purchase " + (next.supplierBillNo || next.number) + " saved ✓");
      router.replace("/purchases/" + encodeURIComponent(next.id));
    } finally {
      setSaving(false);
    }
  }

  async function onPrint() {
    if (!doc) return toast("Save first");
    if ((await printOrSavePdf(sheetRef.current, doc.number || doc.id)) === "pdf") toast("PDF downloaded \u2713");
  }
  useBindPagePdf(onPrint);

  return (
    <div>
      <div className="sectitle no-print">
        Abuzar Industries Purchase Invoice
        <small> — supplier bill entry</small>
      </div>

      <div className="rowbtns no-print" style={{ marginBottom: 8 }}>
        <button type="button" className="btn sm" onClick={addSupplier}>
          + Add supplier
        </button>
        <button type="button" className="btn sm" onClick={() => router.push("/suppliers")}>
          Manage suppliers
        </button>
        <button type="button" className="btn sm" onClick={() => router.push("/invoices")}>
          ← Back to list
        </button>
      </div>

      <div className="panel-card no-print" style={{ padding: 16 }}>
        <div className="modal-field" style={{ marginTop: 0, marginBottom: 8 }}>
          <span>Measure</span>
          <div className="db-seg sm" role="group" aria-label="CFT or CBM">
            <button
              type="button"
              className={"seg-btn" + (unit === "cft" ? " on" : "")}
              onClick={() => setUnit("cft")}
            >
              CFT
            </button>
            <button
              type="button"
              className={"seg-btn" + (unit === "cbm" ? " on" : "")}
              onClick={() => setUnit("cbm")}
            >
              CBM
            </button>
          </div>
        </div>

        <div className="rec-grid">
          <label className="modal-field" style={{ marginTop: 0 }}>
            <span>Date</span>
            <input value={date} onChange={(e) => setDate(e.target.value)} placeholder="DD-MM-YY" />
          </label>
          <label className="modal-field" style={{ marginTop: 0, gridColumn: "span 2" }}>
            <span>Supplier name</span>
            <CustomerPicker
              value={name}
              customers={suppliers}
              onType={onType}
              onPick={pickSupplier}
              placeholder="Click to see all suppliers…"
              maxResults={0}
            />
          </label>
        </div>

        <div className="rec-grid" style={{ marginTop: 4 }}>
          <label className="modal-field">
            <span>Supplier bill no. (custom)</span>
            <input
              value={billNo}
              onChange={(e) => setBillNo(e.target.value)}
              placeholder="e.g. 2627"
            />
          </label>
          <label className="modal-field">
            <span>GSTIN</span>
            <input
              value={gstin}
              onChange={(e) => setGstin(e.target.value.toUpperCase())}
              placeholder="Auto from supplier"
            />
          </label>
          <label className="modal-field">
            <span>{unitLabel} total</span>
            <input
              type="number"
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="0"
            />
            {unit === "cbm" && qtyN > 0 && (
              <span className="note" style={{ marginTop: 4, display: "block" }}>
                = {inr(cftStored)} CFT for stock (× 35.315)
              </span>
            )}
          </label>
        </div>

        <label className="modal-field">
          <span>Address</span>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Auto from supplier"
          />
        </label>

        <div className="rec-grid" style={{ marginTop: 4 }}>
          <label className="modal-field">
            <span>Amount (taxable) ₹</span>
            <input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
            />
          </label>
          <label className="modal-field">
            <span>GST %</span>
            <input
              type="number"
              inputMode="decimal"
              value={gstRate}
              onChange={(e) => setGstRate(e.target.value)}
            />
          </label>
          <label className="modal-field">
            <span>Tax type</span>
            <select value={gstKind} onChange={(e) => setGstKind(e.target.value === "igst" ? "igst" : "split")}>
              <option value="split">CGST + SGST</option>
              <option value="igst">IGST</option>
            </select>
          </label>
        </div>

        <div
          style={{
            marginTop: 16,
            padding: "12px 14px",
            borderTop: "1px solid var(--line-2)",
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 10,
          }}
        >
          <div>
            <div className="mut" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Amount
            </div>
            <div style={{ fontWeight: 700 }}>₹ {inr(taxable)}</div>
          </div>
          <div>
            <div className="mut" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {gstKind === "igst" ? "IGST" : "CGST + SGST"}
            </div>
            <div style={{ fontWeight: 700 }}>
              ₹ {inr(gstAmt)}
              {gstKind === "split" ? (
                <span className="mut" style={{ fontWeight: 500, fontSize: 12 }}>
                  {" "}
                  ({inr(gstSplit.cgst)} + {inr(gstSplit.sgst)})
                </span>
              ) : null}
            </div>
          </div>
          <div>
            <div className="mut" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Grand total
            </div>
            <div style={{ fontWeight: 800, fontSize: 18 }}>₹ {inr(grand)}</div>
          </div>
        </div>

        <div className="rowbtns" style={{ marginTop: 14 }}>
          <button type="button" className="btn primary" disabled={saving} onClick={save}>
            {doc ? "Save purchase" : "Record purchase"}
          </button>
          {doc && (
            <button type="button" className="btn sm" onClick={onPrint}>
              Print
            </button>
          )}
        </div>
        {doc && (
          <p className="note" style={{ marginTop: 10 }}>
            Our serial #{doc.number}
            {doc.supplierBillNo ? ` · Supplier bill ${doc.supplierBillNo}` : ""}
          </p>
        )}
      </div>

      {/* Simple print sheet — spreadsheet style, not a tax invoice */}
      {doc && (
        <div className="print-only" ref={sheetRef}>
          <div style={{ fontFamily: "Georgia, serif", padding: 24, color: "#1a1a1a" }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
              {brand.name || "Abuzar Industries"} Purchase Invoice
            </h1>
            {brand.gstin && (
              <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>GSTIN: {brand.gstin}</div>
            )}
            <table
              style={{
                width: "100%",
                marginTop: 20,
                borderCollapse: "collapse",
                fontSize: 13,
              }}
            >
              <thead>
                <tr style={{ background: "#2f6b3a", color: "#fff" }}>
                  {["DATE", "NAME", "BILL NO", "GSTIN NO", unitLabel, "AMOUNT", "GST", "GRAND TOTAL"].map((h) => (
                    <th key={h} style={{ padding: "8px 6px", textAlign: "left", fontWeight: 600 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: "8px 6px", borderBottom: "1px solid #ccc" }}>{doc.date}</td>
                  <td style={{ padding: "8px 6px", borderBottom: "1px solid #ccc" }}>{doc.customerName}</td>
                  <td style={{ padding: "8px 6px", borderBottom: "1px solid #ccc" }}>{doc.supplierBillNo || "—"}</td>
                  <td style={{ padding: "8px 6px", borderBottom: "1px solid #ccc" }}>{doc.custGstin || "—"}</td>
                  <td style={{ padding: "8px 6px", borderBottom: "1px solid #ccc" }}>
                    {qtyN || "—"}
                    {unit === "cbm" && qtyN > 0 ? (
                      <div style={{ fontSize: 11, opacity: 0.7 }}>({inr(cftStored)} CFT)</div>
                    ) : null}
                  </td>
                  <td style={{ padding: "8px 6px", borderBottom: "1px solid #ccc" }}>₹ {inr(taxable)}</td>
                  <td style={{ padding: "8px 6px", borderBottom: "1px solid #ccc" }}>
                    ₹ {inr(gstAmt)}
                    <div style={{ fontSize: 11, opacity: 0.7 }}>
                      {gstKind === "igst" ? "IGST" : "CGST+SGST"} {rate}%
                    </div>
                  </td>
                  <td style={{ padding: "8px 6px", borderBottom: "1px solid #ccc", fontWeight: 700 }}>
                    ₹ {inr(grand)}
                  </td>
                </tr>
              </tbody>
            </table>
            {doc.address && (
              <div style={{ marginTop: 12, fontSize: 12, opacity: 0.8 }}>Address: {doc.address}</div>
            )}
            <div style={{ marginTop: 8, fontSize: 11, opacity: 0.55 }}>Our ref #{doc.number}</div>
          </div>
        </div>
      )}
    </div>
  );
}
