// Pure double-entry derivations — NO db/cloud imports, so it stays unit-testable
// in plain node (see ledger.check.ts). Every balance is DERIVED from raw vouchers;
// nothing is stored denormalized.
// .ts extension so `pnpm check` can run this chain directly under plain node
import { inr } from "./calc.ts";
import type { Ledger, LedgerGroup, VLeg, Voucher } from "./types";

export const r2 = (n: number) => Math.round(n * 100) / 100;
const pad2 = (x: string | number) => String(x).padStart(2, "0");

// ---------- Dr/Cr presentation ----------
// Convention: a signed number where +ve = Dr, −ve = Cr.

export function drCr(bal: number): { abs: number; side: "Dr" | "Cr" } {
  return { abs: Math.abs(r2(bal)), side: bal >= 0 ? "Dr" : "Cr" };
}
/** "₹1,234 Dr" — human balance with side. */
export function fmtBal(bal: number): string {
  const { abs, side } = drCr(bal);
  return "₹" + inr(abs) + " " + side;
}

// ---------- leg / voucher helpers ----------

export const legDr = (l: VLeg) => +l.dr || 0;
export const legCr = (l: VLeg) => +l.cr || 0;
/** Voucher amount = total of the Dr side (== total Cr side when balanced). */
export const voucherTotal = (v: Voucher) => r2(v.legs.reduce((s, l) => s + legDr(l), 0));
/** True when Σdr === Σcr (to the paisa). */
export function isBalanced(v: Voucher): boolean {
  const dr = v.legs.reduce((s, l) => s + legDr(l), 0);
  const cr = v.legs.reduce((s, l) => s + legCr(l), 0);
  return Math.abs(r2(dr) - r2(cr)) < 0.01;
}

// ---------- ledger balance ----------

/** Signed balance = opening + Σ(dr − cr) over every leg touching this ledger. */
export function ledgerBalance(ledger: Ledger, vouchers: Voucher[]): number {
  let bal = +ledger.opening || 0;
  for (const v of vouchers) for (const l of v.legs) if (l.ledgerId === ledger.id) bal += legDr(l) - legCr(l);
  return r2(bal);
}

// ---------- ledger statement (Tally T-format) ----------

export interface StmtRow {
  v: Voucher;
  /** the contra ledger name(s) on the opposite side */
  particulars: string;
  dr: number; // this ledger's debit in the voucher
  cr: number; // this ledger's credit
  running: number; // signed running balance
}
export interface Statement {
  opening: number;
  rows: StmtRow[];
  totalDr: number;
  totalCr: number;
  closing: number;
}

/** Per-ledger statement, chronological, with running balance — the Tally ledger view. */
export function ledgerStatement(
  ledger: Ledger,
  vouchers: Voucher[],
  nameOf: (id: string) => string,
): Statement {
  const mine = vouchers.filter((v) => v.legs.some((l) => l.ledgerId === ledger.id)).sort(cmpVoucher);
  let running = +ledger.opening || 0;
  let totalDr = 0;
  let totalCr = 0;
  const rows: StmtRow[] = mine.map((v) => {
    const dr = r2(v.legs.filter((l) => l.ledgerId === ledger.id).reduce((s, l) => s + legDr(l), 0));
    const cr = r2(v.legs.filter((l) => l.ledgerId === ledger.id).reduce((s, l) => s + legCr(l), 0));
    // Tally shows the opposite side as "particulars".
    const contra = v.legs.filter((l) => (dr >= cr ? legCr(l) > 0 : legDr(l) > 0) && l.ledgerId !== ledger.id);
    const names = [...new Set(contra.map((l) => nameOf(l.ledgerId)))];
    const particulars = names.length ? names[0] + (names.length > 1 ? " …(+" + (names.length - 1) + ")" : "") : nameOf(ledger.id);
    running = r2(running + dr - cr);
    totalDr = r2(totalDr + dr);
    totalCr = r2(totalCr + cr);
    return { v, particulars, dr, cr, running };
  });
  return { opening: r2(+ledger.opening || 0), rows, totalDr, totalCr, closing: running };
}

