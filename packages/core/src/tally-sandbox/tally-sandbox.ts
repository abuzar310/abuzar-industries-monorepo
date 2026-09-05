// Isolated Tally trial. Do not import data.ts / ledger.ts / vouchers.ts.
// Browser-only localStorage. Never the yard books.

export type TGroup =
  | "Capital Account"
  | "Current Assets"
  | "Bank Accounts"
  | "Cash-in-Hand"
  | "Sundry Debtors"
  | "Sundry Creditors"
  | "Duties & Taxes"
  | "Sales Accounts"
  | "Purchase Accounts"
  | "Direct Expenses"
  | "Indirect Expenses"
  | "Current Liabilities"
  | "Fixed Assets"
  | "Stock-in-Hand"
  | "Direct Incomes"
  | "Indirect Incomes";

export type TNature = "asset" | "liability" | "income" | "expense";
export type TVch = "Receipt" | "Payment" | "Sales" | "Purchase" | "Journal" | "Contra";

export type TLedger = { id: string; name: string; group: TGroup; opening: number };
export type TLeg = { ledgerId: string; dr: number; cr: number };
export type TVoucher = { id: string; no: number; type: TVch; date: string; legs: TLeg[]; narration: string };

export type TState = {
  company: string;
  fyFrom: string;
  fyTo: string;
  date: string;
  source?: "demo" | "july";
  ledgers: TLedger[];
  vouchers: TVoucher[];
  nextId: number;
  nextNo: Record<TVch, number>;
};

export type TErr = { error: string };

const KEY = "tallySandbox:official:v2";

export const GROUPS: { name: TGroup; nature: TNature }[] = [
  { name: "Capital Account", nature: "liability" },
  { name: "Current Liabilities", nature: "liability" },
  { name: "Sundry Creditors", nature: "liability" },
  { name: "Duties & Taxes", nature: "liability" },
  { name: "Current Assets", nature: "asset" },
  { name: "Bank Accounts", nature: "asset" },
  { name: "Cash-in-Hand", nature: "asset" },
  { name: "Sundry Debtors", nature: "asset" },
  { name: "Fixed Assets", nature: "asset" },
  { name: "Stock-in-Hand", nature: "asset" },
  { name: "Sales Accounts", nature: "income" },
  { name: "Direct Incomes", nature: "income" },
  { name: "Indirect Incomes", nature: "income" },
  { name: "Purchase Accounts", nature: "expense" },
  { name: "Direct Expenses", nature: "expense" },
  { name: "Indirect Expenses", nature: "expense" },
];

export const VCH_TYPES: TVch[] = ["Contra", "Payment", "Receipt", "Journal", "Sales", "Purchase"];

const NATURE = Object.fromEntries(GROUPS.map((g) => [g.name, g.nature])) as Record<TGroup, TNature>;

export const natureOf = (g: TGroup): TNature => NATURE[g];

