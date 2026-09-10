import { dateSortKey, nowIso, todayStr } from "./calc";
import { allRec, delRec, getRec, put } from "./data";
import { carpenterKey, sameCarpenterSeed, commissionPendingOnQuote } from "./carpenter-financials";
import { deleteCarpenter, listCarpenters } from "./carpenters";
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
  if (words.includes(s) || n.startsWith(s + " ")) return true;
  return sameCarpenterSeed(n, s);
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

/** Standing old balance on the tenant profile, else the sum of legacy "old debt" rows. */
export function rentOpeningOf(c: Carpenter, expenses: Expense[]): number {
  if (c.rentOpening != null && Number.isFinite(+c.rentOpening)) return r2(Math.max(0, +c.rentOpening));
  let s = 0;
  for (const e of expenses) {
    if (e.placeRentKind === "opening" && belongsToTenant(e, c)) s += r2(+e.amount || 0);
  }
  return r2(s);
}

export function placeRentDue(c: Carpenter, expenses: Expense[]): number {
  let due = rentOpeningOf(c, expenses);
  for (const e of expenses) {
    if (!e.placeRentKind || !belongsToTenant(e, c)) continue;
    if (e.placeRentKind === "opening") continue;
    const a = r2(+e.amount || 0);
    if (e.placeRentKind === "charge") due += a;
    else due -= a;
  }
  return r2(Math.max(0, due));
}

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function monthKey(dmy: string): string {
  const [, mm = "", yy = ""] = (dmy || "").split("-");
  return mm && yy ? mm + "-" + yy : "";
}

/** Accepts 01-08-26 or 08-26. */
export function asMonthKey(v?: string): string {
  const s = (v || "").trim();
  if (!s) return "";
  return s.split("-").length === 3 ? monthKey(s) : s;
}

export function monthTitleFromKey(k: string): string {
  const [mm = "", yy = ""] = (k || "").split("-");
  return mm && yy ? monthTitle("01-" + mm + "-" + yy) : "";
}

export function monthAlloc(c: Carpenter, expenses: Expense[], dmy: string): number {
  const k = monthKey(dmy);
  if (!k) return 0;
  let s = 0;
  for (const e of expenses) {
    if (!belongsToTenant(e, c)) continue;
    if (e.placeRentKind !== "received" && e.placeRentKind !== "setoff") continue;
    if (asMonthKey(e.placeRentMonth) !== k) continue;
    s += r2(+e.amount || 0);
  }
  return r2(s);
}

export function monthRemain(c: Carpenter, expenses: Expense[], dmy: string): number {
  const row = chargeOfMonth(c, expenses, dmy);
  if (!row) return 0;
  return r2(Math.max(0, r2(+row.amount || 0) - monthAlloc(c, expenses, dmy)));
}

export type MonthRentStatus = "empty" | "due" | "part" | "paid";

export function monthRentStatus(c: Carpenter, expenses: Expense[], dmy: string): MonthRentStatus {
  if (!chargeOfMonth(c, expenses, dmy)) return "empty";
  if (monthRemain(c, expenses, dmy) <= 0.5) return "paid";
  if (monthAlloc(c, expenses, dmy) > 0.5) return "part";
  return "due";
}

export function unpaidChargedMonths(c: Carpenter, expenses: Expense[]): { key: string; label: string; remain: number }[] {
  const out: { key: string; label: string; remain: number }[] = [];
  const seen = new Set<string>();
  for (const e of expenses) {
    if (e.placeRentKind !== "charge" || !belongsToTenant(e, c)) continue;
    const k = monthKey(e.date);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const remain = monthRemain(c, expenses, e.date);
    if (remain <= 0.5) continue;
    out.push({ key: k, label: monthTitle(e.date), remain });
  }
  return out.sort((a, b) => a.key.slice(-2).localeCompare(b.key.slice(-2)) || a.key.localeCompare(b.key));
}

export function monthTitle(dmy: string): string {
  const [, mm = "", yy = ""] = (dmy || "").split("-");
  const mi = Math.max(1, Math.min(12, +mm || 0)) - 1;
  const year = yy.length === 2 ? "20" + yy : yy;
  return (MONTH_NAMES[mi] || mm) + (year ? " " + year : "");
}

export function yearFromDmy(dmy: string): number {
  const yy = (dmy || "").split("-")[2] || "";
  const n = +yy;
  if (!n) return new Date().getFullYear();
  return yy.length === 2 ? 2000 + n : n;
}