// ---------- group summary (Tally "Groups") ----------

export interface GroupLine {
  ledger: Ledger;
  balance: number;
}
export interface GroupBlock {
  group: LedgerGroup;
  lines: GroupLine[];
  total: number; // signed
}

/** Ledgers bucketed by group with balances; only groups that have ledgers appear. */
export function groupSummary(ledgers: Ledger[], vouchers: Voucher[]): GroupBlock[] {
  const byGroup = new Map<LedgerGroup, GroupLine[]>();
  for (const l of ledgers) {
    const line = { ledger: l, balance: ledgerBalance(l, vouchers) };
    const arr = byGroup.get(l.group) || [];
    arr.push(line);
    byGroup.set(l.group, arr);
  }
  const blocks: GroupBlock[] = [];
  for (const [group, lines] of byGroup) {
    lines.sort((a, b) => (a.ledger.name || "").localeCompare(b.ledger.name || ""));
    blocks.push({ group, lines, total: r2(lines.reduce((s, x) => s + x.balance, 0)) });
  }
  blocks.sort((a, b) => a.group.localeCompare(b.group));
  return blocks;
}

// ---------- trial balance ----------

export interface TrialBalance {
  totalDr: number;
  totalCr: number;
  diff: number;
  balanced: boolean;
}
export function trialBalance(ledgers: Ledger[], vouchers: Voucher[]): TrialBalance {
  let totalDr = 0;
  let totalCr = 0;
  for (const l of ledgers) {
    const b = ledgerBalance(l, vouchers);
    if (b >= 0) totalDr = r2(totalDr + b);
    else totalCr = r2(totalCr - b);
  }
  const diff = r2(totalDr - totalCr);
  return { totalDr, totalCr, diff, balanced: Math.abs(diff) < 0.01 };
}

// ---------- day book ----------

/** All vouchers, newest first — Tally's Day Book. */
export function dayBook(vouchers: Voucher[]): Voucher[] {
  return [...vouchers].sort((a, b) => -cmpVoucher(a, b));
}

// ---------- date helpers (dd-mm-yy storage <-> yyyy-mm-dd native input) ----------

export function dmyToSort(d: string): string {
  const [dd, mm, yy] = (d || "").split("-");
  if (!dd || !mm || !yy) return "00000000";
  return "20" + pad2(yy) + pad2(mm) + pad2(dd);
}
export function dmyToIso(d: string): string {
  const [dd, mm, yy] = (d || "").split("-");
  if (!dd || !mm || !yy) return "";
  return "20" + pad2(yy) + "-" + pad2(mm) + "-" + pad2(dd);
}
export function isoToDmy(iso: string): string {
  const [yyyy, mm, dd] = (iso || "").split("-");
  if (!yyyy || !mm || !dd) return "";
  return pad2(dd) + "-" + pad2(mm) + "-" + yyyy.slice(2);
}

export function cmpVoucher(a: Voucher, b: Voucher): number {
  const ka = dmyToSort(a.date);
  const kb = dmyToSort(b.date);
  return ka === kb ? (a.createdAt || "").localeCompare(b.createdAt || "") : ka.localeCompare(kb);
}

// ---------- GST split for sales / purchase ----------

export interface GstSplit {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}
/** taxable + rate% → CGST/SGST (kind "split") or IGST (kind "igst"). */
export function gstSplit(taxable: number, rate: number, kind: "split" | "igst" | "none"): GstSplit {
  const t = r2(Math.abs(+taxable || 0));
  if (kind === "none" || !rate) return { taxable: t, cgst: 0, sgst: 0, igst: 0, total: t };
  const gst = r2((t * rate) / 100);
  if (kind === "igst") return { taxable: t, cgst: 0, sgst: 0, igst: gst, total: r2(t + gst) };
  const half = r2(gst / 2);
  return { taxable: t, cgst: half, sgst: r2(gst - half), igst: 0, total: r2(t + gst) };
}
