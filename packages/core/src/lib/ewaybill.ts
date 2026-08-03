// E-way bill helpers for official sell invoices.
// Provider = Government NIC portal only (https://ewaybillgst.gov.in) — no GSP/vendor.
// We auto-fill + download bulk JSON; you login on the portal, Generate Bulk, paste EWB no back.
import { computeDoc, dateSortKey, docVolumeCft, todayStr } from "./calc";
import { activeBrand, type Brand } from "./brand";
import { metaGet, metaSet } from "./data";
import { stateFromGstin } from "./gst";
import type { Doc } from "./types";

export const EWAY_PORTAL_URL = "https://ewaybillgst.gov.in";
/** NIC bulk JSON version string (update if portal rejects an older tool version). */
export const EWAY_JSON_VERSION = "1.0.0621";

const META_FROM_PIN = "businessPincode";

/** Pull a 6-digit Indian PIN from free-text address. */
export function extractPincode(text?: string): string {
  const m = String(text || "").match(/\b([1-9][0-9]{5})\b/);
  return m ? m[1] : "";
}

export function isValidPincode(pin?: string): boolean {
  return /^[1-9][0-9]{5}$/.test(String(pin || "").trim());
}

export async function getBusinessPincode(): Promise<string> {
  const stored = await metaGet<string>(META_FROM_PIN, "");
  if (isValidPincode(stored)) return stored.trim();
  const fromAddr = extractPincode(activeBrand().addr);
  return fromAddr || "577501"; // Abuzar KSSIDC default
}

export async function setBusinessPincode(pin: string): Promise<void> {
  await metaSet(META_FROM_PIN, String(pin || "").trim());
}

/** Step-by-step guide shown in the invoice panel (login → generate → paste). */
export const EWAY_GUIDE_STEPS: { title: string; body: string }[] = [
  {
    title: "1. Fill this invoice",
    body: "Customer GSTIN, PIN code, HSN, vehicle number, and amounts — we put them into the NIC file.",
  },
  {
    title: "2. Download JSON",
    body: "Click Download JSON below. That file is what the government portal accepts (Generate Bulk).",
  },
  {
    title: "3. Login on NIC portal",
    body: "Open ewaybillgst.gov.in → login with Abuzar’s e-Way Bill username, password, and captcha (same GST credentials you use for e-way).",
  },
  {
    title: "4. Generate Bulk",
    body: "Menu: e-Waybill → Generate Bulk → choose the JSON file → Upload → Generate. Copy the EWB number shown.",
  },
  {
    title: "5. Paste & print",
    body: "Paste the EWB number (and date) back here, Save, then Print. No vendor — only the government portal issues the number.",
  },
];

function stateCodeFromGstin(gstin?: string): number {
  const s = String(gstin || "").trim();
  const n = parseInt(s.slice(0, 2), 10);
  return Number.isFinite(n) ? n : 29;
}

/** NIC wants dd/mm/yyyy; our docs use dd-mm-yy. */
export function nicDocDate(display: string): string {
  const key = dateSortKey(display || todayStr());
  if (!key) return todayStr().replace(/-/g, "/").replace(/(\d{2})$/, "20$1");
  const [y, m, d] = key.split("-");
  return d + "/" + m + "/" + y;
}

function r2(n: number) {
  return Math.round(n * 100) / 100;
}

export interface EwayReady {
  ok: boolean;
  errors: string[];
}

/** Validate fields needed before downloading JSON. */
export function ewayReady(doc: Doc, brand: Brand, fromPin: string): EwayReady {
  const errors: string[] = [];
  if (doc.kind !== "invoice" || doc.tradeType === "buy" || doc.rented) {
    errors.push("E-way bill is for sell invoices only.");
  }
  if (!brand.gstin || brand.gstin.length !== 15) errors.push("Set your business GSTIN (brand).");
  if (!isValidPincode(fromPin)) errors.push("Set business PIN in Settings (from place).");
  const toPin = (doc.shipToPincode || doc.custPincode || "").trim();
  if (!isValidPincode(toPin)) errors.push("Customer / ship-to PIN (6 digits) is required.");
  if (!(doc.custGstin || "").trim() && !(doc.customerName || "").trim()) {
    errors.push("Customer name or GSTIN is required.");
  }
  if (!(doc.hsn || "").trim()) errors.push("HSN code is required.");
  if (!(doc.vehicleNo || "").trim() && !(doc.transporterId || "").trim()) {
    errors.push("Vehicle number or transporter ID is required.");
  }
  const t = computeDoc(doc);
  if (t.grand < 50000 && !doc.ewbNo) {
    // informational — still allow download (threshold rules vary); soft warn only via UI
  }
  return { ok: errors.length === 0, errors };
}

