import { allRec, delRec, getRec, put } from "./data";
import { dateSortKey, nowIso, pad, todayStr, uid } from "./calc";
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

/** Outstanding on the buy alone (ignores Payments-tab rows — prefer buySettlements). */
export function rowBalance(p: Purchase): number {
  if ((p.kind || "buy") === "pay") return 0;
  return r2(totalPurchase(p) - paidTotal(p));
}

export type BuySettlement = {
  /** Effective cash paid = on-buy cashPaid + FIFO share of Payments-tab cash. */
  cashPaid: number;
  /** Effective bank paid = on-buy bankPaid + FIFO share of Payments-tab bank. */
  bankPaid: number;
  /** Cash portion of the deal still owed. */
  cashDue: number;
  /** Bill / invoice portion still owed. */
  invDue: number;
  /** cashDue + invDue. */
  balance: number;
};

const fromKey = (p: Purchase) =>
  (p.supplierId || "") + "\0" + (p.fromName || "").trim().toLowerCase();

const ascDate = (a: Purchase, b: Purchase) =>
  (dateSortKey(a.date) || "").localeCompare(dateSortKey(b.date) || "") ||
  (a.createdAt || "").localeCompare(b.createdAt || "");

/**
 * Per-buy cash/invoice outstanding after applying Payments-tab pays.
 * Pays with `purchaseId` hit that buy first; leftover + untargeted pays FIFO
 * by date within the same supplier + from-account.
 */
export function buySettlements(rows: Purchase[]): Map<string, BuySettlement> {
  const buys: Purchase[] = [];
  const pays: Purchase[] = [];
  for (const raw of rows) {
    const p = normalizePurchase(raw);
    if (p.kind === "pay") pays.push(p);
    else buys.push(p);
  }
  buys.sort(ascDate);
  pays.sort(ascDate);

  const out = new Map<string, BuySettlement>();
  for (const buy of buys) {
    const cPaid = +buy.cashPaid || 0;
    const bPaid = +buy.bankPaid || 0;
    out.set(buy.id, {
      cashPaid: cPaid,
      bankPaid: bPaid,
      cashDue: r2(Math.max(0, cashAmount(buy) - cPaid)),
      invDue: r2(Math.max(0, (+buy.billAmount || 0) - bPaid)),
      balance: 0,
    });
  }

  const applyOnto = (s: BuySettlement, cash: number, bank: number) => {
    const takeCash = Math.min(s.cashDue, Math.max(0, cash));
    const takeBank = Math.min(s.invDue, Math.max(0, bank));
    s.cashPaid = r2(s.cashPaid + takeCash);
    s.bankPaid = r2(s.bankPaid + takeBank);
    s.cashDue = r2(s.cashDue - takeCash);
    s.invDue = r2(s.invDue - takeBank);
    return { usedCash: takeCash, usedBank: takeBank };
  };

  // Spill pools per supplier+from for money not absorbed by a targeted invoice
  const pools = new Map<string, { cash: number; bank: number }>();
  const addPool = (k: string, cash: number, bank: number) => {
    const cur = pools.get(k) || { cash: 0, bank: 0 };
    cur.cash = r2(cur.cash + cash);
    cur.bank = r2(cur.bank + bank);
    pools.set(k, cur);
  };

  for (const pay of pays) {
    const cash = +pay.cashPaid || 0;
    const bank = +pay.bankPaid || 0;
    const targetId = (pay.purchaseId || "").trim();
    const k = fromKey(pay);
    if (targetId && out.has(targetId)) {
      const { usedCash, usedBank } = applyOnto(out.get(targetId)!, cash, bank);
      addPool(k, cash - usedCash, bank - usedBank);
    } else {
      addPool(k, cash, bank);
    }
  }

  // FIFO untargeted / spill onto buys in each from-account group
  const byGroup = new Map<string, Purchase[]>();
  for (const buy of buys) {
    const k = fromKey(buy);
    const list = byGroup.get(k) || [];
    list.push(buy);
    byGroup.set(k, list);
  }
  for (const [k, list] of byGroup) {
    const pool = pools.get(k) || { cash: 0, bank: 0 };
    for (const buy of list) {
      const s = out.get(buy.id)!;
      const { usedCash, usedBank } = applyOnto(s, pool.cash, pool.bank);
      pool.cash = r2(pool.cash - usedCash);
      pool.bank = r2(pool.bank - usedBank);
    }
  }

  for (const s of out.values()) {
    s.balance = r2(s.cashDue + s.invDue);
  }
  return out;
}

/** Fallback settlement when a buy isn't in the map (shouldn't happen for buys). */
export function settlementOf(p: Purchase, map?: Map<string, BuySettlement>): BuySettlement {
  const hit = map?.get(p.id);
  if (hit) return hit;
  const cPaid = +p.cashPaid || 0;
  const bPaid = +p.bankPaid || 0;
  const cashDue = r2(Math.max(0, cashAmount(p) - cPaid));
  const invDue = r2(Math.max(0, (+p.billAmount || 0) - bPaid));
  return {
    cashPaid: cPaid,
    bankPaid: bPaid,
    cashDue,
    invDue,
    balance: r2(cashDue + invDue),
  };
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
    purchaseId: (raw.purchaseId || "").trim() || undefined,
    payDate: raw.payDate || raw.billPayDate || "",
    remindAt: (raw.remindAt || "").trim(),
    note: raw.note || "",
  };
}

/** Add N calendar days to a dd-mm-yy (defaults today). */
export function addDaysStr(display: string, days: number): string {
  const key = dateSortKey(display || todayStr()) || dateSortKey(todayStr());
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return pad(dt.getDate()) + "-" + pad(dt.getMonth() + 1) + "-" + String(dt.getFullYear()).slice(2);
}

export function isRemindDue(remindAt?: string): boolean {
  const a = dateSortKey((remindAt || "").trim());
  const t = dateSortKey(todayStr());
  return !!a && !!t && a <= t;
}

export function dueReminders(rows: Purchase[]): Purchase[] {
  return rows
    .map(normalizePurchase)
    .filter((p) => (p.kind || "buy") === "buy" && isRemindDue(p.remindAt));
}

export async function setPurchaseReminder(id: string, remindAt: string): Promise<Purchase | null> {
  const existing = await getRec<Purchase>("purchases", id);
  if (!existing) return null;
  const p = normalizePurchase(existing);
  p.remindAt = (remindAt || "").trim();
  p.updatedAt = nowIso();
  await put("purchases", p);
  return p;
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

/** Cash side outstanding from a totals rollup (deal cash − all cash paid). */
export function cashBalOf(t: PurchaseTotals): number {
  return r2((t.cashAmount || 0) - (t.cashPaid || 0));
}
/** Invoice / bank side outstanding from a totals rollup. */
export function invBalOf(t: PurchaseTotals): number {
  return r2((t.billAmount || 0) - (t.bankPaid || 0));
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
  /** kind "pay": buy id this payment is against (optional) */
  purchaseId?: string;
  payDate?: string;
  remindAt?: string;
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
      purchaseId: undefined,
      payDate: "",
      remindAt: "",
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
  if (kind === "pay") {
    p.purchaseId = (fields.purchaseId !== undefined ? fields.purchaseId : p.purchaseId || "").trim() || undefined;
  } else {
    p.purchaseId = undefined;
  }
  p.payDate = (fields.payDate || "").trim();
  if (fields.remindAt !== undefined) p.remindAt = (fields.remindAt || "").trim();
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
