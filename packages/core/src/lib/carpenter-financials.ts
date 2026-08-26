import { dateSortKey } from "./calc";
import { getRec, put } from "./data";
import { spendCatKey } from "./expenses";
import type { Carpenter, Customer, Doc, Expense } from "./types";

const r2 = (n: number) => Math.round(n * 100) / 100;

export function carpenterKey(name: string): string {
  return (name || "").trim().toLowerCase();
}

export function isCarpenterCommission(e: Expense): boolean {
  if (e.type === "sale" || e.charge) return false;
  return spendCatKey(e) === "carpenter";
}

export function carpenterHref(key: string, recordId?: string): string {
  if (recordId) return "/carpenters/" + encodeURIComponent(recordId);
  return "/carpenters/" + encodeURIComponent("n--" + key);
}

export function parseCarpenterParam(raw: string): { recordId?: string; key?: string } {
  const id = decodeURIComponent(raw || "").trim();
  if (id.startsWith("CARP-")) return { recordId: id };
  if (id.startsWith("n--")) return { key: carpenterKey(id.slice(3)) };
  return { key: carpenterKey(id) };
}

export interface CarpenterParty {
  id?: string;
  name: string;
  phone: string;
  quoteCount: number;
}

export interface CarpenterPayout {
  id: string;
  date: string;
  amount: number;
  party: string;
  partyId?: string;
  quoteNo: string;
  quoteId?: string;
  note: string;
  createdAt: string;
}

export interface CarpenterPending {
  quoteId: string;
  quoteNo: string;
  carpenter: string;
  carpenterKey: string;
  party: string;
  partyId?: string;
  locked: number;
  given: number;
  pending: number;
  lockedAt: string;
  lockedBy: string;
}

export interface CarpenterRollup {
  key: string;
  name: string;
  record?: Carpenter;
  phone: string;
  phoneAlt: string;
  village: string;
  city: string;
  notes: string;
  customers: CarpenterParty[];
  payouts: CarpenterPayout[];
  pending: CarpenterPending[];
  customerCount: number;
  quoteCount: number;
  payoutCount: number;
  commissionTotal: number;
  pendingTotal: number;
  pendingCount: number;
  lastPaid: string;
  photo: string;
}

type Acc = {
  key: string;
  name: string;
  record?: Carpenter;
  phone: string;
  phoneAlt: string;
  village: string;
  city: string;
  notes: string;
  parties: Map<string, CarpenterParty>;
  quoteIds: Set<string>;
  payouts: CarpenterPayout[];
  pending: CarpenterPending[];
};

function liveDoc(d: Doc): boolean {
  return !d.deletedAt && !d.purgedAt;
}

function partyKey(c: { id?: string; name: string }): string {
  return c.id || "name:" + carpenterKey(c.name);
}

function findCustomerByName(customers: Customer[], name: string): Customer | undefined {
  const k = carpenterKey(name);
  if (!k) return undefined;
  return customers.find((c) => carpenterKey(c.name) === k);
}

function sortPayouts(a: CarpenterPayout, b: CarpenterPayout): number {
  const kb = dateSortKey(b.date) || b.createdAt || "";
  const ka = dateSortKey(a.date) || a.createdAt || "";
  return kb.localeCompare(ka) || (b.createdAt || "").localeCompare(a.createdAt || "");
}

function finish(a: Acc): CarpenterRollup {
  const customers = [...a.parties.values()].sort((x, y) => x.name.localeCompare(y.name));
  const payouts = [...a.payouts].sort(sortPayouts);
  const pending = [...a.pending]
    .filter((p) => p.pending > 0.005)
    .sort((x, y) => (y.lockedAt || "").localeCompare(x.lockedAt || ""));
  return {
    key: a.key,
    name: a.name,
    record: a.record,
    phone: a.phone,
    phoneAlt: a.phoneAlt || a.record?.phoneAlt || "",
    village: a.village,
    city: a.city,
    notes: a.notes,
    customers,
    payouts,
    pending,
    customerCount: customers.length,
    quoteCount: a.quoteIds.size,
    payoutCount: payouts.length,
    commissionTotal: r2(payouts.reduce((s, p) => s + p.amount, 0)),
    pendingTotal: r2(pending.reduce((s, p) => s + p.pending, 0)),
    pendingCount: pending.length,
    lastPaid: payouts[0]?.date || "",
    photo: a.record?.photo || "",
  };
}

