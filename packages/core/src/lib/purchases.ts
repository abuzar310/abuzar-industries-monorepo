import { allRec, delRec, getRec, put } from "./data";
import { dateSortKey, nowIso, todayStr, uid } from "./calc";
import type { Purchase, Supplier } from "./types";

const r2 = (n: number) => Math.round((n || 0) * 100) / 100;

export function lineAmount(cft: number, rate: number): number {
  return r2((+cft || 0) * (+rate || 0));
}

/** Amount + GST. */
export function totalPurchase(p: Pick<Purchase, "amount" | "gst">): number {
  return r2((+p.amount || 0) + (+p.gst || 0));
}

/** Total purchase − bill amount (auto cash portion of the deal). */
export function cashAmount(p: Pick<Purchase, "amount" | "gst" | "billAmount">): number {
  return r2(Math.max(0, totalPurchase(p) - (+p.billAmount || 0)));
}

export function paidTotal(p: Pick<Purchase, "cashPaid" | "bankPaid" | "topPaid" | "billPaid">): number {
  const cash = p.cashPaid != null ? +p.cashPaid || 0 : +(p.topPaid ?? 0) || 0;
  const bank = p.bankPaid != null ? +p.bankPaid || 0 : +(p.billPaid ?? 0) || 0;
  return r2(cash + bank);
}

/** Outstanding = total purchase − cash paid − bank paid. */
export function rowBalance(p: Purchase): number {
  if ((p.kind || "buy") === "pay") return 0;
  return r2(totalPurchase(p) - paidTotal(p));
}

/** Normalize legacy rows (top paid / bill paid → cash / bank). */
export function normalizePurchase(raw: Purchase): Purchase {
  const kind = raw.kind === "pay" ? "pay" : "buy";
  const amount = +raw.amount || 0;
  const gst = +raw.gst || 0;
  const billAmount = +raw.billAmount || 0;
  const cashPaid =
    raw.cashPaid != null ? +raw.cashPaid || 0 : +(raw.topPaid ?? 0) || 0;
  const bankPaid =
    raw.bankPaid != null ? +raw.bankPaid || 0 : +(raw.billPaid ?? 0) || 0;
  return {
    ...raw,
    kind,
    buyerName: raw.buyerName || "",
    fromName: raw.fromName || "",
    amount,
    gst,
    billAmount,
    cashPaid,
    bankPaid,
    payDate: raw.payDate || raw.billPayDate || "",
    note: raw.note || "",
  };
}

export type PurchaseTotals = {
  cft: number;
  amount: number;
  gst: number;
  total: number;
  billAmount: number;
  cashAmount: number;
  cashPaid: number;
  bankPaid: number;
  paid: number;
  balance: number;
  count: number;
};

export function purchaseTotals(rows: Purchase[]): PurchaseTotals {
  let cft = 0,
    amount = 0,
    gst = 0,
    billAmount = 0,
    cashPaid = 0,
    bankPaid = 0,
    payCash = 0,
    payBank = 0,
    count = 0;
  for (const raw of rows) {
    const p = normalizePurchase(raw);
    if (p.kind === "pay") {
      payCash += +p.cashPaid || 0;
      payBank += +p.bankPaid || 0;
      continue;
    }
    count++;
    cft += +p.cft || 0;
    amount += +p.amount || 0;
    gst += +p.gst || 0;
    billAmount += +p.billAmount || 0;
    cashPaid += +p.cashPaid || 0;
    bankPaid += +p.bankPaid || 0;
  }
  const total = r2(amount + gst);
  const paid = r2(cashPaid + bankPaid + payCash + payBank);
  const balance = r2(total - paid);
  return {
    cft: r2(cft),
    amount: r2(amount),
    gst: r2(gst),
    total,
    billAmount: r2(billAmount),
    cashAmount: r2(Math.max(0, total - billAmount)),
    cashPaid: r2(cashPaid + payCash),
    bankPaid: r2(bankPaid + payBank),
    paid,
    balance,
    count,
  };
}

export async function allPurchases(): Promise<Purchase[]> {
  const arr = (await allRec<Purchase>("purchases")).map(normalizePurchase);
  arr.sort(
    (a, b) =>
      (dateSortKey(b.date) || "").localeCompare(dateSortKey(a.date) || "") ||
      (b.createdAt || "").localeCompare(a.createdAt || ""),
  );
  return arr;
}

export type PurchaseFields = {
  id?: string;
  kind?: "buy" | "pay";
  date?: string;
  supplierId: string;
  buyerName?: string;
  fromName: string;
  billNo?: string;
  cft?: number | string;
  rate?: number | string;
  amount?: number | string;
  gst?: number | string;
  billAmount?: number | string;
  note?: string;
  cashPaid?: number | string;
  bankPaid?: number | string;
  payDate?: string;
};

function numOrEmpty(v: number | string | undefined): number {
  if (v == null || v === "") return 0;
  return Number(v) || 0;
}

