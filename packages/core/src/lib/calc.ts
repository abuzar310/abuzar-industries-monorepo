import type { Doc, Row } from "./types";

// ---- tiny formatting helpers (identical to legacy) ----

export const inr = (n: number) =>
  (isFinite(n) ? n : 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/** Cubic feet for one line: (L ft × W in × T in × Pcs) ÷ 144. */
export const cftOf = (r: Row) =>
  ((+r.l || 0) * (+r.w || 0) * (+r.t || 0) * (+r.pcs || 0)) / 144;

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

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---- document totals ----

export interface DocTotals {
  sub: number;
  gstAmt: number;
  grand: number;
  secCft: number[];
}

export function computeDoc(d: Doc): DocTotals {
  let sub = 0;
  const secCft: number[] = [];
  d.sections.forEach((sec) => {
    let cft = 0;
    sec.rows.forEach((r) => (cft += cftOf(r)));
    secCft.push(cft);
    sub += Math.round(cft * (+sec.rate || 0) * 100) / 100;
  });
  sub = Math.round(sub * 100) / 100;
  const gstAmt = Math.round(sub * (+d.gst || 0)) / 100;
  const grand = Math.round((sub + gstAmt) * 100) / 100;
  return { sub, gstAmt, grand, secCft };
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