export function lockAmount(d: Pick<Doc, "commLock">): number {
  return r2(Math.max(0, +(d.commLock?.amount || 0) || 0));
}

/** Carpenter commission already given against this quote (wood Commission pay or cash Record commission).
 *  Pass `sinceIso` (the lock time) so money given before the lock does not eat the new pending. */
export function commissionGivenOnQuote(quoteId: string, expenses: Expense[], sinceIso?: string): number {
  if (!quoteId) return 0;
  const seen = new Set<string>();
  let t = 0;
  for (const e of expenses) {
    if (!isCarpenterCommission(e)) continue;
    if (e.sourceId !== quoteId && e.refQuoteId !== quoteId) continue;
    if (sinceIso && (e.createdAt || "") && e.createdAt < sinceIso) continue;
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    t += +e.amount || 0;
  }
  return r2(t);
}

export function commissionPendingOnQuote(d: Doc, expenses: Expense[]): number {
  const locked = lockAmount(d);
  if (locked <= 0 || !liveDoc(d)) return 0;
  return r2(Math.max(0, locked - commissionGivenOnQuote(d.id, expenses, d.commLock?.lockedAt)));
}

export function pendingPayHref(p: Pick<CarpenterPending, "carpenter" | "party" | "partyId" | "quoteId" | "pending">): string {
  const q = new URLSearchParams({ paid: "carpenter" });
  if (p.carpenter) q.set("carpenter", p.carpenter);
  if (p.party) q.set("party", p.party);
  if (p.partyId) q.set("cust", p.partyId);
  if (p.quoteId) q.set("quote", p.quoteId);
  if (p.pending > 0) q.set("amt", String(p.pending));
  return "/receipts?" + q.toString();
}

/** Strip the lock on a quotation. Does not touch payments or expenses. */
export async function deleteCommLock(quoteId: string): Promise<boolean> {
  const d = await getRec<Doc>("quotations", quoteId);
  if (!d?.commLock) return false;
  const next = { ...d };
  delete next.commLock;
  await put("quotations", next);
  return true;
}