export async function savePurchase(fields: PurchaseFields): Promise<Purchase> {
  let p: Purchase | undefined;
  if (fields.id) {
    const existing = await getRec<Purchase>("purchases", fields.id);
    p = existing ? normalizePurchase(existing) : undefined;
  }
  const kind = fields.kind || p?.kind || "buy";
  const cft = numOrEmpty(fields.cft);
  const rate = numOrEmpty(fields.rate);
  const amount =
    fields.amount != null && fields.amount !== ""
      ? numOrEmpty(fields.amount)
      : kind === "pay"
        ? 0
        : lineAmount(cft, rate);
  const gst = numOrEmpty(fields.gst);
  // bill amount: leave empty means 0 — do NOT default to amount
  const billAmount = numOrEmpty(fields.billAmount);
  if (!p) {
    p = {
      id: "BUY-" + uid(),
      kind,
      date: todayStr(),
      supplierId: "",
      buyerName: "",
      fromName: "",
      billNo: "",
      cft: 0,
      rate: 0,
      amount: 0,
      gst: 0,
      billAmount: 0,
      note: "",
      cashPaid: 0,
      bankPaid: 0,
      payDate: "",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
  }
  p.kind = kind;
  p.date = (fields.date || p.date || todayStr()).trim();
  p.supplierId = (fields.supplierId || "").trim();
  p.buyerName = (fields.buyerName || p.buyerName || "").trim();
  p.fromName = (fields.fromName || "").trim();
  p.billNo = (fields.billNo || "").trim();
  p.cft = r2(cft);
  p.rate = r2(rate);
  p.amount = r2(amount);
  p.gst = r2(gst);
  p.billAmount = r2(billAmount);
  p.note = (fields.note || "").trim();
  p.cashPaid = r2(numOrEmpty(fields.cashPaid));
  p.bankPaid = r2(numOrEmpty(fields.bankPaid));
  p.payDate = (fields.payDate || "").trim();
  // clear legacy so normalize prefers new fields
  p.topPaid = 0;
  p.billPaid = 0;
  p.topAmount = 0;
  p.updatedAt = nowIso();
  await put("purchases", p);
  return p;
}

export async function deletePurchase(id: string): Promise<void> {
  await delRec("purchases", id);
}

export function buyerName(buyers: Supplier[], id: string, fallback = ""): string {
  return buyers.find((b) => b.id === id)?.name || fallback || "—";
}

/** Save a custom from-account under the agent (deduped, case-insensitive). */
export async function addFromAccount(supplierId: string, fromName: string): Promise<Supplier | null> {
  const name = (fromName || "").trim();
  if (!supplierId || !name) return null;
  const s = await getRec<Supplier>("suppliers", supplierId);
  if (!s) return null;
  const list = [...(s.fromAccounts || [])];
  if (!list.some((x) => x.toLowerCase() === name.toLowerCase())) {
    list.push(name);
    list.sort((a, b) => a.localeCompare(b));
    s.fromAccounts = list;
    s.updatedAt = nowIso();
    await put("suppliers", s);
  }
  return s;
}

export function fromAccountsOf(buyer: Supplier | undefined, rows: Purchase[]): string[] {
  const set = new Set<string>();
  for (const a of buyer?.fromAccounts || []) if (a.trim()) set.add(a.trim());
  if (buyer) {
    for (const r of rows) {
      if (r.supplierId === buyer.id && r.fromName?.trim()) set.add(r.fromName.trim());
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export type FromDash = {
  name: string;
  totals: PurchaseTotals;
};

export type BuyerDash = {
  buyer: Supplier;
  totals: PurchaseTotals;
  froms: FromDash[];
};

/** Per-agent rollup + nested from-account totals (buys + payments). */
export function buyerDashboards(buyers: Supplier[], rows: Purchase[]): BuyerDash[] {
  const out: BuyerDash[] = buyers.map((buyer) => {
    const mine = rows.filter((r) => r.supplierId === buyer.id);
    const fromNames = fromAccountsOf(buyer, rows);
    const froms: FromDash[] = fromNames.map((name) => ({
      name,
      totals: purchaseTotals(
        mine.filter((r) => (r.fromName || "").trim().toLowerCase() === name.toLowerCase()),
      ),
    }));
    const empty = mine.filter((r) => !(r.fromName || "").trim());
    if (empty.length) {
      froms.push({ name: "(no from-account)", totals: purchaseTotals(empty) });
    }
    // busiest / most owed first within the agent
    froms.sort(
      (a, b) =>
        Math.abs(b.totals.balance) - Math.abs(a.totals.balance) ||
        b.totals.total - a.totals.total ||
        a.name.localeCompare(b.name),
    );
    return { buyer, totals: purchaseTotals(mine), froms };
  });
  out.sort(
    (a, b) =>
      Math.abs(b.totals.balance) - Math.abs(a.totals.balance) ||
      b.totals.total - a.totals.total ||
      (a.buyer.name || "").localeCompare(b.buyer.name || ""),
  );
  return out;
}
