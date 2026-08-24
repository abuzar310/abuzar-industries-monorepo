import type { Doc, Row, Section } from "./types";
import { isCloaked } from "./cloak";

// ---- tiny formatting helpers (identical to legacy) ----

export const inr = (n: number) => {
  // panic cloak: look like empty books (₹0.00), not blank/broken UI
  if (isCloaked()) {
    return (0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return (isFinite(n) ? n : 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

/** Counts / CFT / qty on screen — 0 when cloaked so dashboards look empty. */
export const qty = (n: number, digits = 0) => {
  if (isCloaked()) return digits > 0 ? (0).toFixed(digits) : "0";
  const x = isFinite(n) ? n : 0;
  return digits > 0 ? x.toFixed(digits) : String(Math.round(x));
};

/** Cubic feet for one line: (L ft × W in × T in × Pcs) ÷ 144 — ROUNDED to 2 decimals.
 *  Round-first billing: the CFT figure printed on the line is exactly what's billed,
 *  so displayed CFT × rate = total with no hidden fractions (e.g. 36.65 × 1500 = 54,975). */
export const cftOf = (r: Row) =>
  Math.round((((+r.l || 0) * (+r.w || 0) * (+r.t || 0) * (+r.pcs || 0)) / 144) * 100) / 100;

export const esc = (s: unknown) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

export const pad = (x: number | string, n = 2) => String(x).padStart(n, "0");

export const todayStr = () => {
  const d = new Date();
  return pad(d.getDate()) + "-" + pad(d.getMonth() + 1) + "-" + String(d.getFullYear()).slice(2);
};

export const nowIso = () => new Date().toISOString();

/** Normalise a loosely-typed date into the app's `dd-mm-yy` display format.
 *  Accepts: "" (kept blank), "t"/"today", "5" (day this month), "5-7" / "5/7"
 *  (day-month this year), "5-7-26" / "5.7.2026" (full), and ISO "2026-07-05".
 *  Anything it can't make sense of is returned trimmed & unchanged, so the user
 *  never loses what they typed. */
export function normalizeDate(input: string): string {
  const s = (input || "").trim();
  if (!s) return "";
  if (/^t(oday)?$/i.test(s)) return todayStr();
  const parts = s.split(/[^0-9]+/).filter(Boolean).map(Number);
  if (!parts.length || parts.some((n) => !isFinite(n))) return s;
  const now = new Date();
  let d: number, m: number, y: number;
  if (parts.length >= 3) {
    // a 4-digit / >31 leading number means it's ISO-style (yyyy-mm-dd)
    if (parts[0] > 31) [y, m, d] = parts;
    else [d, m, y] = parts;
  } else if (parts.length === 2) {
    [d, m] = parts;
    y = now.getFullYear();
  } else {
    d = parts[0];
    m = now.getMonth() + 1;
    y = now.getFullYear();
  }
  if (y < 100) y = 2000 + y; // "26" → 2026
  if (d < 1 || d > 31 || m < 1 || m > 12) return s; // clearly not a date — keep raw
  return pad(d) + "-" + pad(m) + "-" + String(y).slice(2);
}

/** A sortable `yyyy-mm-dd` key from a `dd-mm-yy` display date; "" if unparseable
 *  (callers fall back to createdAt for those). */
export function dateSortKey(display: string): string {
  const p = (display || "").trim().split(/[^0-9]+/).filter(Boolean).map(Number);
  if (p.length < 3 || p.some((n) => !isFinite(n))) return "";
  let [d, m, y] = p;
  if (y < 100) y = 2000 + y;
  if (d < 1 || d > 31 || m < 1 || m > 12) return "";
  return String(y).padStart(4, "0") + "-" + pad(m) + "-" + pad(d);
}

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---- document totals ----

export interface DocTotals {
  sub: number;
  gstAmt: number;
  grand: number;
  secCft: number[];
}

/** Running feet for one line: L (ft) × Pcs — rounded to 2 decimals (round-first, same as CFT). */
export const rftOf = (r: Row) => Math.round((+r.l || 0) * (+r.pcs || 0) * 100) / 100;
/** Directly-entered CFT (or CBM) for one line — both use the single `cft` input field. */
export const directOf = (r: Row) => +(r.cft ?? 0) || 0;
/** Per-piece pricing: just the piece count (amount = Pcs × rate). */
export const pcsOf = (r: Row) => +r.pcs || 0;

/** 1 cubic metre → cubic feet (timber trade standard). */
export const CBM_TO_CFT = 35.315;
export const cbmToCft = (cbm: number) => Math.round((+cbm || 0) * CBM_TO_CFT * 100) / 100;

/** Physical timber volume of a section in CFT (CBM sections are converted).
 *  Used for stock / trading — not for ₹ pricing (CBM still prices as measure × ₹/CBM). */
export function sectionVolumeCft(sec: Section): number {
  const rows = sec.rows || [];
  if (sec.calcMode === "cbm") {
    let m = 0;
    rows.forEach((r) => (m += directOf(r)));
    return cbmToCft(m);
  }
  if (sec.calcMode === "direct") {
    let m = 0;
    rows.forEach((r) => (m += directOf(r)));
    return m;
  }
  if (sec.calcMode === "rft") return 0; // running feet is not a volume for stock
  // "cft" / "pcs" / default: L×W×T×Pcs ÷ 144
  let m = 0;
  rows.forEach((r) => (m += cftOf(r)));
  return m;
}

/** Total physical CFT on a document (purchases/sales stock movements). */
export function docVolumeCft(d: Doc): number {
  if (d.rented) return 0;
  return Math.round((d.sections || []).reduce((s, sec) => s + sectionVolumeCft(sec), 0) * 100) / 100;
}

/** A section's Total Price (₹): the hand-typed override if set, else measure × rate. */
export const amountOf = (sec: Section, measure: number): number =>
  sec.amtOverride != null && isFinite(+sec.amtOverride)
    ? Math.round((+sec.amtOverride || 0) * 100) / 100
    : Math.round(measure * (+sec.rate || 0) * 100) / 100;

export function computeDoc(d: Doc): DocTotals {
  // rented invoice: no wood line-items — the taxable value is the single custom rent amount.
  if (d.rented) {
    const sub = Math.round((+(d.rentAmount ?? 0) || 0) * 100) / 100;
    const gstAmt =
      d.gstMode === "flat" ? Math.round((+d.gst || 0) * 100) / 100 : Math.round(sub * (+d.gst || 0)) / 100;
    return { sub, gstAmt, grand: Math.round((sub + gstAmt) * 100) / 100, secCft: [] };
  }
  let sub = 0;
  const secCft: number[] = [];
  (d.sections || []).forEach((sec) => {
    const measureOf =
      sec.calcMode === "rft"
        ? rftOf
        : sec.calcMode === "direct" || sec.calcMode === "cbm"
          ? directOf
          : sec.calcMode === "pcs"
            ? pcsOf
            : cftOf;
    let m = 0;
    (sec.rows || []).forEach((r) => (m += measureOf(r)));
    secCft.push(m);
    sub += amountOf(sec, m);
  });
  sub = Math.round(sub * 100) / 100;
  // flat: gst is a rupee amount; percent: gst is a % of the sub-total.
  const gstAmt =
    d.gstMode === "flat" ? Math.round((+d.gst || 0) * 100) / 100 : Math.round(sub * (+d.gst || 0)) / 100;
  // optional permit fee (Cut Size) — added after GST; 0/unset does not change the bill
  const permit = permitOf(d);
  const grand = Math.round((sub + gstAmt + permit) * 100) / 100;
  return { sub, gstAmt, grand, secCft };
}

/** Optional permit add-on. Unset / 0 / negative → 0. */
export function permitOf(d: Pick<Doc, "permitFee">): number {
  return Math.round(Math.max(0, +(d.permitFee ?? 0) || 0) * 100) / 100;
}

/** What the customer is charged: accepted Final price (else wood+GST) plus any permit fee.
 *  Permit is never folded into the rounded Final price — it sits on top. */
export function quoteBill(d: Doc): number {
  const permit = permitOf(d);
  const wood = Math.round((computeDoc(d).grand - permit) * 100) / 100;
  const base = d.finalPrice != null && +d.finalPrice > 0 ? +d.finalPrice : wood;
  return Math.round((base + permit) * 100) / 100;
}

/** Split the cash in hand at session close into given vs carried-forward.
 *  `given` omitted → hand over everything; otherwise it's clamped to [0, in-hand]. */
export function splitHandover(
  opening: number,
  net: number,
  given?: number,
): { inHand: number; given: number; carried: number } {
  const inHand = Math.round(((+opening || 0) + (+net || 0)) * 100) / 100;
  const g = Math.max(0, Math.min(inHand, given == null ? inHand : Math.round((+given || 0) * 100) / 100));
  return { inHand, given: g, carried: Math.round((inHand - g) * 100) / 100 };
}

// ---- amount in words (Indian numbering) ----

export function rupeesInWords(amount: number): string {
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  let out = "Rupees " + (rupees === 0 ? "Zero" : numWords(rupees));
  if (paise > 0) out += " and " + numWords(paise) + " Paise";
  return out + " only";
}

export function numWords(n: number): string {
  const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x: number): string => (x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? " " + a[x % 10] : ""));
  const three = (x: number): string =>
    x > 99 ? a[Math.floor(x / 100)] + " Hundred" + (x % 100 ? " " + two(x % 100) : "") : two(x);
  if (n === 0) return "Zero";
  let s = "";
  const cr = Math.floor(n / 10000000);
  n %= 10000000;
  const la = Math.floor(n / 100000);
  n %= 100000;
  const th = Math.floor(n / 1000);
  n %= 1000;
  if (cr) s += three(cr) + " Crore ";
  if (la) s += three(la) + " Lakh ";
  if (th) s += three(th) + " Thousand ";
  if (n) s += three(n);
  return s.trim();
}
