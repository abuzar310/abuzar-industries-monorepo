"use client";
// Owner-only contacts directory — report-style layout, parties under each carpenter.
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

type CarpGroup = {
  key: string;
  carpenter: string;
  carpenterPhone: string;
  parties: Party[];
};

type ViewMode = "carpenter" | "flat";

const norm = (s: string) => s.trim().toLowerCase();

export default function ContactsView() {
  const { ready, dataVersion, user, brandMode } = useApp();
  const brand = brandFor(brandMode);
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [quotes, setQuotes] = useState<Doc[]>([]);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<ViewMode>("carpenter");

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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return parties;
    return parties.filter((p) =>
      [p.name, p.phone, p.carpenter, p.carpenterPhone].join(" ").toLowerCase().includes(needle),
    );
  }, [parties, q]);

  const groups = useMemo(() => {
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
      if (!g.carpenterPhone && p.carpenterPhone) g.carpenterPhone = p.carpenterPhone;
    }
    return [...map.values()].sort((a, b) => {
      if (a.key === "none") return 1;
      if (b.key === "none") return -1;
      return a.carpenter.localeCompare(b.carpenter);
    });
  }, [filtered]);

  if (user && user.role !== "owner") {
    return (
      <div className="empty" style={{ padding: 24 }}>
        Contacts are for the owner only.
      </div>
    );
  }

  const withCarp = filtered.filter((p) => !!p.carpenter).length;
  const withPhone = filtered.filter((p) => !!p.phone).length;

  return (
    <div className="repwrap">
      <div className="sectitle no-print">
        Contacts <small>— parties &amp; carpenters</small>
      </div>

      <div className="rep-controls no-print">
        <div className="rep-range">
          <label>
            Search
            <input
              type="search"
              placeholder="Name or phone…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ minWidth: 200 }}
            />
          </label>
          <div className="rep-seg" role="group" aria-label="Layout">
            <button className={mode === "carpenter" ? "on" : ""} type="button" onClick={() => setMode("carpenter")}>
              By carpenter
            </button>
            <button className={mode === "flat" ? "on" : ""} type="button" onClick={() => setMode("flat")}>
              All parties
            </button>
          </div>
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
            <div className="rep-title">Contacts</div>
            <div className="rep-period">
              {mode === "carpenter" ? "Grouped by carpenter" : "All parties"}
              {q.trim() ? " · filtered" : ""}
            </div>
          </div>
        </div>

        <div className="rep-summary cols4">
          <div>
            <b>{filtered.length}</b>
            <span>Parties</span>
          </div>
          <div>
            <b>{groups.filter((g) => g.key !== "none").length}</b>
            <span>Carpenters</span>
          </div>
          <div>
            <b>{withCarp}</b>
            <span>With carpenter</span>
          </div>
          <div>
            <b>{withPhone}</b>
            <span>With phone</span>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rep-empty">No contacts match.</div>
        ) : mode === "flat" ? (
          <PartyTable rows={filtered} showCarpenter />
        ) : (
          groups.map((g) => (
            <div className="rep-month" key={g.key}>
              <div
                className="rep-title rep-subhead rep-month-head"
                style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}
              >
                <span>{g.key === "none" ? "No carpenter" : g.carpenter}</span>
                {g.carpenterPhone ? <span className="rep-subcount">{g.carpenterPhone}</span> : null}
                <span className="rep-subcount" style={{ marginLeft: "auto" }}>
                  {g.parties.length} part{g.parties.length === 1 ? "y" : "ies"}
                </span>
              </div>
              <PartyTable rows={g.parties} showCarpenter={false} />
            </div>
          ))
        )}

        <div className="rep-foot no-print">Tap a name to open the customer · owner only</div>
      </div>
    </div>
  );
}

function PartyTable({ rows, showCarpenter }: { rows: Party[]; showCarpenter: boolean }) {
  return (
    <table className="rep-table">
      <colgroup>
        <col style={{ width: "8%" }} />
        <col style={{ width: showCarpenter ? "28%" : "42%" }} />
        <col style={{ width: showCarpenter ? "18%" : "25%" }} />
        {showCarpenter && <col style={{ width: "24%" }} />}
        {showCarpenter && <col style={{ width: "22%" }} />}
        {!showCarpenter && <col style={{ width: "25%" }} />}
      </colgroup>
      <thead>
        <tr>
          <th className="c-n">#</th>
          <th>Customer</th>
          <th>Phone</th>
          {showCarpenter ? (
            <>
              <th>Carpenter</th>
              <th>Carpenter phone</th>
            </>
          ) : (
            <th>Carpenter phone</th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((p, i) => (
          <tr key={p.id}>
            <td className="c-n">{i + 1}</td>
            <td className="c-cust">
              <Link href={"/customers/" + p.id} style={{ color: "inherit", fontWeight: 600 }}>
                {p.name}
              </Link>
            </td>
            <td className="c-no">{p.phone || "—"}</td>
            {showCarpenter ? (
              <>
                <td>{p.carpenter || "—"}</td>
                <td className="c-no">{p.carpenterPhone || "—"}</td>
              </>
            ) : (
              <td className="c-no">{p.carpenterPhone || "—"}</td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
