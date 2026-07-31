"use client";
// Owner-only contacts directory — report-style: Customers or Carpenters.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { allRec } from "@/lib/data";
import { brandFor } from "@/lib/brand";
import { useApp } from "@/store/useApp";
import type { Customer, Doc } from "@/lib/types";

type Party = {
  id: string;
  name: string;
  phone: string;
  carpenter: string;
  carpenterPhone: string;
};

type CarpenterRow = {
  key: string;
  name: string;
  phone: string;
  parties: { id: string; name: string; phone: string }[];
};

type ViewMode = "customers" | "carpenters";

const norm = (s: string) => s.trim().toLowerCase();

export default function ContactsView() {
  const { ready, dataVersion, user, brandMode, cloakMoney } = useApp();
  const brand = brandFor(brandMode);
  const router = useRouter();
  const [customersRaw, setCustomers] = useState<Customer[]>([]);
  const [quotesRaw, setQuotes] = useState<Doc[]>([]);
  const customers = cloakMoney ? [] : customersRaw;
  const quotes = cloakMoney ? [] : quotesRaw;
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<ViewMode>("customers");

  const load = useCallback(() => {
    Promise.all([allRec<Customer>("customers"), allRec<Doc>("quotations")]).then(([cs, qs]) => {
      setCustomers(cs);
      setQuotes(qs);
    });
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, dataVersion, load]);

  useEffect(() => {
    if (user && user.role !== "owner") router.replace("/");
  }, [user, router]);

  const parties = useMemo(() => {
    const byCust = new Map<string, Doc>();
    for (const d of quotes) {
      if (d.deletedAt || d.purgedAt || !d.customerId) continue;
      const prev = byCust.get(d.customerId);
      if (!prev || (d.updatedAt || d.createdAt || "") > (prev.updatedAt || prev.createdAt || "")) {
        byCust.set(d.customerId, d);
      }
    }
    return customers
      .map((c) => {
        const qDoc = byCust.get(c.id);
        return {
          id: c.id,
          name: (c.name || "").trim() || "—",
          phone: (c.phone || "").trim(),
          carpenter: (c.site || qDoc?.site || "").trim(),
          carpenterPhone: (c.sitePhone || qDoc?.sitePhone || "").trim(),
        } satisfies Party;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [customers, quotes]);

  const filteredParties = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return parties;
    return parties.filter((p) =>
      [p.name, p.phone, p.carpenter, p.carpenterPhone].join(" ").toLowerCase().includes(needle),
    );
  }, [parties, q]);

  const carpenters = useMemo(() => {
    const map = new Map<string, CarpenterRow>();
    for (const p of parties) {
      if (!p.carpenter) continue;
      const key = norm(p.carpenter);
      let row = map.get(key);
      if (!row) {
        row = { key, name: p.carpenter, phone: p.carpenterPhone, parties: [] };
        map.set(key, row);
      }
      if (!row.phone && p.carpenterPhone) row.phone = p.carpenterPhone;
      row.parties.push({ id: p.id, name: p.name, phone: p.phone });
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [parties]);

  const filteredCarpenters = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return carpenters;
    return carpenters.filter((c) => {
      const partyBlob = c.parties.map((p) => p.name + " " + p.phone).join(" ");
      return [c.name, c.phone, partyBlob].join(" ").toLowerCase().includes(needle);
    });
  }, [carpenters, q]);

  if (user && user.role !== "owner") {
    return (
      <div className="empty" style={{ padding: 24 }}>
        Contacts are for the owner only.
      </div>
    );
  }

  const listCount = mode === "customers" ? filteredParties.length : filteredCarpenters.length;

  return (
    <div className="repwrap">
      <div className="sectitle no-print">
        Contacts <small>— customers &amp; carpenters</small>
      </div>

      <div className="rep-controls no-print">
        <div className="rep-range">
          <div className="rep-seg" role="group" aria-label="Contact type">
            <button
              className={mode === "customers" ? "on" : ""}
              type="button"
              onClick={() => setMode("customers")}
            >
              Customers
            </button>
            <button
              className={mode === "carpenters" ? "on" : ""}
              type="button"
              onClick={() => setMode("carpenters")}
            >
              Carpenters
            </button>
          </div>
          <label>
            Search
            <input
              type="search"
              placeholder={mode === "customers" ? "Customer or phone…" : "Carpenter or party…"}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ minWidth: 200 }}
            />
          </label>
          <button className="btn primary sm rep-print" type="button" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </div>

      <div className="rep-doc" id="contacts-report">
        <div className="rep-head">
          <div className="rep-brand">
            <h1>{brand.name || "Contacts"}</h1>
            {brand.addr && <div>{brand.addr}</div>}
          </div>
          <div className="rep-meta">
            <div className="rep-title">{mode === "customers" ? "Customers" : "Carpenters"}</div>
            <div className="rep-period">
              {listCount} {mode === "customers" ? (listCount === 1 ? "party" : "parties") : listCount === 1 ? "carpenter" : "carpenters"}
              {q.trim() ? " · filtered" : ""}
            </div>
          </div>
        </div>

        <div className="rep-summary cols3">
          <div>
            <b>{parties.length}</b>
            <span>Customers</span>
          </div>
          <div>
            <b>{carpenters.length}</b>
            <span>Carpenters</span>
          </div>
          <div>
            <b>{listCount}</b>
            <span>Showing</span>
          </div>
        </div>

        {mode === "customers" ? (
          filteredParties.length === 0 ? (
            <div className="rep-empty">No customers match.</div>
          ) : (
            <table className="rep-table">
              <colgroup>
                <col style={{ width: "6%" }} />
                <col style={{ width: "30%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "24%" }} />
                <col style={{ width: "22%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="c-n">#</th>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Carpenter</th>
                  <th>Carpenter phone</th>
                </tr>
              </thead>
              <tbody>
                {filteredParties.map((p, i) => (
                  <tr key={p.id}>
                    <td className="c-n">{i + 1}</td>
                    <td className="c-cust">
                      <Link href={"/customers/" + p.id} style={{ color: "inherit", fontWeight: 600 }}>
                        {p.name}
                      </Link>
                    </td>
                    <td className="c-no">{p.phone || "—"}</td>
                    <td>{p.carpenter || "—"}</td>
                    <td className="c-no">{p.carpenterPhone || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : filteredCarpenters.length === 0 ? (
          <div className="rep-empty">No carpenters match.</div>
        ) : (
          <table className="rep-table">
            <colgroup>
              <col style={{ width: "6%" }} />
              <col style={{ width: "24%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "44%" }} />
            </colgroup>
            <thead>
              <tr>
                <th className="c-n">#</th>
                <th>Carpenter</th>
                <th>Phone</th>
                <th className="c-n">Parties</th>
                <th>Customers</th>
              </tr>
            </thead>
            <tbody>
              {filteredCarpenters.map((c, i) => (
                <tr key={c.key}>
                  <td className="c-n">{i + 1}</td>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td className="c-no">{c.phone || "—"}</td>
                  <td className="c-n">{c.parties.length}</td>
                  <td className="c-cust">
                    {c.parties.map((p, j) => (
                      <span key={p.id}>
                        {j > 0 ? ", " : ""}
                        <Link href={"/customers/" + p.id} style={{ color: "inherit" }}>
                          {p.name}
                        </Link>
                        {p.phone ? <span style={{ color: "var(--ink-faint)" }}> ({p.phone})</span> : null}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="rep-foot no-print">Tap a customer name to open · owner only</div>
      </div>
    </div>
  );
}
