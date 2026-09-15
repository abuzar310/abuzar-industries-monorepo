import { nowIso, uid } from "./calc";
import { carpenterKey, isShopName, sameCarpenterSeed } from "./carpenter-financials";
import { metaGetCached, metaSet } from "./data";
import type { Carpenter, Customer } from "./types";

// A person card groups the customer rows and carpenter cards that belong to one human: Ismail is a
// customer, a carpenter and a rent tenant. The groups live in one shared setting, so linking never
// edits a customer, carpenter, quotation, receipt or rent row.

export type PersonStore = "customers" | "carpenters";

export interface PersonLink {
  store: PersonStore;
  id: string;
}

export interface Person {
  id: string;
  links: PersonLink[];
  createdAt: string;
}

export const PEOPLE_KEY = "people";

export const sameLink = (a: PersonLink, b: PersonLink) => a.store === b.store && a.id === b.id;

const isLink = (l: unknown): l is PersonLink => {
  const x = l as PersonLink | null;
  return !!x && (x.store === "customers" || x.store === "carpenters") && typeof x.id === "string" && x.id !== "";
};

/** The saved list with anything malformed dropped, so a bad value can't break a page. A card needs two records. */
export function cleanPeople(raw: unknown): Person[] {
  if (!Array.isArray(raw)) return [];
  const out: Person[] = [];
  for (const p of raw as Partial<Person>[]) {
    if (!p || typeof p.id !== "string" || !p.id) continue;
    const links = Array.isArray(p.links) ? p.links.filter(isLink) : [];
    if (links.length > 1) out.push({ id: p.id, links, createdAt: String(p.createdAt || "") });
  }
  return out;
}

export function personOf(people: Person[], link: PersonLink): Person | undefined {
  return people.find((p) => p.links.some((l) => sameLink(l, link)));
}

/** Put two records on one card: start a card, add to one, or join two cards into the first. */
export function withLink(
  people: Person[],
  a: PersonLink,
  b: PersonLink,
  newId: string,
  now: string,
): { people: Person[]; person?: Person } {
  const pa = personOf(people, a);
  const pb = personOf(people, b);
  if (sameLink(a, b) || (pa && pa === pb)) return { people, person: pa };
  const links = [...(pa?.links || [a]), ...(pb?.links || [b])];
  const person: Person = pa ? { ...pa, links } : pb ? { ...pb, links } : { id: newId, links, createdAt: now };
  return { people: [...people.filter((p) => p !== pa && p !== pb), person], person };
}

/** Take one record off its card. A card left with one record goes away: that record stands alone again. */
export function withoutLink(people: Person[], link: PersonLink): Person[] {
  const out: Person[] = [];
  for (const p of people) {
    const links = p.links.filter((l) => !sameLink(l, link));
    if (links.length === p.links.length) out.push(p);
    else if (links.length > 1) out.push({ ...p, links });
  }
  return out;
}

/** A linked record opens its person's card; a record on no card opens a card of its own ("customers:CUST-…"). */
export function personCardHref(link: PersonLink, people: Person[]): string {
  const p = personOf(people, link);
  return "/people/" + encodeURIComponent(p ? p.id : link.store + ":" + link.id);
}

export function parsePersonRef(ref: string): { personId?: string; link?: PersonLink } {
  const i = ref.indexOf(":");
  const store = i > 0 ? ref.slice(0, i) : "";
  if (store === "customers" || store === "carpenters") return { link: { store, id: ref.slice(i + 1) } };
  return { personId: ref };
}

const last10 = (s?: string) => {
  const d = (s || "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
};

/** Records that may be the same human: a shared phone, the same name, or the Ismail/Suresha shop names the
 *  app already treats as one. Only a hint; nothing is linked until someone taps Link. */
export function personSuggestions(on: PersonLink[], customers: Customer[], carpenters: Carpenter[]): PersonLink[] {
  const recs = [
    ...customers.map((c) => ({ link: { store: "customers" as const, id: c.id }, name: c.name || "", phones: [c.phone] })),
    ...carpenters.map((c) => ({ link: { store: "carpenters" as const, id: c.id }, name: c.name || "", phones: [c.phone, c.phoneAlt] })),
  ];
  const onCard = (r: (typeof recs)[number]) => on.some((l) => sameLink(l, r.link));
  const mine = recs.filter(onCard);
  const phones = new Set(mine.flatMap((r) => r.phones.map(last10)).filter(Boolean));
  const keys = new Set(mine.map((r) => carpenterKey(r.name)).filter(Boolean));
  return recs
    .filter((r) => !onCard(r))
    .filter(
      (r) =>
        r.phones.some((p) => phones.has(last10(p))) ||
        keys.has(carpenterKey(r.name)) ||
        mine.some((m) => isShopName(m.name) && isShopName(r.name) && sameCarpenterSeed(m.name, r.name)),
    )
    .map((r) => r.link);
}

export const readPeople = (): Person[] => cleanPeople(metaGetCached<unknown>(PEOPLE_KEY, []));

// ponytail: the whole list is one shared setting, so two phones linking within the same few seconds keep
// only the later change. Links are rare and carry no money; a people table fixes it if that ever bites.
export async function linkPeople(a: PersonLink, b: PersonLink): Promise<Person | undefined> {
  const next = withLink(readPeople(), a, b, "PER-" + uid(), nowIso());
  await metaSet(PEOPLE_KEY, next.people);
  return next.person;
}

export async function unlinkPerson(link: PersonLink): Promise<Person[]> {
  const next = withoutLink(readPeople(), link);
  await metaSet(PEOPLE_KEY, next);
  return next;
}
