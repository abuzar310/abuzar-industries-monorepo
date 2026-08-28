import { dateSortKey, nowIso, todayStr } from "./calc";
import { put } from "./data";
import { carpenterKey, commissionPendingOnQuote } from "./carpenter-financials";
import { saveCarpenter, listCarpenters } from "./carpenters";
import { addExpense } from "./expenses";
import type { Carpenter, Doc, Expense, PayMode } from "./types";

const r2 = (n: number) => Math.round(n * 100) / 100;

export const PLACE_RENT_LABEL = "Place rent";
export const PLACE_RENT_SEEDS = ["Ismail", "Suresha"] as const;

export function phoneDigits(s: string): string {
  return (s || "").replace(/\D/g, "");
}

export function phonesMatch(a: string, b: string): boolean {
  const x = phoneDigits(a);
  const y = phoneDigits(b);
  if (x.length < 8 || y.length < 8) return false;
  const x10 = x.slice(-10);
  const y10 = y.slice(-10);
  return x10 === y10 || x.endsWith(y) || y.endsWith(x);
}

export function nameHitsSeed(name: string, seed: string): boolean {
  const n = carpenterKey(name);
  const s = carpenterKey(seed);
  if (!n || !s) return false;
  if (n === s) return true;
  const words = n.split(/[^a-z0-9]+/).filter(Boolean);
  return words.includes(s) || n.startsWith(s + " ");
}

export function isPlaceRentTenant(c: Carpenter | undefined | null): boolean {
  return !!c?.placeRent;
}

export function belongsToTenant(e: Expense, c: Carpenter): boolean {
  if (e.carpenterId && c.id && e.carpenterId === c.id) return true;
  const key = carpenterKey(c.name);
  if (!key) return false;
  if (carpenterKey(e.carpenter || "") === key) return true;
  if (carpenterKey(e.party || "") === key) return true;
  return false;
}

export function placeRentDue(c: Carpenter, expenses: Expense[]): number {
  let due = 0;
  for (const e of expenses) {
    if (!e.placeRentKind || !belongsToTenant(e, c)) continue;
    const a = r2(+e.amount || 0);
    if (e.placeRentKind === "charge" || e.placeRentKind === "opening") due += a;
    else due -= a;
  }
  return r2(Math.max(0, due));
}

export function monthKey(dmy: string): string {
  const [, mm = "", yy = ""] = (dmy || "").split("-");
  return mm && yy ? mm + "-" + yy : "";
}

export function monthTitle(dmy: string): string {
  const [, mm = "", yy = ""] = (dmy || "").split("-");
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const mi = Math.max(1, Math.min(12, +mm || 0)) - 1;
  const year = yy.length === 2 ? "20" + yy : yy;
  return (names[mi] || mm) + (year ? " " + year : "");
}

export function monthCharged(c: Carpenter, expenses: Expense[], dmy: string): boolean {
  const k = monthKey(dmy);
  if (!k) return false;
  return expenses.some((e) => e.placeRentKind === "charge" && belongsToTenant(e, c) && monthKey(e.date) === k);
}

export function matchPlaceRentTenant(
  doc: Pick<Doc, "site" | "sitePhone" | "commLock">,
  tenants: Carpenter[],
): Carpenter | undefined {
  const live = tenants.filter(isPlaceRentTenant);
  const names = [doc.commLock?.carpenter, doc.site].map((s) => (s || "").trim()).filter(Boolean);
  const phone = (doc.sitePhone || "").trim();
  for (const c of live) {
    const ck = carpenterKey(c.name);
    if (names.some((n) => carpenterKey(n) === ck || nameHitsSeed(n, c.name) || nameHitsSeed(c.name, n))) return c;
    if (phone && (phonesMatch(c.phone, phone) || phonesMatch(c.phoneAlt || "", phone))) return c;
  }
  return undefined;
}