/** First day of that calendar month — any collection day still counts as this month. */
export function monthFirstDay(year: number, month1to12: number): string {
  const m = Math.max(1, Math.min(12, month1to12 | 0));
  const y = year < 100 ? 2000 + year : year;
  return "01-" + String(m).padStart(2, "0") + "-" + String(y).slice(2);
}

export function monthCharged(c: Carpenter, expenses: Expense[], dmy: string): boolean {
  return !!chargeOfMonth(c, expenses, dmy);
}

export function chargeOfMonth(c: Carpenter, expenses: Expense[], dmy: string): Expense | undefined {
  const k = monthKey(dmy);
  if (!k) return undefined;
  return expenses.find((e) => e.placeRentKind === "charge" && belongsToTenant(e, c) && monthKey(e.date) === k);
}

export function yearMonthsCharged(c: Carpenter, expenses: Expense[], year: number): number {
  let n = 0;
  for (let m = 1; m <= 12; m++) {
    if (monthCharged(c, expenses, monthFirstDay(year, m))) n++;
  }
  return n;
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
  const opening = rentOpeningOf(c, expenses);
  const rows = expenses
    .filter((e) => !!e.placeRentKind && e.placeRentKind !== "opening" && belongsToTenant(e, c))
    .sort((a, b) => {
      const d = (dateSortKey(a.date) || "").localeCompare(dateSortKey(b.date) || "");
      if (d) return d;
      return (a.createdAt || "").localeCompare(b.createdAt || "");
    });
  let bal = opening;
  const out: PlaceRentStmt[] = [];
  if (opening > 0.5) {
    out.push({
      id: "opening:" + c.id,
      date: "",
      at: "",
      kind: "opening",
      label: "Old balance",
      sub: "On profile",
      signed: opening,
      bal: opening,
    });
  }
  for (const e of rows) {
    const a = r2(+e.amount || 0);
    const signed = e.placeRentKind === "charge" ? a : -a;
    bal = r2(bal + signed);
    const kind = e.placeRentKind!;
    const label =
      kind === "charge" ? "Place rent charged" : kind === "received" ? "Received" : "Against rent";
    const sub = [
      e.placeRentMonth ? monthTitleFromKey(asMonthKey(e.placeRentMonth)) : "",
      e.note,
      e.quoteNo ? "Q#" + e.quoteNo : "",
      e.mode === "upi" ? "UPI" : kind === "received" ? "Cash" : "",
    ]
      .filter(Boolean)
      .join(" · ");
    out.push({ id: e.id, date: e.date, at: e.createdAt || "", kind, label, sub, signed, bal, quoteId: e.refQuoteId });
  }
  return out;
}

export function hasTenantPhone(c: Carpenter): boolean {
  return phoneDigits(c.phone).length >= 8 || phoneDigits(c.phoneAlt || "").length >= 8;
}

/** Empty "Suresha" / "Ismail" shells created for the Rent tab — not the real carpenter. */
export function isSeedStub(c: Carpenter, seed: string): boolean {
  if (!nameHitsSeed(c.name, seed)) return false;
  if (hasTenantPhone(c)) return false;
  if (carpenterKey(c.name) !== carpenterKey(seed)) return false;
  const note = carpenterKey(c.notes || "");
  return !note || note === carpenterKey("Place rent");
}

export function tenantScore(c: Carpenter, seed: string): number {
  let n = 0;
  if (hasTenantPhone(c)) n += 100;
  if (carpenterKey(c.name).length > carpenterKey(seed).length) n += 40;
  if (c.placeRent) n += 8;
  if (r2(+(c.monthlyRent || 0) || 0) > 0) n += 4;
  const note = carpenterKey(c.notes || "");
  if (note && note !== carpenterKey("Place rent")) n += 6;
  return n;
}