/** Build one NIC billLists row from a sell invoice. */
export function buildNicBill(doc: Doc, brand: Brand, fromPin: string): Record<string, unknown> {
  const t = computeDoc(doc);
  const igst = doc.gstKind === "igst";
  const halfGst = r2(t.gstAmt / 2);
  const cgst = igst ? 0 : halfGst;
  const sgst = igst ? 0 : halfGst;
  const igstVal = igst ? r2(t.gstAmt) : 0;
  const rate = +doc.gst || 0;
  const fromState = stateCodeFromGstin(brand.gstin);
  const toGstin = (doc.custGstin || "").trim().toUpperCase() || "URP";
  const toState = toGstin === "URP" ? fromState : stateCodeFromGstin(toGstin);
  const toPin = parseInt((doc.shipToPincode || doc.custPincode || "").trim(), 10);
  const fromPincode = parseInt(fromPin, 10);
  const toAddr = (doc.shipTo || doc.address || "").trim() || "—";
  const fromAddr = (brand.addr || "").trim() || "—";
  const qty = Math.max(docVolumeCft(doc) || 1, 0.01);
  const hsn = String(doc.hsn || "").replace(/\D/g, "") || "4407";
  const placeFrom = fromAddr.split(",")[0]?.trim() || "Chitradurga";
  const placeTo = toAddr.split(",")[0]?.trim() || "—";
  const product = (doc.sections[0]?.name || brand.goods || "Timber").trim();

  return {
    userGstin: brand.gstin,
    supplyType: "O",
    subSupplyType: "1",
    subSupplyDesc: "",
    docType: "INV",
    docNo: String(doc.number || doc.id).slice(0, 16),
    docDate: nicDocDate(doc.date),
    fromGstin: brand.gstin,
    fromTrdName: brand.name,
    fromAddr1: fromAddr.slice(0, 120),
    fromAddr2: "",
    fromPlace: placeFrom.slice(0, 50),
    fromPincode,
    fromStateCode: fromState,
    actFromStateCode: fromState,
    toGstin,
    toTrdName: (doc.customerName || "Customer").slice(0, 100),
    toAddr1: toAddr.slice(0, 120),
    toAddr2: "",
    toPlace: placeTo.slice(0, 50),
    toPincode: toPin,
    toStateCode: toState,
    actToStateCode: toState,
    transactionType: 1,
    dispatchFromGSTIN: brand.gstin,
    dispatchFromTradeName: brand.name,
    shipToGSTIN: toGstin,
    shipToTradeName: (doc.customerName || "Customer").slice(0, 100),
    totalValue: r2(t.sub),
    cgstValue: cgst,
    sgstValue: sgst,
    igstValue: igstVal,
    cessValue: 0,
    TotNonAdvolVal: 0,
    OthValue: 0,
    totInvValue: r2(t.grand),
    transporterId: (doc.transporterId || "").trim().toUpperCase(),
    transporterName: "",
    transDocNo: "",
    transDocDate: "",
    transMode: "1",
    transDistance: String(Math.max(1, Math.round(doc.transDistance || 1))),
    vehicleNo: (doc.vehicleNo || "").trim().toUpperCase().replace(/\s+/g, ""),
    vehicleType: "R",
    itemList: [
      {
        itemNo: 1,
        productName: product.slice(0, 100),
        productDesc: product.slice(0, 100),
        hsnCode: parseInt(hsn.slice(0, 8), 10) || 4407,
        quantity: r2(qty),
        qtyUnit: "OTH",
        taxableAmount: r2(t.sub),
        sgstRate: igst ? 0 : rate / 2,
        cgstRate: igst ? 0 : rate / 2,
        igstRate: igst ? rate : 0,
        cessRate: 0,
      },
    ],
  };
}

export function toNicBulkJson(doc: Doc, brand: Brand, fromPin: string): string {
  const bill = buildNicBill(doc, brand, fromPin);
  return JSON.stringify({ version: EWAY_JSON_VERSION, billLists: [bill] }, null, 2);
}

/** Trigger a browser download of the NIC bulk JSON. */
export function downloadNicJson(doc: Doc, brand: Brand, fromPin: string): void {
  const text = toNicBulkJson(doc, brand, fromPin);
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "eway-" + (doc.number || doc.id).replace(/[^\w.-]+/g, "_") + ".json";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}

export function openEwayPortal(): void {
  window.open(EWAY_PORTAL_URL, "_blank", "noopener,noreferrer");
}

/** Soft note when invoice is under the common ₹50k threshold. */
export function underThresholdNote(doc: Doc): string | null {
  const grand = computeDoc(doc).grand;
  if (grand > 0 && grand < 50000) {
    return "Invoice under ₹50,000 — e-way may not be mandatory for this value; you can still generate if needed.";
  }
  return null;
}

export function stateLabelFromGstin(gstin?: string): string {
  return stateFromGstin(String(gstin || "")) || "";
}
