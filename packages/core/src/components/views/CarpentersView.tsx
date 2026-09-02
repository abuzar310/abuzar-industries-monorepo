"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec, prefGet, prefSet } from "@/lib/data";
import { inr } from "@/lib/calc";
import {
  carpenterCommissionHistory,
  carpenterDashboard,
  carpenterHref,
  carpenterPendingAll,
  rollupCarpenters,
  type CarpenterRollup,
} from "@/lib/carpenter-financials";
import { editCarpenterDialog, listCarpenters, resolveCarpenterRecord, setCarpenterPhoto } from "@/lib/carpenters";
import { partyMatches } from "@/lib/party-search";
import { dialPhone, waLink } from "@/lib/whatsapp";
import { useApp } from "@/store/useApp";
import { bumpData, setSearch, toast } from "@/store/app-store";
import CarpenterHistory, { CarpenterPendingList } from "./CarpenterHistory";
import PartySearchBar from "../PartySearchBar";
import PhotoField from "../PhotoField";
import type { Carpenter, Customer, Doc, Expense } from "@/lib/types";

type PageTab = "who" | "commission";

function rollupFields(r: CarpenterRollup) {
  return [r.name, r.phone, r.phoneAlt, r.village, r.city, r.notes, ...r.customers.flatMap((c) => [c.name, c.phone])];
}