/** Ismail / Suresha cards — the real carpenter (Planning Work), not a blank stub. */
export function listLinkedRentTenants(all: Carpenter[]): Carpenter[] {
  const used = new Set<string>();
  const out: Carpenter[] = [];
  for (const seed of PLACE_RENT_SEEDS) {
    const hit = pickPlaceRentForSeed(all, seed);
    if (!hit || used.has(hit.id)) continue;
    used.add(hit.id);
    out.push(hit);
  }
  for (const c of all) {
    if (!c.placeRent || used.has(c.id)) continue;
    if (PLACE_RENT_SEEDS.some((s) => isSeedStub(c, s))) continue;
    used.add(c.id);
    out.push(c);
  }
  return out.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

export function pickPlaceRentForSeed(all: Carpenter[], seed: string): Carpenter | undefined {
  const hits = all.filter((c) => nameHitsSeed(c.name, seed));
  if (!hits.length) return undefined;
  return hits.slice().sort((a, b) => {
    const d = tenantScore(b, seed) - tenantScore(a, seed);
    if (d) return d;
    return (a.createdAt || "").localeCompare(b.createdAt || "");
  })[0];
}

function pickForSeed(all: Carpenter[], seed: string): Carpenter | undefined {
  return pickPlaceRentForSeed(all, seed);
}

export function preferKeep(a: Carpenter, b: Carpenter): Carpenter {
  const seed = PLACE_RENT_SEEDS.find((s) => nameHitsSeed(a.name, s) && nameHitsSeed(b.name, s));
  if (seed) return tenantScore(a, seed) >= tenantScore(b, seed) ? a : b;
  if (hasTenantPhone(b) !== hasTenantPhone(a)) return hasTenantPhone(b) ? b : a;
  return a;
}

export function findDuplicateCarpenters(tenant: Carpenter, all: Carpenter[]): Carpenter[] {
  return all.filter((c) => {
    if (c.id === tenant.id) return false;
    const sameName =
      carpenterKey(c.name) === carpenterKey(tenant.name) ||
      nameHitsSeed(c.name, tenant.name) ||
      nameHitsSeed(tenant.name, c.name);
    const samePhone =
      phonesMatch(c.phone, tenant.phone) ||
      phonesMatch(c.phoneAlt || "", tenant.phone) ||
      phonesMatch(c.phone, tenant.phoneAlt || "") ||
      phonesMatch(c.phoneAlt || "", tenant.phoneAlt || "");
    if (sameName && samePhone) return true;
    return PLACE_RENT_SEEDS.some(
      (s) => nameHitsSeed(tenant.name, s) && nameHitsSeed(c.name, s) && (isSeedStub(c, s) || isSeedStub(tenant, s)),
    );
  });
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
  let all = await listCarpenters();
  const keep = new Set<string>();
  const out: Carpenter[] = [];

  for (const seed of PLACE_RENT_SEEDS) {
    const hit = pickForSeed(all, seed);
    if (!hit) continue;
    let tenant = hit;
    const stubs = all.filter((c) => c.id !== hit.id && isSeedStub(c, seed));
    for (const stub of stubs) {
      tenant = await mergePlaceRentTenants(tenant, stub);
      all = await listCarpenters();
    }
    if (!tenant.placeRent) {
      tenant = { ...tenant, placeRent: true, updatedAt: nowIso() };
      await put("carpenters", tenant);
    }
    keep.add(tenant.id);
    out.push(tenant);
  }

  all = await listCarpenters();
  for (const c of all) {
    if (!c.placeRent || keep.has(c.id)) continue;
    if (PLACE_RENT_SEEDS.some((s) => isSeedStub(c, s))) {
      c.placeRent = false;
      c.updatedAt = nowIso();
      await put("carpenters", c);
      continue;
    }
    keep.add(c.id);
    out.push(c);
  }
  return out.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

async function patchCarpenter(c: Carpenter, patch: Partial<Carpenter>): Promise<Carpenter> {
  const live = (c.id ? await getRec<Carpenter>("carpenters", c.id) : undefined) || c;
  const next: Carpenter = { ...live, ...patch, id: live.id, placeRent: true, updatedAt: nowIso() };
  await put("carpenters", next);
  return next;
}

export async function setMonthlyRent(c: Carpenter, amount: number): Promise<Carpenter> {
  return patchCarpenter(c, { monthlyRent: r2(Math.max(0, amount)) });
}

/** Save old balance on the person. Replaces leftover "old debt" rows so the figure cannot snap back. */
export async function setRentOpening(c: Carpenter, amount: number, enteredBy = "unknown"): Promise<Carpenter> {
  const a = r2(Math.max(0, amount));
  const next = await patchCarpenter(c, { rentOpening: a });
  const expenses = await allRec<Expense>("expenses");
  for (const e of expenses) {
    if (e.placeRentKind === "opening" && belongsToTenant(e, next)) await delRec("expenses", e.id);
  }
  if (a > 0.5) await addPlaceRentDebt(next, a, enteredBy, "Old balance");
  return next;
}

export async function mergePlaceRentTenants(keep: Carpenter, drop: Carpenter): Promise<Carpenter> {
  if (keep.id === drop.id) return keep;
  const expenses = await allRec<Expense>("expenses");
  const quotes = await allRec<Doc>("quotations");
  const kOpen = keep.rentOpening;
  const dOpen = drop.rentOpening;
  const rentOpening =
    kOpen != null && dOpen != null
      ? r2(Math.max(0, +kOpen + +dOpen))
      : kOpen != null
        ? r2(Math.max(0, +kOpen))
        : dOpen != null
          ? r2(Math.max(0, +dOpen))
          : keep.rentOpening;
  const monthly = r2(+(keep.monthlyRent || 0) || 0) || r2(+(drop.monthlyRent || 0) || 0);
  const next: Carpenter = {
    ...keep,
    phone: keep.phone || drop.phone,
    phoneAlt: keep.phoneAlt || drop.phoneAlt,
    village: keep.village || drop.village,
    city: keep.city || drop.city,
    notes: keep.notes || drop.notes,
    photo: keep.photo || drop.photo,
    placeRent: true,
    monthlyRent: monthly || keep.monthlyRent || drop.monthlyRent,
    rentOpening,
    updatedAt: nowIso(),
  };
  await put("carpenters", next);

  const dropKey = carpenterKey(drop.name);
  for (const e of expenses) {
    const hit =
      e.carpenterId === drop.id ||
      (!!e.placeRentKind && carpenterKey(e.carpenter || "") === dropKey) ||
      (!!e.placeRentKind && carpenterKey(e.party || "") === dropKey);
    if (!hit) continue;
    const patch: Expense = { ...e, carpenterId: next.id, carpenter: next.name };
    if (carpenterKey(e.party || "") === dropKey) patch.party = next.name;
    await put("expenses", patch);
  }
  for (const q of quotes) {
    if (!q.commLock?.carpenter) continue;
    if (carpenterKey(q.commLock.carpenter) !== dropKey) continue;
    await put("quotations", { ...q, commLock: { ...q.commLock, carpenter: next.name } });
  }
  await deleteCarpenter(drop.id);
  return next;
}

export async function adoptCarpenterAsTenant(current: Carpenter | undefined, chosen: Carpenter): Promise<Carpenter> {
  if (!current) {
    const next = { ...chosen, placeRent: true, updatedAt: nowIso() };
    await put("carpenters", next);
    return next;
  }
  if (current.id === chosen.id) {
    if (chosen.placeRent) return chosen;
    const next = { ...chosen, placeRent: true, updatedAt: nowIso() };
    await put("carpenters", next);
    return next;
  }
  const keep = preferKeep(chosen, current);
  const drop = keep.id === chosen.id ? current : chosen;
  return mergePlaceRentTenants(keep, drop);
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
  if (a <= 0.5) throw new Error("Enter the old balance");
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
    note: (note || "").trim() || "Old balance",
    date,
    enteredBy,
  });
}

export async function unchargePlaceRent(e: Expense): Promise<void> {
  if (e.placeRentKind !== "charge") throw new Error("Only a monthly tick can be removed this way");
  await delRec("expenses", e.id);
}

export async function chargePlaceRent(c: Carpenter, amount: number, enteredBy: string, date = todayStr()): Promise<Expense> {
  const a = r2(Math.max(0, amount));
  if (a <= 0.5) throw new Error("Enter the rent amount");
  const expenses = await allRec<Expense>("expenses");
  if (monthCharged(c, expenses, date)) throw new Error(monthTitle(date) + " is already ticked");
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
  placeRentMonth = "",
): Promise<Expense> {
  const a = r2(Math.max(0, amount));
  if (a <= 0.5) throw new Error("Enter the amount received");
  const mk = asMonthKey(placeRentMonth);
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
    placeRentMonth: mk || undefined,
    note: note || (mk ? monthTitleFromKey(mk) : ""),
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
  placeRentMonth?: string;
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
  const mk = asMonthKey(opts.placeRentMonth);
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
      placeRentMonth: mk || undefined,
      party,
      refQuoteId: opts.quote.id,
      quoteNo,
      note: mk ? "Against " + monthTitleFromKey(mk) : "Against place rent",
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
