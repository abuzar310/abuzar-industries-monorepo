import { allRec, metaGetCached, metaSet, put } from "./data";
import { uid } from "./calc";
import { bumpData } from "@/store/app-store";
import type { EntryType, Expense } from "./types";

export type SpendCategory = {
  id: string;
  label: string;
  type: EntryType;
  skipBooks?: boolean;
  hidden?: boolean;
};

/** Defaults — Daybook, Receipts, and Books share these. */
export const SPEND_CATEGORIES: SpendCategory[] = [
  { id: "food", label: "Food", type: "food" },
  { id: "salary", label: "Salary", type: "salary" },
  { id: "carpenter", label: "Carpenter commission", type: "custom" },
  { id: "truck", label: "Heavy truck", type: "custom" },
  { id: "minitruck", label: "Mini truck", type: "custom" },
  { id: "transport", label: "Transport", type: "custom" },
  { id: "bills", label: "Bills", type: "custom" },
  { id: "tea", label: "Tea bill", type: "custom" },
  { id: "pigmy", label: "Pignee", type: "custom" },
  { id: "shop", label: "Shop expenses", type: "custom" },
  { id: "unload", label: "Unloading charges", type: "custom" },
  { id: "permit", label: "Permit expenses", type: "custom" },
  { id: "paid-owner", label: "Paid to owner", type: "custom", skipBooks: true },
  { id: "other", label: "Other", type: "custom" },
];

const META = "bookCatalog";

export type IncomeLine = { id: string; label: string; custom?: boolean; hidden?: boolean };

export type BookCatalog = {
  labels: Record<string, string>;
  spend: SpendCategory[];
  income: IncomeLine[];
};

export const BOOK_LABELS: Record<string, string> = {
  "pnl.income": "Income",
  "pnl.expenses": "Expenses",
  "pnl.net": "Net",
  "pnl.surplus": "surplus this month",
  "pnl.deficit": "deficit this month",
  "inc.head": "Income breakdown",
  "inc.cash": "Cash received",
  "inc.upiOwner": "UPI received by owner",
  "inc.upiOther": "UPI others",
  "inc.billed": "Billed (quotes)",
  "inc.dues": "Dues added (no cash)",
  "inc.total": "Total income",
  "exp.head": "Expense breakdown",
  "exp.empty": "No expenses this month",
  "exp.total": "Total expenses",
  "led.head": "Month ledger",
  "led.all": "All",
  "led.in": "Money in",
  "led.out": "All expenses",
  "led.net": "Net for",
  "led.filtered": "Filtered net",
  "cash.head": "Cash book · cash in hand",
  "cash.open": "Opening balance",
  "cash.openNote": "carried forward",
  "cash.close": "Closing balance",
  "bank.head": "Bank book · UPI accounts",
  "bank.acct": "Account",
  "bank.total": "Total UPI on hand",
  "bal.head": "Balance sheet",
  "bal.liab": "Liabilities & Capital",
  "bal.wages": "Unpaid wages",
  "bal.custAdv": "Customer advances",
  "bal.capital": "Owner's capital",
  "bal.assets": "Assets",
  "bal.cash": "Cash in hand",
  "bal.upi": "UPI with holders",
  "bal.dues": "Customer dues",
  "bal.worker": "Worker advances",
  "bal.total": "Total",
  "ast.head": "Assets & Liabilities",
  "ast.hold": "Assets — what the business holds",
  "ast.owe": "Liabilities — what the business owes",
  "ast.assets": "Total assets",
  "ast.liab": "Total liabilities",
  "ast.net": "Net position",
};

const DEFAULT_INCOME: IncomeLine[] = [
  { id: "cash", label: "Cash received" },
  { id: "upiOwner", label: "UPI received by owner" },
  { id: "upiOther", label: "UPI others" },
  { id: "billed", label: "Billed (quotes)" },
  { id: "dues", label: "Dues added (no cash)" },
];