export default function CarpentersView() {
  const { ready, dataVersion, searchTerm, cloakMoney } = useApp();
  const router = useRouter();
  const [q, setQ] = useState(searchTerm);
  useEffect(() => {
    setQ(searchTerm);
  }, [searchTerm]);
  function pickQuery(v: string) {
    setQ(v);
    if (!v) setSearch("");
  }
  const [directory, setDirectory] = useState<Carpenter[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [quotes, setQuotes] = useState<Doc[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [tab, setTab] = useState<PageTab>("who");
  const [sortBy, setSortBy] = useState<"az" | "paid" | "pending">("paid");
  useEffect(() => {
    const savedTab = prefGet<PageTab>("carpPageTab", "who");
    if (savedTab === "who" || savedTab === "commission") setTab(savedTab);
    const saved = prefGet<"az" | "paid" | "pending">("carpSort", "paid");
    if (saved === "az" || saved === "paid" || saved === "pending") setSortBy(saved);
  }, []);
  const pickTab = (v: PageTab) => {
    setTab(v);
    prefSet("carpPageTab", v);
  };
  const pickSort = (v: "az" | "paid" | "pending") => {
    setSortBy(v);
    prefSet("carpSort", v);
  };

  const load = useCallback(() => {
    Promise.all([
      listCarpenters(),
      allRec<Customer>("customers"),
      allRec<Doc>("quotations"),
      allRec<Expense>("expenses"),
    ]).then(([carp, c, q, e]) => {
      setDirectory(carp);
      setCustomers(c);
      setQuotes(q);
      setExpenses(e);
    });
  }, []);
  useEffect(() => {
    if (ready) load();
  }, [load, dataVersion, ready]);

  async function addCarpenter() {
    const c = await editCarpenterDialog();
    if (c) {
      load();
      bumpData();
    }
  }
  function recordCommission() {
    router.push("/receipts?paid=carpenter");
  }
  function recordFor(e: React.MouseEvent, r: CarpenterRollup) {
    e.stopPropagation();
    const q = new URLSearchParams({ paid: "carpenter", carpenter: r.name });
    router.push("/receipts?" + q.toString());
  }
  function whatsapp(e: React.MouseEvent, r: CarpenterRollup, phone?: string) {
    e.stopPropagation();
    const n = (phone || r.phone || "").trim();
    if (!n) return;
    window.open(waLink(n, "Hello " + (r.name || "")), "_blank");
  }
  function call(e: React.MouseEvent, r: CarpenterRollup, phone?: string) {
    const n = (phone || r.phone || "").trim();
    if (!n) return;
    dialPhone(n, e);
  }
  async function edit(e: React.MouseEvent, r: CarpenterRollup) {
    e.stopPropagation();
    const rec = resolveCarpenterRecord(r, directory);
    const next = await editCarpenterDialog(
      rec ||
        ({
          name: r.name,
          phone: r.phone,
          phoneAlt: r.phoneAlt,
          village: r.village,
          city: r.city,
          notes: r.notes,
          photo: r.photo,
        } as Carpenter),
      r.name,
    );
    if (!next) return;
    load();
    bumpData();
  }

  async function savePhoto(r: CarpenterRollup, photo: string) {
    const rec = resolveCarpenterRecord(r, directory);
    await setCarpenterPhoto(
      rec
        ? { record: rec, name: rec.name, phone: rec.phone, phoneAlt: rec.phoneAlt, village: rec.village || "", city: rec.city || "", notes: rec.notes || "" }
        : r,
      photo,
    );
    bumpData();
    toast(photo ? "Photo saved" : "Photo removed");
  }

  const query = q.trim();
  const all = useMemo(
    () => (cloakMoney ? [] : rollupCarpenters(directory, customers, quotes, expenses)),
    [cloakMoney, directory, customers, quotes, expenses],
  );
  const dash = useMemo(() => carpenterDashboard(all), [all]);
  const rows = useMemo(() => {
    const next = all.filter((r) => partyMatches(query, rollupFields(r)));
    if (sortBy === "pending") {
      next.sort((a, b) => b.pendingTotal - a.pendingTotal || b.commissionTotal - a.commissionTotal || a.name.localeCompare(b.name));
    } else if (sortBy === "paid") {
      next.sort((a, b) => b.commissionTotal - a.commissionTotal || a.name.localeCompare(b.name));
    } else {
      next.sort((a, b) => a.name.localeCompare(b.name));
    }
    return next;
  }, [all, query, sortBy]);
  const history = useMemo(
    () =>
      carpenterCommissionHistory(all).filter((h) => partyMatches(query, [h.carpenter, h.party, h.quoteNo, h.note, h.date])),
    [all, query],
  );
  const pending = useMemo(
    () => carpenterPendingAll(all).filter((p) => partyMatches(query, [p.carpenter, p.party, p.quoteNo])),
    [all, query],
  );

  return (
    <div>
      <div className="sectitle">
        Carpenters{" "}
        <small>
          {tab === "who"
            ? "— " + rows.length + " contact" + (rows.length === 1 ? "" : "s")
            : "— pending and paid"}
        </small>
      </div>
      <div className="rowbtns" style={{ alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div className="db-seg sm" role="group" aria-label="Carpenters or commission">
          <button className={"seg-btn" + (tab === "who" ? " on" : "")} type="button" onClick={() => pickTab("who")}>
            Who
          </button>
          <button
            className={"seg-btn" + (tab === "commission" ? " on" : "")}
            type="button"
            onClick={() => pickTab("commission")}
          >
            Commission
          </button>
        </div>
        <button className="btn primary sm" onClick={addCarpenter}>
          + Add carpenter
        </button>
        <button className="btn sm" onClick={recordCommission}>
          Record commission
        </button>
        <div className="db-seg sm" style={{ marginLeft: "auto" }} role="group" aria-label="Sort carpenters">
          <button className={"seg-btn" + (sortBy === "pending" ? " on" : "")} type="button" onClick={() => pickSort("pending")}>
            Pending first
          </button>
          <button className={"seg-btn" + (sortBy === "paid" ? " on" : "")} type="button" onClick={() => pickSort("paid")}>
            Paid first
          </button>
          <button className={"seg-btn" + (sortBy === "az" ? " on" : "")} type="button" onClick={() => pickSort("az")}>
            A–Z
          </button>
        </div>
      </div>

      <PartySearchBar
        value={q}
        onChange={pickQuery}
        placeholder="Search name, phone, village, customer…"
        count={rows.length}
        total={all.length}
      />

      {tab === "who" ? (
        <>
        <div className="custgrid">
          {rows.length ? (
            rows.map((r) => (
              <div
                className="custcard"
                key={r.record?.id || r.key}
                onClick={() => router.push(carpenterHref(r.key, r.record?.id))}
                style={{ cursor: "pointer" }}
              >
                <div className="carp-card-top">
                  <PhotoField
                    compact
                    size={72}
                    name={r.name}
                    value={r.photo || r.record?.photo || ""}
                    onChange={(url) => savePhoto(r, url)}
                  />
                  <div className="carp-who">
                    <h3>{r.name}</h3>
                    <div className="ph">{r.phone || "—"}</div>
                    {r.phoneAlt ? <div className="ph">Alt {r.phoneAlt}</div> : null}
                  </div>
                </div>
                <div className="meta2">
                  {(r.village || r.city) && (
                    <>
                      {[r.village, r.city].filter(Boolean).join(", ")}
                      <br />
                    </>
                  )}
                  <b>{r.customerCount}</b> customer{r.customerCount === 1 ? "" : "s"}
                  {" · "}
                  <b>{r.quoteCount}</b> quote{r.quoteCount === 1 ? "" : "s"}
                  {r.commissionTotal > 0 && (
                    <>
                      <br />
                      <span style={{ color: "var(--ink-faint)" }}>Paid ₹ {inr(r.commissionTotal)}</span>
                    </>
                  )}
                  {r.pendingTotal > 0.5 && (
                    <>
                      <br />
                      <span style={{ color: "var(--danger)" }}>₹ {inr(r.pendingTotal)} pending</span>
                    </>
                  )}
                </div>
                <div className="links">
                  <button className="btn sm" onClick={(e) => recordFor(e, r)}>
                    Record commission
                  </button>
                  {r.phone ? (
                    <>
                      <button className="btn call sm" onClick={(e) => call(e, r, r.phone)}>
                        Call
                      </button>
                      <button className="btn wa sm" onClick={(e) => whatsapp(e, r, r.phone)}>
                        WhatsApp
                      </button>
                    </>
                  ) : null}
                  {r.phoneAlt && r.phoneAlt !== r.phone ? (
                    <>
                      <button className="btn call sm" onClick={(e) => call(e, r, r.phoneAlt)}>
                        Call alt
                      </button>
                      <button className="btn wa sm" onClick={(e) => whatsapp(e, r, r.phoneAlt)}>
                        Alt WhatsApp
                      </button>
                    </>
                  ) : null}
                  <button className="btn sm" onClick={(e) => void edit(e, r)}>
                    Edit
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="empty">
              <div className="empty-title">{query ? "No matches" : "No carpenters yet"}</div>
              <div className="empty-note">
                {query
                  ? "Try a name, phone digits, village, or a customer they brought."
                  : "Add a carpenter, or they appear from a customer, quotation, or commission payout."}
              </div>
            </div>
          )}
        </div>
        </>
      ) : (
        <>
          <div className="dash-grid" style={{ marginTop: 16 }}>
            <div className="stat">
              <div className="k">Carpenters</div>
              <div className="v">{dash.carpenterCount}</div>
            </div>
            <div className="stat">
              <div className="k">Customers</div>
              <div className="v">{dash.customerCount}</div>
              <div className="sub">brought by carpenters</div>
            </div>
            <div className="stat">
              <div className="k">Paid them</div>
              <div className="v money">₹ {inr(dash.commissionTotal)}</div>
              <div className="sub">
                {dash.payoutCount} payout{dash.payoutCount === 1 ? "" : "s"}
              </div>
            </div>
            <div className="stat">
              <div className="k">Pending</div>
              <div className="v money">₹ {inr(dash.pendingTotal)}</div>
              <div className="sub">{dash.pendingCount} locked</div>
            </div>
          </div>

          <div className="dash-section" style={{ marginTop: 22 }}>
            Pending
            <span>· locked, not yet given</span>
          </div>
          <CarpenterPendingList lines={pending} showCarpenter />

          <div className="dash-section" style={{ marginTop: 22 }}>
            Who
            <span>· {rows.length}</span>
          </div>
          {rows.length ? (
            <div className="panel-card" style={{ marginTop: 0 }}>
              <table className="carp-roster">
                <thead>
                  <tr>
                    <th>Carpenter</th>
                    <th className="col-phone">Phone</th>
                    <th className="num">Customers</th>
                    <th className="num">Paid</th>
                    <th className="num">Pending</th>
                    <th className="col-last">Last payout</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.record?.id || r.key}
                      onClick={() => router.push(carpenterHref(r.key, r.record?.id))}
                    >
                      <td>
                        <div className="nm">{r.name}</div>
                      </td>
                      <td className="col-phone">
                        <div className="ph">{r.phone || "—"}</div>
                        {r.phoneAlt ? <div className="ph">Alt {r.phoneAlt}</div> : null}
                      </td>
                      <td className="num">{r.customerCount}</td>
                      <td className="paid">{r.commissionTotal > 0 ? "₹ " + inr(r.commissionTotal) : "—"}</td>
                      <td className="pend">{r.pendingTotal > 0 ? "₹ " + inr(r.pendingTotal) : "—"}</td>
                      <td className="col-last mut">{r.lastPaid || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">
              <div className="empty-title">{query ? "No matches" : "No carpenters yet"}</div>
              <div className="empty-note">
                {query
                  ? "Try a name, phone digits, village, or a customer they brought."
                  : "Add a carpenter, or they appear from a customer, quotation, or commission payout."}
              </div>
            </div>
          )}
          <div className="dash-section" style={{ marginTop: 22 }}>
            Transaction history
            <span>· commission we paid</span>
          </div>
          <CarpenterHistory lines={history} showCarpenter />
        </>
      )}
    </div>
  );
}
