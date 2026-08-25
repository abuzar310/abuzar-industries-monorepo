import { dateSortKey } from "./calc";
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

export interface CarpenterRollup {
  key: string;
  name: string;
  record?: Carpenter;
  phone: string;
  village: string;
  city: string;
  notes: string;
  customers: CarpenterParty[];
  payouts: CarpenterPayout[];
  customerCount: number;
  quoteCount: number;
  payoutCount: number;
  commissionTotal: number;
  lastPaid: string;
}

type Acc = {
  key: string;
  name: string;
  record?: Carpenter;
  phone: string;
  village: string;
  city: string;
  notes: string;
  parties: Map<string, CarpenterParty>;
  quoteIds: Set<string>;
  payouts: CarpenterPayout[];
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
  return {
    key: a.key,
    name: a.name,
    record: a.record,
    phone: a.phone,
    village: a.village,
    city: a.city,
    notes: a.notes,
    customers,
    payouts,
    customerCount: customers.length,
    quoteCount: a.quoteIds.size,
    payoutCount: payouts.length,
    commissionTotal: r2(payouts.reduce((s, p) => s + p.amount, 0)),
    lastPaid: payouts[0]?.date || "",
  };
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
        village: "",
        city: "",
        notes: "",
        parties: new Map(),
        quoteIds: new Set(),
        payouts: [],
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
  };
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