const KEEP = new Set(["food", "salary", "carpenter", "other", "paid-owner"]);

function empty(): BookCatalog {
  return {
    labels: {},
    spend: SPEND_CATEGORIES.map((c) => ({ ...c })),
    income: DEFAULT_INCOME.map((c) => ({ ...c })),
  };
}

function merge(raw: Partial<BookCatalog> | null): BookCatalog {
  const base = empty();
  if (!raw || typeof raw !== "object") return base;
  if (raw.labels && typeof raw.labels === "object") base.labels = { ...raw.labels };
  if (Array.isArray(raw.spend) && raw.spend.length) {
    const byId = new Map(raw.spend.filter((c) => c && c.id).map((c) => [c.id, c]));
    base.spend = SPEND_CATEGORIES.map((d) => {
      const s = byId.get(d.id);
      const rawLab = s ? String(s.label || d.label).trim() || d.label : d.label;
      const label = d.id === "truck" && rawLab === "Truck rent" ? d.label : rawLab;
      return s ? { ...d, label, hidden: !!(s as SpendCategory & { hidden?: boolean }).hidden } : { ...d };
    });
    for (const s of raw.spend) {
      if (!s?.id || SPEND_CATEGORIES.some((d) => d.id === s.id)) continue;
      const label = String(s.label || "").trim();
      if (label) base.spend.push({ id: s.id, label, type: (s.type as EntryType) || "custom" });
    }
  }
  if (Array.isArray(raw.income) && raw.income.length) {
    const byId = new Map(raw.income.filter((c) => c && c.id).map((c) => [c.id, c]));
    base.income = DEFAULT_INCOME.map((d) => {
      const s = byId.get(d.id);
      return s ? { ...d, label: String(s.label || d.label).trim() || d.label, hidden: !!s.hidden } : { ...d };
    });
    for (const s of raw.income) {
      if (!s?.id || DEFAULT_INCOME.some((d) => d.id === s.id)) continue;
      const label = String(s.label || "").trim();
      if (label) base.income.push({ id: s.id, label, custom: true, hidden: !!s.hidden });
    }
  }
  return base;
}

export function loadCatalog(): BookCatalog {
  return merge(metaGetCached<Partial<BookCatalog> | null>(META, null));
}

async function saveCatalog(next: BookCatalog): Promise<void> {
  await metaSet(META, next);
  bumpData();
}

export function bookLabel(id: string): string {
  const cat = loadCatalog();
  const over = (cat.labels[id] || "").trim();
  if (over) return over;
  return BOOK_LABELS[id] || id;
}

export function liveSpendCategories(opts?: { hidden?: boolean; skipBooks?: boolean }): SpendCategory[] {
  let list = loadCatalog().spend;
  if (!opts?.hidden) list = list.filter((c) => !(c as SpendCategory & { hidden?: boolean }).hidden);
  if (opts?.skipBooks === false) list = list.filter((c) => !c.skipBooks);
  return list;
}

export function liveIncomeLines(opts?: { hidden?: boolean }): IncomeLine[] {
  let list = loadCatalog().income;
  if (!opts?.hidden) list = list.filter((c) => !c.hidden);
  return list;
}

export function spendLocked(id: string): boolean {
  return KEEP.has(id);
}

export async function setBookLabel(id: string, label: string): Promise<void> {
  const name = label.trim();
  if (!name) return;
  const cat = loadCatalog();
  cat.labels[id] = name;
  await saveCatalog(cat);
}

export async function renameSpendCategory(id: string, label: string): Promise<void> {
  const name = label.trim();
  if (!name) return;
  const cat = loadCatalog();
  const row = cat.spend.find((c) => c.id === id);
  if (!row) return;
  const old = row.label;
  row.label = name;
  await saveCatalog(cat);
  if (old === name || row.type === "food" || row.type === "salary") return;
  const rows = await allRec<Expense>("expenses");
  for (const e of rows) {
    if ((e.label || "").trim() === old) {
      e.label = name;
      await put("expenses", e);
    }
  }
}

