"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec, prefGet, prefSet } from "@/lib/data";
import { inr } from "@/lib/calc";
import {
  carpenterCommissionHistory,
  carpenterDashboard,
  carpenterHref,
  rollupCarpenters,
} from "@/lib/carpenter-financials";
import { editCarpenterDialog, listCarpenters } from "@/lib/carpenters";
import { useApp } from "@/store/useApp";
import { bumpData } from "@/store/app-store";
import CarpenterHistory from "./CarpenterHistory";
import type { Carpenter, Customer, Doc, Expense } from "@/lib/types";

function needle(q: string) {
  return (q || "").trim().toLowerCase();
}

export default function CarpentersView() {
  const { ready, dataVersion, searchTerm, cloakMoney } = useApp();
  const router = useRouter();
  const [directory, setDirectory] = useState<Carpenter[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [quotes, setQuotes] = useState<Doc[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [sortBy, setSortBy] = useState<"az" | "paid">("paid");
  useEffect(() => {
    const saved = prefGet<"az" | "paid">("carpSort", "paid");
    if (saved === "az" || saved === "paid") setSortBy(saved);
  }, []);
  const pickSort = (v: "az" | "paid") => {
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

  const all = cloakMoney ? [] : rollupCarpenters(directory, customers, quotes, expenses);
  const dash = carpenterDashboard(all);
  const q = needle(searchTerm);
  const rows = (q
    ? all.filter((r) =>
        [r.name, r.phone, ...r.customers.map((c) => c.name)].join(" ").toLowerCase().includes(q),
      )
    : all.slice());
  if (sortBy === "paid") {
    rows.sort((a, b) => b.commissionTotal - a.commissionTotal || a.name.localeCompare(b.name));
  } else {
    rows.sort((a, b) => a.name.localeCompare(b.name));
  }
  const history = carpenterCommissionHistory(all).filter((h) =>
    !q || [h.carpenter, h.party, h.quoteNo, h.note, h.date].join(" ").toLowerCase().includes(q),
  );

  return (
    <div>
      <div className="sectitle">
        Carpenters <small>— who they brought, what we paid</small>
      </div>
      <div className="rowbtns" style={{ alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button className="btn primary sm" onClick={addCarpenter}>
          + Add carpenter
        </button>
        <button className="btn sm" onClick={recordCommission}>
          Record commission
        </button>
      </div>

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
          <div className="sub">commission only</div>
        </div>
        <div className="stat">
          <div className="k">Payouts</div>
          <div className="v">{dash.payoutCount}</div>
        </div>
      </div>

      <div className="dash-section" style={{ marginTop: 22 }}>
        Who
        <span>· {rows.length}</span>
        <div className="db-seg sm" style={{ marginLeft: "auto" }} role="group" aria-label="Sort carpenters">
          <button className={"seg-btn" + (sortBy === "paid" ? " on" : "")} type="button" onClick={() => pickSort("paid")}>
            Paid first
          </button>
          <button className={"seg-btn" + (sortBy === "az" ? " on" : "")} type="button" onClick={() => pickSort("az")}>
            A–Z
          </button>
        </div>
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
                  </td>
                  <td className="num">{r.customerCount}</td>
                  <td className="paid">{r.commissionTotal > 0 ? "₹ " + inr(r.commissionTotal) : "—"}</td>
                  <td className="col-last mut">{r.lastPaid || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">
          <div className="empty-title">No carpenters yet</div>
          <div className="empty-note">Add a carpenter, or they appear from a customer, quotation, or commission payout.</div>
        </div>
      )}

      <div className="dash-section" style={{ marginTop: 22 }}>
        Transaction history
        <span>· commission we paid</span>
      </div>
      <CarpenterHistory lines={history} showCarpenter />
    </div>
  );
}