/** Directory + customer/quote names + commission payouts, grouped by carpenter name. */
export function rollupCarpenters(
  directory: Carpenter[],
  customers: Customer[],
  quotes: Doc[],
  expenses: Expense[],
): CarpenterRollup[] {
  const map = new Map<string, Acc>();
  const byId = new Map(customers.map((c) => [c.id, c]));
  const quotesById = new Map(quotes.map((d) => [d.id, d]));

  const ensure = (key: string, name: string): Acc => {
    let a = map.get(key);
    if (!a) {
      a = {
        key,
        name: (name || "").trim() || key,
        phone: "",
        phoneAlt: "",
        village: "",
        city: "",
        notes: "",
        parties: new Map(),
        quoteIds: new Set(),
        payouts: [],
        pending: [],
      };
      map.set(key, a);
    } else if (name.trim() && a.name === a.key && name.trim() !== a.key) {
      a.name = name.trim();
    }
    return a;
  };

  const addParty = (a: Acc, party: CarpenterParty) => {
    const pk = partyKey(party);
    const cur = a.parties.get(pk);
    if (!cur) a.parties.set(pk, { ...party, quoteCount: party.quoteCount || 0 });
    else {
      if (!cur.phone && party.phone) cur.phone = party.phone;
      if (!cur.id && party.id) cur.id = party.id;
      if (party.quoteCount) cur.quoteCount += party.quoteCount;
    }
  };

  for (const c of directory) {
    const key = carpenterKey(c.name);
    if (!key) continue;
    const a = ensure(key, c.name);
    a.record = c;
    a.name = (c.name || "").trim() || a.name;
    if (c.phone) a.phone = c.phone;
    if (c.phoneAlt) a.phoneAlt = c.phoneAlt;
    if (c.village) a.village = c.village;
    if (c.city) a.city = c.city;
    if (c.notes) a.notes = c.notes;
  }

  for (const c of customers) {
    const key = carpenterKey(c.site);
    if (!key) continue;
    const a = ensure(key, c.site);
    if (!a.phone && c.sitePhone) a.phone = c.sitePhone;
    if (!a.village && c.siteVillage) a.village = c.siteVillage;
    if (!a.city && c.siteCity) a.city = c.siteCity;
    addParty(a, { id: c.id, name: (c.name || "").trim() || "—", phone: c.phone || "", quoteCount: 0 });
  }

  for (const d of quotes) {
    if (!liveDoc(d)) continue;
    const key = carpenterKey(d.site);
    if (!key) continue;
    const a = ensure(key, d.site);
    if (!a.phone && d.sitePhone) a.phone = d.sitePhone;
    a.quoteIds.add(d.id);
    const cust = d.customerId ? byId.get(d.customerId) : undefined;
    addParty(a, {
      id: cust?.id || d.customerId || undefined,
      name: (cust?.name || d.customerName || "").trim() || "—",
      phone: cust?.phone || d.phone || "",
      quoteCount: 1,
    });
  }

  for (const e of expenses) {
    if (!isCarpenterCommission(e)) continue;
    const q = e.refQuoteId ? quotesById.get(e.refQuoteId) : undefined;
    const namedCust = findCustomerByName(customers, e.party || "");
    let key = carpenterKey(e.carpenter || "");
    let label = (e.carpenter || "").trim();
    if (!key && q) {
      key = carpenterKey(q.site);
      label = (q.site || "").trim();
    }
    if (!key) {
      key = carpenterKey(namedCust?.site || "");
      label = (namedCust?.site || "").trim();
    }
    if (!key) continue;
    const a = ensure(key, label);
    const fromQuote = q?.customerId ? byId.get(q.customerId) : undefined;
    const cust = namedCust || fromQuote;
    const partyName = (e.party || cust?.name || "").trim();
    if (partyName) {
      addParty(a, {
        id: cust?.id,
        name: partyName,
        phone: cust?.phone || "",
        quoteCount: 0,
      });
    }
    a.payouts.push({
      id: e.id,
      date: e.date || "",
      amount: r2(+e.amount || 0),
      party: partyName || "—",
      partyId: cust?.id,
      quoteNo: (e.quoteNo || q?.displayNumber || q?.number || "").trim(),
      quoteId: q && liveDoc(q) ? q.id : e.refQuoteId || undefined,
      note: (e.note || "").trim(),
      createdAt: e.createdAt || "",
    });
  }

  for (const d of quotes) {
    if (!liveDoc(d)) continue;
    const locked = lockAmount(d);
    if (locked <= 0) continue;
    const carpenter = (d.commLock?.carpenter || d.site || "").trim();
    const key = carpenterKey(carpenter);
    if (!key) continue;
    const a = ensure(key, carpenter);
    const cust = d.commLock?.partyId
      ? byId.get(d.commLock.partyId)
      : d.customerId
        ? byId.get(d.customerId)
        : undefined;
    const partyName = (d.commLock?.party || cust?.name || d.customerName || "").trim();
    if (partyName) {
      addParty(a, {
        id: cust?.id || d.commLock?.partyId || d.customerId || undefined,
        name: partyName,
        phone: cust?.phone || d.phone || "",
        quoteCount: 0,
      });
    }
    const given = commissionGivenOnQuote(d.id, expenses, d.commLock?.lockedAt);
    const pendingAmt = r2(Math.max(0, locked - given));
    if (pendingAmt <= 0.005) continue;
    a.pending.push({
      quoteId: d.id,
      quoteNo: (d.displayNumber || d.number || "").trim(),
      carpenter: (carpenter || a.name).trim(),
      carpenterKey: key,
      party: partyName || "—",
      partyId: cust?.id || d.commLock?.partyId || d.customerId || undefined,
      locked,
      given,
      pending: pendingAmt,
      lockedAt: d.commLock?.lockedAt || "",
      lockedBy: d.commLock?.lockedBy || "",
    });
  }

  return [...map.values()].map(finish).sort((a, b) => a.name.localeCompare(b.name));
}

