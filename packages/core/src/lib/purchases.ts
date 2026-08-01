import { allRec, delRec, getRec, put } from "./data";
import { dateSortKey, nowIso, todayStr, uid } from "./calc";
import type { Purchase, Supplier } from "./types";

const r2 = (n: number) => Math.round((n || 0) * 100) / 100;

export function lineAmount(cft: number, rate: number): number {
  return r2((+cft || 0) * (+rate || 0));
}

export function rowBalance(p: Purchase): number {
  return r2((+p.billAmount || 0) - (+p.billPaid || 0) + (+p.topAmount || 0) - (+p.topPaid || 0));
}

export type PurchaseTotals = {
  cft: number;
  amount: number;
  billAmount: number;
  topAmount: number;
  topPaid: number;
  billPaid: number;
  paid: number;
  balance: number;
  count: number;
};

export function purchaseTotals(rows: Purchase[]): PurchaseTotals {
  let cft = 0,
    amount = 0,
    billAmount = 0,
    topAmount = 0,
    topPaid = 0,
    billPaid = 0;
  for (const p of rows) {
    cft += +p.cft || 0;
    amount += +p.amount || 0;
    billAmount += +p.billAmount || 0;
    topAmount += +p.topAmount || 0;
    topPaid += +p.topPaid || 0;
    billPaid += +p.billPaid || 0;
  }
  const paid = r2(topPaid + billPaid);
  const balance = r2(billAmount - billPaid + topAmount - topPaid);
  return {
    cft: r2(cft),
    amount: r2(amount),
    billAmount: r2(billAmount),
    topAmount: r2(topAmount),
    topPaid: r2(topPaid),
    billPaid: r2(billPaid),
    paid,
    balance,
    count: rows.length,
  };
}

export async function allPurchases(): Promise<Purchase[]> {
  const arr = await allRec<Purchase>("purchases");
  arr.sort(
    (a, b) =>
      (dateSortKey(b.date) || "").localeCompare(dateSortKey(a.date) || "") ||
      (b.createdAt || "").localeCompare(a.createdAt || ""),
  );
  return arr;
}

export type PurchaseFields = {
  id?: string;
  date?: string;
  supplierId: string;
  fromName: string;
  billNo?: string;
  cft?: number | string;
  rate?: number | string;
  amount?: number | string;
  billAmount?: number | string;
  topAmount?: number | string;
  note?: string;
  topPaid?: number | string;
  billPaid?: number | string;
  billPayDate?: string;
  accountNote?: string;
};

export async function savePurchase(fields: PurchaseFields): Promise<Purchase> {
  let p: Purchase | undefined;
  if (fields.id) p = await getRec<Purchase>("purchases", fields.id);
  const cft = Number(fields.cft ?? 0) || 0;
  const rate = Number(fields.rate ?? 0) || 0;
  const amount =
    fields.amount != null && fields.amount !== ""
      ? Number(fields.amount) || 0
      : lineAmount(cft, rate);
  const billAmount =
    fields.billAmount != null && fields.billAmount !== ""
      ? Number(fields.billAmount) || 0
      : amount;
  if (!p) {
    p = {
      id: "BUY-" + uid(),
      date: todayStr(),
      supplierId: "",
      fromName: "",
      billNo: "",
      cft: 0,
      rate: 0,
      amount: 0,
      billAmount: 0,
      topAmount: 0,
      note: "",
      topPaid: 0,
      billPaid: 0,
      billPayDate: "",
      accountNote: "",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
  }
  p.date = (fields.date || p.date || todayStr()).trim();
  p.supplierId = (fields.supplierId || "").trim();
  p.fromName = (fields.fromName || "").trim();
  p.billNo = (fields.billNo || "").trim();
  p.cft = r2(cft);
  p.rate = r2(rate);
  p.amount = r2(amount);
  p.billAmount = r2(billAmount);
  p.topAmount = r2(Number(fields.topAmount ?? 0) || 0);
  p.note = (fields.note || "").trim();
  p.topPaid = r2(Number(fields.topPaid ?? 0) || 0);
  p.billPaid = r2(Number(fields.billPaid ?? 0) || 0);
  p.billPayDate = (fields.billPayDate || "").trim();
  p.accountNote = (fields.accountNote || "").trim();
  p.updatedAt = nowIso();
  await put("purchases", p);
  return p;
}

export async function deletePurchase(id: string): Promise<void> {
  await delRec("purchases", id);
}

/** Resolve buyer label from suppliers list. */
export function buyerName(buyers: Supplier[], id: string, fallback = ""): string {
  return buyers.find((b) => b.id === id)?.name || fallback || "—";
}
