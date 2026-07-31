"use client";
// Owner-only contacts directory: parties grouped by carpenter, with phones.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { allRec } from "@/lib/data";
import { useApp } from "@/store/useApp";
import type { Customer, Doc } from "@/lib/types";

type Party = {
  id: string;
  name: string;
  phone: string;
  carpenter: string;
  carpenterPhone: string;
};

type CarpGroup = {
  key: string;
  carpenter: string;
  carpenterPhone: string;
  parties: Party[];
};

const norm = (s: string) => s.trim().toLowerCase();

export default function ContactsView() {
  const { ready, dataVersion, user } = useApp();
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [quotes, setQuotes] = useState<Doc[]>([]);
  const [q, setQ] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);

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
    // latest quote per customer for carpenter fallback
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
        const carpenter = (c.site || qDoc?.site || "").trim();
        const carpenterPhone = (c.sitePhone || qDoc?.sitePhone || "").trim();
        return {
          id: c.id,
          name: (c.name || "").trim() || "—",
          phone: (c.phone || "").trim(),
          carpenter,
          carpenterPhone,
        } satisfies Party;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [customers, quotes]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? parties.filter((p) =>
          [p.name, p.phone, p.carpenter, p.carpenterPhone].join(" ").toLowerCase().includes(needle),
        )
      : parties;

    const map = new Map<string, CarpGroup>();
    for (const p of filtered) {
      const key = p.carpenter ? "c:" + norm(p.carpenter) : "none";
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          carpenter: p.carpenter || "No carpenter",
          carpenterPhone: p.carpenterPhone,
          parties: [],
        };
        map.set(key, g);
      }
      g.parties.push(p);
      // prefer a non-empty carpenter phone if later party has one
      if (!g.carpenterPhone && p.carpenterPhone) g.carpenterPhone = p.carpenterPhone;
    }

    return [...map.values()].sort((a, b) => {
      if (a.key === "none") return 1;
      if (b.key === "none") return -1;
      return a.carpenter.localeCompare(b.carpenter);
    });
  }, [parties, q]);

  // auto-expand first group / all when searching
  useEffect(() => {
    if (q.trim()) setOpenKey(null); // null + search = show all open via logic below
    else if (groups.length && openKey === null) setOpenKey(groups[0]?.key ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups.length, q]);

  if (user && user.role !== "owner") {
    return (
      <div className="empty" style={{ padding: 24 }}>
        Contacts are for the owner only.
      </div>
    );
  }

  const searching = !!q.trim();
  const totalParties = groups.reduce((s, g) => s + g.parties.length, 0);

  return (
    <div className="ledger-page">
      <div className="sectitle">
        Contacts{" "}
        <small>
          — parties &amp; carpenters · {totalParties} customer{totalParties === 1 ? "" : "s"} · {groups.length} carpenter
          {groups.length === 1 ? "" : "s"}
        </small>
      </div>

      <div className="panel-card" style={{ padding: 14, marginBottom: 14 }}>
        <label className="modal-field" style={{ width: "100%", margin: 0 }}>
          <span>Search</span>
          <input
            type="search"
            placeholder="Customer, phone, carpenter…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </div>

      {groups.length === 0 ? (
        <div className="panel-card">
          <div className="empty">No contacts match.</div>
        </div>
      ) : (
        groups.map((g) => {
          const open = searching || openKey === g.key;
          return (
            <div className="panel-card" key={g.key} style={{ marginBottom: 12 }}>
              <div
                className="pc-head"
                style={{ justifyContent: "space-between", cursor: "pointer" }}
                onClick={() => setOpenKey(open && !searching ? null : g.key)}
              >
                <span>
                  <span className="um-caret" style={{ marginRight: 6 }}>
                    {open ? "▾" : "▸"}
                  </span>
                  {g.key === "none" ? "No carpenter" : g.carpenter}
                  {g.carpenterPhone ? (
                    <span className="acct-overall-hint"> · {g.carpenterPhone}</span>
                  ) : null}
                </span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 12, textTransform: "none", letterSpacing: 0 }}>
                  {g.parties.length} part{g.parties.length === 1 ? "y" : "ies"}
                </span>
              </div>
              {open && (
                <div style={{ padding: "0 0 6px" }}>
                  <div
                    className="bank-hdr"
                    style={{
                      margin: "0 12px",
                      gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)",
                    }}
                  >
                    <span>Customer</span>
                    <span>Phone</span>
                    <span>Carpenter</span>
                    <span>Carpenter phone</span>
                  </div>
                  {g.parties.map((p) => (
                    <Link
                      key={p.id}
                      href={"/customers/" + p.id}
                      className="bank-row"
                      style={{
                        margin: "0 12px",
                        gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)",
                        textDecoration: "none",
                        color: "inherit",
                      }}
                    >
                      <span className="bank-parts" style={{ fontWeight: 600 }}>
                        {p.name}
                      </span>
                      <span className="bank-parts">{p.phone || "—"}</span>
                      <span className="bank-parts">{p.carpenter || "—"}</span>
                      <span className="bank-parts">{p.carpenterPhone || "—"}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