export interface CarpenterHistoryLine extends CarpenterPayout {
  carpenter: string;
  carpenterKey: string;
  href: string;
}

export interface CarpenterDashboard {
  carpenterCount: number;
  customerCount: number;
  commissionTotal: number;
  payoutCount: number;
  pendingTotal: number;
  pendingCount: number;
}

/** Yard totals for the Carpenters home. Customers counted once even if they sit under two names. */
export function carpenterDashboard(rows: CarpenterRollup[]): CarpenterDashboard {
  const seen = new Set<string>();
  for (const r of rows) {
    for (const c of r.customers) seen.add(c.id || "name:" + carpenterKey(c.name));
  }
  return {
    carpenterCount: rows.length,
    customerCount: seen.size,
    commissionTotal: r2(rows.reduce((s, r) => s + r.commissionTotal, 0)),
    payoutCount: rows.reduce((s, r) => s + r.payoutCount, 0),
    pendingTotal: r2(rows.reduce((s, r) => s + r.pendingTotal, 0)),
    pendingCount: rows.reduce((s, r) => s + r.pendingCount, 0),
  };
}

export interface CarpenterPendingLine extends CarpenterPending {
  href: string;
}

/** Remaining locked commission, newest lock first. */
export function carpenterPendingAll(rows: CarpenterRollup[]): CarpenterPendingLine[] {
  const lines: CarpenterPendingLine[] = [];
  for (const r of rows) {
    const href = carpenterHref(r.key, r.record?.id);
    for (const p of r.pending) {
      lines.push({ ...p, href });
    }
  }
  lines.sort((a, b) => (b.lockedAt || "").localeCompare(a.lockedAt || ""));
  return lines;
}

/** Every commission payout, newest first — money we paid carpenters only. */
export function carpenterCommissionHistory(rows: CarpenterRollup[]): CarpenterHistoryLine[] {
  const lines: CarpenterHistoryLine[] = [];
  for (const r of rows) {
    const href = carpenterHref(r.key, r.record?.id);
    for (const p of r.payouts) {
      lines.push({ ...p, carpenter: r.name, carpenterKey: r.key, href });
    }
  }
  lines.sort((a, b) => {
    const kb = dateSortKey(b.date) || b.createdAt || "";
    const ka = dateSortKey(a.date) || a.createdAt || "";
    return kb.localeCompare(ka) || (b.createdAt || "").localeCompare(a.createdAt || "");
  });
  return lines;
}

export function findCarpenterRollup(
  directory: Carpenter[],
  customers: Customer[],
  quotes: Doc[],
  expenses: Expense[],
  param: string,
): CarpenterRollup | null {
  const parsed = parseCarpenterParam(param);
  const all = rollupCarpenters(directory, customers, quotes, expenses);
  if (parsed.recordId) {
    const byRec = all.find((r) => r.record?.id === parsed.recordId);
    if (byRec) return byRec;
    const rec = directory.find((c) => c.id === parsed.recordId);
    if (rec) {
      const key = carpenterKey(rec.name);
      return all.find((r) => r.key === key) || null;
    }
    return null;
  }
  if (!parsed.key) return null;
  return all.find((r) => r.key === parsed.key) || null;
}