export function pendingForTenant(tenant: Carpenter, quotes: Doc[], expenses: Expense[]) {
  return quotes
    .filter((d) => !d.deletedAt && !d.purgedAt)
    .map((d) => ({ d, pending: commissionPendingOnQuote(d, expenses) }))
    .filter((x) => x.pending > 0.5 && matchPlaceRentTenant(x.d, [tenant]))
    .sort((a, b) => (b.d.createdAt || "").localeCompare(a.d.createdAt || ""));
}

export interface PlaceRentStmt {
  id: string;
  date: string;
  at: string;
  kind: "charge" | "opening" | "received" | "setoff";
  label: string;
  sub: string;
  signed: number;
  bal: number;
  quoteId?: string;
}

export function placeRentStatement(c: Carpenter, expenses: Expense[]): PlaceRentStmt[] {
  const rows = expenses
    .filter((e) => !!e.placeRentKind && belongsToTenant(e, c))
    .sort((a, b) => {
      const d = (dateSortKey(a.date) || "").localeCompare(dateSortKey(b.date) || "");
      if (d) return d;
      return (a.createdAt || "").localeCompare(b.createdAt || "");
    });
  let bal = 0;
  return rows.map((e) => {
    const a = r2(+e.amount || 0);
    const signed = e.placeRentKind === "charge" || e.placeRentKind === "opening" ? a : -a;
    bal = r2(bal + signed);
    const kind = e.placeRentKind!;
    const label =
      kind === "charge"
        ? "Place rent charged"
        : kind === "opening"
          ? "Old debt"
          : kind === "received"
            ? "Received"
            : "Against rent";
    const sub = [e.note, e.quoteNo ? "Q#" + e.quoteNo : "", e.mode === "upi" ? "UPI" : kind === "received" ? "Cash" : ""]
      .filter(Boolean)
      .join(" · ");
    return { id: e.id, date: e.date, at: e.createdAt || "", kind, label, sub, signed, bal, quoteId: e.refQuoteId };
  });
}

function pickForSeed(all: Carpenter[], seed: string): Carpenter | undefined {
  const hits = all.filter((c) => nameHitsSeed(c.name, seed));
  if (!hits.length) return undefined;
  const flagged = hits.filter(isPlaceRentTenant);
  const pool = flagged.length ? flagged : hits;
  return pool.slice().sort((a, b) => {
    const pa = (a.phone || "").trim() ? 1 : 0;
    const pb = (b.phone || "").trim() ? 1 : 0;
    if (pb !== pa) return pb - pa;
    return (a.createdAt || "").localeCompare(b.createdAt || "");
  })[0];
}

let ensureInflight: Promise<Carpenter[]> | undefined;

export async function ensurePlaceRentTenants(): Promise<Carpenter[]> {
  if (!ensureInflight) {
    ensureInflight = ensurePlaceRentTenantsOnce().finally(() => {
      ensureInflight = undefined;
    });
  }
  return ensureInflight;
}

