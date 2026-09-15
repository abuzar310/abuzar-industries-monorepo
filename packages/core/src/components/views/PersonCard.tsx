"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { inr } from "@/lib/calc";
import { carpenterHref, carpenterKey, findCarpenterRollup } from "@/lib/carpenter-financials";
import { listCarpenters } from "@/lib/carpenters";
import { customerFinancials } from "@/lib/customers";
import { allRec } from "@/lib/data";
import { getFeatures } from "@/lib/features";
import { partyMatches } from "@/lib/party-search";
import {
  linkPeople,
  parsePersonRef,
  personCardHref,
  personOf,
  personSuggestions,
  readPeople,
  sameLink,
  unlinkPerson,
  type PersonLink,
} from "@/lib/people";
import { isPlaceRentTenant, placeRentDue } from "@/lib/place-rent";
import { dialPhone, waLink } from "@/lib/whatsapp";
import { bumpData, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import { useApp } from "@/store/useApp";
import type { Carpenter, Customer, Doc, Expense } from "@/lib/types";
import { TabIcon } from "../Icons";

type Books = { customers: Customer[]; carpenters: Carpenter[]; quotes: Doc[]; invoices: Doc[]; expenses: Expense[] };

type Row = {
  link: PersonLink;
  name: string;
  phones: string[];
  kind: string;
  icon: "customers" | "saw" | "building";
  tenant: boolean;
  owes: number;
  pending: number;
  paidThem: number;
  rentDue: number;
  open: string;
  rent?: string;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** One record with the money its own page shows, worked out by the same functions that page uses. */
function rowFor(link: PersonLink, b: Books, withMoney: boolean): Row | null {
  if (link.store === "customers") {
    const c = b.customers.find((x) => x.id === link.id);
    if (!c) return null;
    let owes = 0;
    if (withMoney) {
      // the same inputs CustomerDetail passes, so Outstanding matches the customer page
      const quotes = b.quotes.filter((d) => d.customerId === c.id);
      const qids = new Set(quotes.map((d) => d.id));
      const expenses = b.expenses.filter((x) => x.custId === c.id || (x.sourceId ? qids.has(x.sourceId) : false));
      const invoices = b.invoices.filter((d) => d.customerId === c.id);
      owes = customerFinancials(c.id, quotes, invoices, c.opening || 0, expenses, !getFeatures().invoices).outstanding;
    }
    return {
      link,
      name: c.name,
      phones: [c.phone],
      kind: "Customer",
      icon: "customers",
      tenant: false,
      owes,
      pending: 0,
      paidThem: 0,
      rentDue: 0,
      open: "/customers/" + encodeURIComponent(c.id),
    };
  }
  const c = b.carpenters.find((x) => x.id === link.id);
  if (!c) return null;
  const tenant = isPlaceRentTenant(c);
  const roll = withMoney ? findCarpenterRollup(b.carpenters, b.customers, b.quotes, b.expenses, c.id) : null;
  return {
    link,
    name: c.name,
    phones: [c.phone, c.phoneAlt || ""],
    kind: tenant ? "Carpenter · Rent" : "Carpenter",
    icon: tenant ? "building" : "saw",
    tenant,
    owes: 0,
    pending: roll?.pendingTotal || 0,
    paidThem: roll?.commissionTotal || 0,
    rentDue: tenant && withMoney ? placeRentDue(c, b.expenses) : 0,
    open: carpenterHref(carpenterKey(c.name), c.id),
    rent: tenant ? "/rent/" + encodeURIComponent(c.id) : undefined,
  };
}

function figure(r: Row): string {
  if (r.link.store === "customers") return "outstanding ₹ " + inr(r.owes);
  return ["pending ₹ " + inr(r.pending), r.tenant ? "rent due ₹ " + inr(r.rentDue) : ""].filter(Boolean).join(" · ");
}

/** One card for one human: their customer rows and carpenter cards, with each page's money side by side. */
export default function PersonCard({ id }: { id: string }) {
  const { ready, dataVersion, cloakMoney } = useApp();
  const router = useRouter();
  const [books, setBooks] = useState<Books | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      allRec<Customer>("customers"),
      listCarpenters(),
      allRec<Doc>("quotations"),
      allRec<Doc>("invoices"),
      allRec<Expense>("expenses"),
    ]).then(([customers, carpenters, quotes, invoices, expenses]) =>
      setBooks({ customers, carpenters, quotes, invoices, expenses }),
    );
  }, []);
  useEffect(() => {
    if (ready) load();
  }, [ready, dataVersion, load]);

  if (!books) {
    return (
      <div className="ph-kit">
        <div className="sectitle">
          Person card <small><span className="desk-only">— </span>loading…</small>
        </div>
      </div>
    );
  }

  const people = readPeople();
  const ref = parsePersonRef(id);
  const person = ref.personId ? people.find((p) => p.id === ref.personId) : ref.link ? personOf(people, ref.link) : undefined;
  const links = person ? person.links : ref.link ? [ref.link] : [];
  const rows = links.map((l) => rowFor(l, books, !cloakMoney)).filter((r): r is Row => !!r);

  if (!rows.length) {
    return (
      <div className="ph-kit">
        <div className="empty">
          <div className="empty-title">Person not found</div>
          <button className="btn sm" style={{ marginTop: 12 }} onClick={() => router.push("/customers")}>
            ← Back to customers
          </button>
        </div>
      </div>
    );
  }

  const name = rows[0].name;
  const phones: string[] = [];
  const seen = new Set<string>();
  for (const p of rows.flatMap((r) => r.phones)) {
    const text = (p || "").trim();
    const key = text.replace(/\D/g, "").slice(-10) || text;
    if (!text || seen.has(key)) continue;
    seen.add(key);
    phones.push(text);
  }
  const customerRows = rows.filter((r) => r.link.store === "customers");
  const carpenterRows = rows.filter((r) => r.link.store === "carpenters");
  const tenantRows = rows.filter((r) => r.tenant);
  const roles = [customerRows.length ? "Customer" : "", carpenterRows.length ? "Carpenter" : "", tenantRows.length ? "Rent tenant" : ""]
    .filter(Boolean)
    .join(" · ");
  const total = (list: Row[], f: (r: Row) => number) => r2(list.reduce((s, r) => s + f(r), 0));
  const owes = total(customerRows, (r) => r.owes);
  const rentDue = total(tenantRows, (r) => r.rentDue);
  const stats = cloakMoney
    ? []
    : [
        ...(customerRows.length ? [{ k: "Outstanding", v: owes, sub: "as a customer", danger: owes > 0.5 }] : []),
        ...(carpenterRows.length
          ? [
              {
                k: "Commission pending",
                v: total(carpenterRows, (r) => r.pending),
                sub: "paid them ₹ " + inr(total(carpenterRows, (r) => r.paidThem)),
                danger: false,
              },
            ]
          : []),
        ...(tenantRows.length ? [{ k: "Rent due", v: rentDue, sub: "place rent", danger: rentDue > 0.5 }] : []),
      ];

  async function link(to: PersonLink, toName: string) {
    if (busy) return;
    setBusy(true);
    try {
      await linkPeople(rows[0].link, to);
      toast(toName + " is on this card now");
      bumpData();
    } finally {
      setBusy(false);
    }
  }

  async function takeOff(r: Row) {
    const yes = await confirmDialog({
      title: "Take " + r.name + " off this card?",
      message: "Only the card changes. Their quotations, receipts and rent stay as they are.",
      confirmLabel: "Take off",
    });
    if (!yes) return;
    const next = await unlinkPerson(r.link);
    toast(r.name + " is off the card");
    bumpData();
    const stay = rows.find((x) => !sameLink(x.link, r.link));
    const pageGone = ref.personId ? !next.some((p) => p.id === ref.personId) : !!ref.link && sameLink(ref.link, r.link);
    if (stay && pageGone) router.replace(personCardHref(stay.link, next));
  }

  return (
    <div className="ph-kit">
      <button className="btn sm" style={{ marginBottom: 14 }} onClick={() => router.back()}>
        ← Back
      </button>

      <div className="custcard" style={{ cursor: "default" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h3 style={{ fontSize: 26 }}>{name}</h3>
            {phones.length ? (
              phones.map((p) => (
                <div className="ph" key={p}>
                  {p}
                </div>
              ))
            ) : (
              <div className="ph">—</div>
            )}
            <div className="meta2">
              {roles}
              <br />
              {person ? (
                <>
                  Person ID <span className="person-id">{person.id}</span>
                </>
              ) : (
                "No other record linked yet"
              )}
            </div>
          </div>
          {phones[0] ? (
            <div className="links" style={{ marginTop: 0 }}>
              <button className="btn call sm" onClick={() => dialPhone(phones[0])}>
                Call
              </button>
              <button className="btn wa sm" onClick={() => window.open(waLink(phones[0], "Hello " + name), "_blank")}>
                WhatsApp
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {stats.length ? (
        <div className="dash-grid" style={{ marginTop: 16 }}>
          {stats.map((s) => (
            <div className="stat" key={s.k}>
              <div className="k">{s.k}</div>
              <div className="v money" style={s.danger ? { color: "var(--danger)" } : undefined}>
                ₹ {inr(s.v)}
              </div>
              <div className="sub">{s.sub}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="dash-section" style={{ marginTop: 22 }}>
        <span className="phone-ico ph-only"><TabIcon icon="customers" size={16} /></span>
        On this card
        <span>· {rows.length} record{rows.length === 1 ? "" : "s"}</span>
      </div>
      <div className="panel-card" style={{ padding: "0 0 4px" }}>
        {rows.map((r) => (
          <div className="stmt person-row" key={r.link.store + ":" + r.link.id}>
            <div className="stmt-ic">
              <TabIcon icon={r.icon} size={16} />
            </div>
            <div className="stmt-main">
              <div className="stmt-to">
                {r.name}
                <span className="acct-overall-hint"> · {r.kind}</span>
              </div>
              <div className="stmt-sub">
                {[r.phones.filter(Boolean).join(" / "), cloakMoney ? "" : figure(r)].filter(Boolean).join(" · ") || "no phone"}
              </div>
            </div>
            <span className="person-acts">
              <button type="button" className="btn sm" onClick={() => router.push(r.open)}>
                Open
              </button>
              {r.rent ? (
                <button type="button" className="btn sm" onClick={() => r.rent && router.push(r.rent)}>
                  Rent
                </button>
              ) : null}
              {rows.length > 1 ? (
                <button type="button" className="btn sm" disabled={busy} onClick={() => void takeOff(r)}>
                  Take off
                </button>
              ) : null}
            </span>
          </div>
        ))}
      </div>

      <LinkFinder books={books} links={links} busy={busy} onLink={(l, n) => void link(l, n)} />
    </div>
  );
}

/** Likely matches first; typing searches every customer and carpenter. Nothing links until Link is tapped. */
function LinkFinder({
  books,
  links,
  busy,
  onLink,
}: {
  books: Books;
  links: PersonLink[];
  busy: boolean;
  onLink: (l: PersonLink, name: string) => void;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim();
  const searching = needle.length >= 2;
  const offCard = (l: PersonLink) => !links.some((x) => sameLink(x, l));
  const list: PersonLink[] = searching
    ? [
        ...books.customers
          .filter((c) => partyMatches(needle, [c.name, c.phone]))
          .map((c) => ({ store: "customers" as const, id: c.id })),
        ...books.carpenters
          .filter((c) => partyMatches(needle, [c.name, c.phone, c.phoneAlt]))
          .map((c) => ({ store: "carpenters" as const, id: c.id })),
      ].filter(offCard)
    : personSuggestions(links, books.customers, books.carpenters);
  const rows = list
    .slice(0, 12)
    .map((l) => rowFor(l, books, false))
    .filter((r): r is Row => !!r);

  return (
    <>
      <div className="dash-section" style={{ marginTop: 22 }}>
        <span className="phone-ico ph-only"><TabIcon icon="plus" size={16} /></span>
        Same person, another record?
        <span>· linking changes no bill, receipt or rent</span>
      </div>
      <input
        className="person-find"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search name or phone"
        aria-label="Search customers and carpenters"
      />
      {!searching && rows.length ? <div className="person-hint">Likely the same person</div> : null}
      <div className="panel-card" style={{ padding: "0 0 4px" }}>
        {rows.length ? (
          rows.map((r) => (
            <div className="stmt person-row" key={r.link.store + ":" + r.link.id}>
              <div className="stmt-ic">
                <TabIcon icon={r.icon} size={16} />
              </div>
              <div className="stmt-main">
                <div className="stmt-to">
                  {r.name}
                  <span className="acct-overall-hint"> · {r.kind}</span>
                </div>
                <div className="stmt-sub">{r.phones.filter(Boolean).join(" / ") || "no phone"}</div>
              </div>
              <span className="person-acts">
                <button type="button" className="btn primary sm" disabled={busy} onClick={() => onLink(r.link, r.name)}>
                  Link
                </button>
              </span>
            </div>
          ))
        ) : (
          <div className="empty">
            {searching ? "Nobody found for " + needle + "." : "No likely matches. Search by name or phone."}
          </div>
        )}
      </div>
    </>
  );
}