export async function addSpendCategory(label: string): Promise<SpendCategory | null> {
  const name = label.trim();
  if (!name) return null;
  const cat = loadCatalog();
  if (cat.spend.some((c) => c.label.toLowerCase() === name.toLowerCase())) return null;
  const row: SpendCategory = { id: "cat-" + uid(), label: name, type: "custom" };
  cat.spend.push(row);
  await saveCatalog(cat);
  return row;
}

export async function removeSpendCategory(id: string): Promise<boolean> {
  if (KEEP.has(id)) return false;
  const cat = loadCatalog();
  const row = cat.spend.find((c) => c.id === id);
  if (!row) return false;
  const other = cat.spend.find((c) => c.id === "other")!;
  const old = row.label;
  cat.spend = cat.spend.filter((c) => c.id !== id);
  await saveCatalog(cat);
  const rows = await allRec<Expense>("expenses");
  for (const e of rows) {
    if ((e.label || "").trim() === old) {
      e.label = other.label;
      await put("expenses", e);
    }
  }
  return true;
}

export async function renameIncomeLine(id: string, label: string): Promise<void> {
  const name = label.trim();
  if (!name) return;
  const cat = loadCatalog();
  const row = cat.income.find((c) => c.id === id);
  const old = row?.label;
  if (row) row.label = name;
  else cat.labels["inc." + id] = name;
  await saveCatalog(cat);
  if (!row?.custom || !old || old === name) return;
  const rows = await allRec<Expense>("expenses");
  for (const e of rows) {
    if (e.type === "sale" && (e.label || "").trim() === old) {
      e.label = name;
      await put("expenses", e);
    }
  }
}

export async function addIncomeLine(label: string): Promise<IncomeLine | null> {
  const name = label.trim();
  if (!name) return null;
  const cat = loadCatalog();
  if (cat.income.some((c) => c.label.toLowerCase() === name.toLowerCase())) return null;
  const row: IncomeLine = { id: "inc-" + uid(), label: name, custom: true };
  cat.income.push(row);
  await saveCatalog(cat);
  return row;
}

export async function removeIncomeLine(id: string): Promise<boolean> {
  const cat = loadCatalog();
  const row = cat.income.find((c) => c.id === id);
  if (!row?.custom) return false;
  cat.income = cat.income.filter((c) => c.id !== id);
  await saveCatalog(cat);
  return true;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Split sales into cash / UPI plus named extra income (no double-count). */
export function splitCustomIncome(
  sales: Pick<Expense, "label" | "amount" | "mode" | "toOwner">[],
  custom: Pick<IncomeLine, "id" | "label">[],
) {
  const extra = new Map<string, { label: string; amount: number }>();
  const rest = sales.filter((e) => {
    const hit = custom.find((l) => l.label === (e.label || "").trim());
    if (!hit) return true;
    const g = extra.get(hit.id) || { label: hit.label, amount: 0 };
    g.amount = r2(g.amount + (+e.amount || 0));
    extra.set(hit.id, g);
    return false;
  });
  const cash = r2(rest.filter((e) => e.mode !== "upi").reduce((s, e) => s + (+e.amount || 0), 0));
  const upiOwner = r2(rest.filter((e) => e.mode === "upi" && e.toOwner).reduce((s, e) => s + (+e.amount || 0), 0));
  const upiOther = r2(rest.filter((e) => e.mode === "upi" && !e.toOwner).reduce((s, e) => s + (+e.amount || 0), 0));
  const extraAmt = r2([...extra.values()].reduce((s, g) => s + g.amount, 0));
  return {
    cash,
    upi: r2(upiOwner + upiOther),
    upiOwner,
    upiOther,
    extra: [...extra.entries()].map(([id, g]) => ({ id, ...g })),
    total: r2(cash + upiOwner + upiOther + extraAmt),
    count: sales.length,
  };
}