async function ensurePlaceRentTenantsOnce(): Promise<Carpenter[]> {
  const all = await listCarpenters();
  const out: Carpenter[] = [];
  const keep = new Set<string>();
  for (const seed of PLACE_RENT_SEEDS) {
    const hit = pickForSeed(all, seed);
    if (hit) {
      if (!hit.placeRent) {
        hit.placeRent = true;
        hit.updatedAt = nowIso();
        await put("carpenters", hit);
      }
      keep.add(hit.id);
      out.push(hit);
      continue;
    }
    const created = await saveCarpenter({ name: seed, notes: "Place rent" });
    created.placeRent = true;
    created.updatedAt = nowIso();
    await put("carpenters", created);
    keep.add(created.id);
    out.push(created);
  }
  for (const c of all) {
    if (!c.placeRent || keep.has(c.id)) continue;
    c.placeRent = false;
    c.updatedAt = nowIso();
    await put("carpenters", c);
  }
  return out.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

export async function setMonthlyRent(c: Carpenter, amount: number): Promise<Carpenter> {
  const next = { ...c, monthlyRent: r2(Math.max(0, amount)), placeRent: true, updatedAt: nowIso() };
  await put("carpenters", next);
  return next;
}

/** Brought-forward rent they already owe. Hits the due, not this month's Charge, not the till. */
export async function addPlaceRentDebt(
  c: Carpenter,
  amount: number,
  enteredBy: string,
  note = "",
  date = todayStr(),
): Promise<Expense> {
  const a = r2(Math.max(0, amount));
  if (a <= 0.5) throw new Error("Enter the old debt amount");
  return addExpense({
    type: "sale",
    amount: a,
    mode: "cash",
    charge: true,
    skipBooks: true,
    label: PLACE_RENT_LABEL,
    party: c.name,
    carpenter: c.name,
    carpenterId: c.id,
    placeRentKind: "opening",
    note: (note || "").trim() || "Old debt",
    date,
    enteredBy,
  });
}

export async function chargePlaceRent(c: Carpenter, amount: number, enteredBy: string, date = todayStr()): Promise<Expense> {
  const a = r2(Math.max(0, amount));
  if (a <= 0.5) throw new Error("Enter the rent amount");
  return addExpense({
    type: "sale",
    amount: a,
    mode: "cash",
    charge: true,
    skipBooks: true,
    label: PLACE_RENT_LABEL,
    party: c.name,
    carpenter: c.name,
    carpenterId: c.id,
    placeRentKind: "charge",
    note: monthTitle(date),
    date,
    enteredBy,
  });
}

export async function receivePlaceRent(
  c: Carpenter,
  amount: number,
  enteredBy: string,
  mode: PayMode = "cash",
  account = "",
  toOwner = false,
  note = "",
  date = todayStr(),
): Promise<Expense> {
  const a = r2(Math.max(0, amount));
  if (a <= 0.5) throw new Error("Enter the amount received");
  return addExpense({
    type: "sale",
    amount: a,
    mode: mode === "upi" ? "upi" : "cash",
    account: mode === "upi" ? account : "",
    toOwner: mode === "upi" ? false : !!toOwner,
    label: PLACE_RENT_LABEL,
    party: c.name,
    carpenter: c.name,
    carpenterId: c.id,
    placeRentKind: "received",
    note,
    date,
    enteredBy,
  });
}

/** Split pending commission: part clears place rent (no cash), part is cash commission (Daybook). */
export async function applyAgainstRent(opts: {
  tenant: Carpenter;
  quote: Doc;
  against: number;
  cash: number;
  enteredBy: string;
  expenses: Expense[];
}): Promise<void> {
  const against = r2(Math.max(0, opts.against));
  const cash = r2(Math.max(0, opts.cash));
  const pending = commissionPendingOnQuote(opts.quote, opts.expenses);
  const due = placeRentDue(opts.tenant, opts.expenses);
  if (against + cash <= 0.5) throw new Error("Enter how much against rent and/or cash");
  if (against + cash > pending + 0.05) throw new Error("Split is more than pending commission ₹" + pending);
  if (against > due + 0.05) throw new Error("Against rent is more than place rent due ₹" + due);
  const quoteNo = (opts.quote.displayNumber || opts.quote.number || "").trim();
  const party = (opts.quote.commLock?.party || opts.quote.customerName || "").trim();
  if (against > 0.5) {
    await addExpense({
      type: "custom",
      amount: against,
      mode: "cash",
      label: "Carpenter commission",
      skipBooks: true,
      carpenter: opts.tenant.name,
      carpenterId: opts.tenant.id,
      placeRentKind: "setoff",
      party,
      refQuoteId: opts.quote.id,
      quoteNo,
      note: "Against place rent",
      enteredBy: opts.enteredBy,
    });
  }
  if (cash > 0.5) {
    await addExpense({
      type: "custom",
      amount: cash,
      mode: "cash",
      label: "Carpenter commission",
      carpenter: opts.tenant.name,
      carpenterId: opts.tenant.id,
      party,
      refQuoteId: opts.quote.id,
      quoteNo,
      note: "Commission (cash)",
      enteredBy: opts.enteredBy,
    });
  }
}