export const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function inr(n: number) {
  const x = r2(n);
  const abs = Math.abs(x).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return x < 0 ? `-${abs}` : abs;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function todayIso(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function fmtDate(iso: string) {
  const [y, m, d] = (iso || "").split("-").map(Number);
  if (!y || !m || !d) return iso || "";
  return `${String(d).padStart(2, "0")}-${MON[m - 1]}-${String(y).slice(2)}`;
}

export function weekday(iso: string) {
  const [y, m, d] = (iso || "").split("-").map(Number);
  if (!y || !m || !d) return "";
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(y, m - 1, d).getDay()];
}

export function isErr<T>(x: T | TErr): x is TErr {
  return typeof x === "object" && x !== null && "error" in x;
}

export function emptyNos(): Record<TVch, number> {
  return { Receipt: 1, Payment: 1, Sales: 1, Purchase: 1, Journal: 1, Contra: 1 };
}

function L(id: string, name: string, group: TGroup, opening = 0): TLedger {
  return { id, name, group, opening: r2(opening) };
}

export function seedState(): TState {
  let s: TState = {
    company: "Abuzar Industries (trial)",
    fyFrom: "2026-04-01",
    fyTo: "2027-03-31",
    date: "2026-09-05",
    source: "demo",
    ledgers: [
      L("cash", "Cash", "Cash-in-Hand", 100000),
      L("bank", "SBI Current", "Bank Accounts", 250000),
      L("capital", "Capital", "Capital Account", -350000),
      L("sales", "Sales", "Sales Accounts"),
      L("purch", "Purchases", "Purchase Accounts"),
      L("ocgst", "Output CGST 9%", "Duties & Taxes"),
      L("osgst", "Output SGST 9%", "Duties & Taxes"),
      L("icgst", "Input CGST 9%", "Current Assets"),
      L("isgst", "Input SGST 9%", "Current Assets"),
      L("party", "Sample Customer", "Sundry Debtors"),
      L("supplier", "Sample Supplier", "Sundry Creditors"),
      L("freight", "Freight", "Direct Expenses"),
      L("rent", "Rent", "Indirect Expenses"),
    ],
    vouchers: [],
    nextId: 100,
    nextNo: emptyNos(),
  };
  const a = addVoucher(s, {
    type: "Sales",
    date: "2026-09-01",
    narration: "Demo timber sale @ 18% GST",
    legs: [
      { ledgerId: "party", dr: 11800, cr: 0 },
      { ledgerId: "sales", dr: 0, cr: 10000 },
      { ledgerId: "ocgst", dr: 0, cr: 900 },
      { ledgerId: "osgst", dr: 0, cr: 900 },
    ],
  });
  if (isErr(a)) throw new Error(a.error);
  s = a;
  const b = addVoucher(s, {
    type: "Receipt",
    date: "2026-09-03",
    narration: "Cash received from Sample Customer",
    legs: [
      { ledgerId: "cash", dr: 11800, cr: 0 },
      { ledgerId: "party", dr: 0, cr: 11800 },
    ],
  });
  if (isErr(b)) throw new Error(b.error);
  s = b;
  const c = addVoucher(s, {
    type: "Purchase",
    date: "2026-09-04",
    narration: "Demo purchase @ 18% GST",
    legs: [
      { ledgerId: "purch", dr: 5000, cr: 0 },
      { ledgerId: "icgst", dr: 450, cr: 0 },
      { ledgerId: "isgst", dr: 450, cr: 0 },
      { ledgerId: "supplier", dr: 0, cr: 5900 },
    ],
  });
  if (isErr(c)) throw new Error(c.error);
  return { ...c, source: "demo" };
}

const GROUP_OK = new Set<string>(GROUPS.map((g) => g.name));
const GROUP_ALIAS: Record<string, TGroup> = {
  "Cash-in-hand": "Cash-in-Hand",
  "Bank OD": "Bank Accounts",
  "Loans (Liability)": "Current Liabilities",
  "Loans & Advances (Asset)": "Current Assets",
};

export function mapGroup(g: string): TGroup {
  if (GROUP_OK.has(g)) return g as TGroup;
  return GROUP_ALIAS[g] || "Current Assets";
}

export function toIsoDate(d: string) {
  const s = (d || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (!m) return "2026-07-11";
  let y = m[3];
  if (y.length === 2) y = Number(y) >= 70 ? "19" + y : "20" + y;
  return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

export type CloudLedger = { id: string; name: string; group: string; opening?: number };
export type CloudVoucher = {
  id: string;
  no: number;
  type: string;
  date: string;
  legs: TLeg[];
  narration?: string;
};

/** Read-only snapshot of July books. Does not write back to the cloud. */
export function fromCloudBooks(ledgers: CloudLedger[], vouchers: CloudVoucher[]): TState {
  const nos = emptyNos();
  for (const v of vouchers) {
    const t = v.type as TVch;
    if (t in nos && v.no >= nos[t]) nos[t] = v.no + 1;
  }
  return {
    company: "Abuzar Industries (July books)",
    fyFrom: "2026-04-01",
    fyTo: "2027-03-31",
    date: "2026-07-11",
    source: "july",
    ledgers: ledgers.map((l) => ({
      id: l.id,
      name: l.name,
      group: mapGroup(l.group),
      opening: r2(l.opening || 0),
    })),
    vouchers: vouchers.map((v) => ({
      id: v.id,
      no: v.no,
      type: (VCH_TYPES.includes(v.type as TVch) ? v.type : "Journal") as TVch,
      date: toIsoDate(v.date),
      legs: (v.legs || []).map((leg) => ({ ledgerId: leg.ledgerId, dr: r2(leg.dr), cr: r2(leg.cr) })),
      narration: (v.narration || "").trim(),
    })),
    nextId: 10000,
    nextNo: nos,
  };
}

export function loadState(): TState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return seedState();
    const s = JSON.parse(raw) as TState;
    if (!s?.ledgers?.length || !s.nextNo) return seedState();
    return s;
  } catch {
    return seedState();
  }
}

export function saveState(s: TState) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function resetState(): TState {
  const s = seedState();
  saveState(s);
  return s;
}

export function setDate(s: TState, date: string): TState {
  return { ...s, date };
}

export function addLedger(
  s: TState,
  fields: { name: string; group: TGroup; opening: number },
): TState | TErr {
  const name = fields.name.trim();
  if (!name) return { error: "Ledger name is empty" };
  if (s.ledgers.some((l) => l.name.toLowerCase() === name.toLowerCase())) {
    return { error: "Ledger already exists" };
  }
  return {
    ...s,
    nextId: s.nextId + 1,
    ledgers: [...s.ledgers, { id: "t" + s.nextId, name, group: fields.group, opening: r2(fields.opening) }],
  };
}

export function deleteLedger(s: TState, id: string): TState | TErr {
  if (s.vouchers.some((v) => v.legs.some((leg) => leg.ledgerId === id))) {
    return { error: "Ledger is used in a voucher" };
  }
  return { ...s, ledgers: s.ledgers.filter((l) => l.id !== id) };
}

function cleanLegs(legs: TLeg[]): TLeg[] {
  return legs
    .map((leg) => {
      const dr = r2(leg.dr);
      const cr = r2(leg.cr);
      if (dr && cr) return { ledgerId: leg.ledgerId, dr, cr: 0 };
      return { ledgerId: leg.ledgerId, dr, cr };
    })
    .filter((leg) => leg.ledgerId && (leg.dr || leg.cr));
}

export function voucherTotals(legs: TLeg[]) {
  const dr = r2(legs.reduce((n, l) => n + (l.dr || 0), 0));
  const cr = r2(legs.reduce((n, l) => n + (l.cr || 0), 0));
  return { dr, cr, diff: r2(dr - cr) };
}

export function addVoucher(
  s: TState,
  input: { type: TVch; date: string; narration: string; legs: TLeg[] },
): TState | TErr {
  const legs = cleanLegs(input.legs);
  if (legs.length < 2) return { error: "Need at least two ledger lines" };
  if (legs.some((l) => !s.ledgers.some((x) => x.id === l.ledgerId))) {
    return { error: "Unknown ledger on a line" };
  }
  const { dr, cr } = voucherTotals(legs);
  if (dr !== cr) return { error: `Out of balance by ${inr(Math.abs(dr - cr))} ${dr > cr ? "Dr" : "Cr"}` };
  const no = s.nextNo[input.type];
  return {
    ...s,
    nextId: s.nextId + 1,
    nextNo: { ...s.nextNo, [input.type]: no + 1 },
    vouchers: [
      ...s.vouchers,
      {
        id: "t" + s.nextId,
        no,
        type: input.type,
        date: input.date || s.date,
        legs,
        narration: input.narration.trim(),
      },
    ],
  };
}

export function ledgerOf(s: TState, id: string) {
  return s.ledgers.find((l) => l.id === id);
}

export function ledgerBalance(s: TState, id: string) {
  const l = ledgerOf(s, id);
  if (!l) return 0;
  let n = l.opening;
  for (const v of s.vouchers) {
    for (const leg of v.legs) {
      if (leg.ledgerId === id) n = r2(n + leg.dr - leg.cr);
    }
  }
  return n;
}

export type TbRow = { id: string; name: string; group: TGroup; dr: number; cr: number };

export function trialBalance(s: TState) {
  const rows: TbRow[] = s.ledgers
    .map((l) => {
      const bal = ledgerBalance(s, l.id);
      return { id: l.id, name: l.name, group: l.group, dr: bal > 0 ? bal : 0, cr: bal < 0 ? r2(-bal) : 0 };
    })
    .filter((r) => r.dr || r.cr)
    .sort((a, b) => a.name.localeCompare(b.name));
  const totalDr = r2(rows.reduce((n, r) => n + r.dr, 0));
  const totalCr = r2(rows.reduce((n, r) => n + r.cr, 0));
  return { rows, totalDr, totalCr, balanced: totalDr === totalCr };
}

export function profitAndLoss(s: TState) {
  const income: TbRow[] = [];
  const expense: TbRow[] = [];
  for (const l of s.ledgers) {
    const nat = natureOf(l.group);
    const bal = ledgerBalance(s, l.id);
    if (!bal) continue;
    if (nat === "income") income.push({ id: l.id, name: l.name, group: l.group, dr: 0, cr: r2(-bal) });
    if (nat === "expense") expense.push({ id: l.id, name: l.name, group: l.group, dr: bal, cr: 0 });
  }
  const totalIncome = r2(income.reduce((n, r) => n + r.cr, 0));
  const totalExpense = r2(expense.reduce((n, r) => n + r.dr, 0));
  return { income, expense, totalIncome, totalExpense, profit: r2(totalIncome - totalExpense) };
}

export function balanceSheet(s: TState) {
  const assets: TbRow[] = [];
  const liabilities: TbRow[] = [];
  for (const l of s.ledgers) {
    const nat = natureOf(l.group);
    const bal = ledgerBalance(s, l.id);
    if (!bal) continue;
    if (nat === "asset") assets.push({ id: l.id, name: l.name, group: l.group, dr: bal > 0 ? bal : 0, cr: bal < 0 ? r2(-bal) : 0 });
    if (nat === "liability") {
      liabilities.push({ id: l.id, name: l.name, group: l.group, dr: bal > 0 ? bal : 0, cr: bal < 0 ? r2(-bal) : 0 });
    }
  }
  const pnl = profitAndLoss(s);
  if (pnl.profit > 0) {
    liabilities.push({ id: "_pnl", name: "Current-year profit", group: "Capital Account", dr: 0, cr: pnl.profit });
  } else if (pnl.profit < 0) {
    assets.push({ id: "_pnl", name: "Current-year loss", group: "Current Assets", dr: r2(-pnl.profit), cr: 0 });
  }
  const totalAssets = r2(assets.reduce((n, r) => n + r.dr - r.cr, 0));
  const totalLiab = r2(liabilities.reduce((n, r) => n + r.cr - r.dr, 0));
  return { assets, liabilities, totalAssets, totalLiab, balanced: totalAssets === totalLiab, profit: pnl.profit };
}

export function statement(s: TState, id: string) {
  const l = ledgerOf(s, id);
  if (!l) return null;
  const rows = s.vouchers
    .filter((v) => v.legs.some((leg) => leg.ledgerId === id))
    .sort((a, b) => a.date.localeCompare(b.date) || a.no - b.no)
    .map((v) => {
      const mine = v.legs.find((leg) => leg.ledgerId === id)!;
      const other = v.legs.find((leg) => leg.ledgerId !== id);
      return {
        id: v.id,
        date: v.date,
        type: v.type,
        no: v.no,
        particulars: other ? ledgerOf(s, other.ledgerId)?.name || other.ledgerId : v.type,
        dr: mine.dr,
        cr: mine.cr,
      };
    });
  return { ledger: l, opening: l.opening, closing: ledgerBalance(s, id), rows };
}

export function dayBook(s: TState) {
  return [...s.vouchers].sort((a, b) => b.date.localeCompare(a.date) || b.no - a.no);
}
