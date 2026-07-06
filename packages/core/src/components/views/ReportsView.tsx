"use client";
import { useEffect, useMemo, useState } from "react";
import { allRec } from "@/lib/db";
import { inr, pad } from "@/lib/calc";
import { docTrade } from "@/lib/trading";
import { brandFor } from "@/lib/brand";
import { useApp } from "@/store/useApp";
import type { Doc } from "@/lib/types";

const num = (n: number) =>
  (isFinite(n) ? n : 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type TradeFilter = "sell" | "buy" | "all";

/** Invoice date (dd-mm-yy) → sortable ISO "yyyy-mm-dd"; falls back to createdAt. */
function docISO(d: Doc): string {
  const [dd, mm, yy] = (d.date || "").split("-");
  if (dd && mm && yy) return `20${yy}-${pad(+mm)}-${pad(+dd)}`;
  return (d.createdAt || "").slice(0, 10);
}

/** yyyy-mm-dd → dd-mm-yyyy for display. */
function fmtISO(iso: string): string {
  const [y, m, d] = (iso || "").split("-");
  return y && m && d ? `${d}-${m}-${y}` : iso;
}

const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Indian financial year (Apr 1 – Mar 31) containing `now`. */
function currentFY(now = new Date()): { from: string; to: string; label: string } {
  const y = now.getFullYear();
  const startY = now.getMonth() + 1 >= 4 ? y : y - 1;
  return {
    from: isoOf(startY, 4, 1),
    to: isoOf(startY + 1, 3, 31),
    label: `FY ${startY}-${String(startY + 1).slice(2)}`,
  };
}

export default function ReportsView() {
  const { dataVersion, brandMode } = useApp();
  const brand = brandFor(brandMode);
  const [invoices, setInvoices] = useState<Doc[]>([]);
  const fy = useMemo(() => currentFY(), []);
  const [from, setFrom] = useState(fy.from);
  const [to, setTo] = useState(fy.to);
  const [type, setType] = useState<TradeFilter>("sell");

  useEffect(() => {
    let live = true;
    allRec<Doc>("invoices").then((arr) => {
      if (live) setInvoices(arr.filter((d) => !d.deletedAt));
    });
    return () => {
      live = false;
    };
  }, [dataVersion]);

  const rows = useMemo(() => {
    return invoices
      .filter((d) => {
        const buy = d.tradeType === "buy";
        if (type === "sell") return !buy;
        if (type === "buy") return buy;
        return true;
      })
      .filter((d) => {
        const iso = docISO(d);
        if (from && iso < from) return false;
        if (to && iso > to) return false;
        return true;
      })
      .map((d) => {
        const t = docTrade(d);
        return {
          key: d.id,
          no: d.number || d.id,
          date: d.date,
          iso: docISO(d),
          name: d.customerName || "—",
          gstin: d.custGstin || "",
          buy: t.buy,
          cft: t.cft,
          net: t.taxable,
          gst: t.gst,
          total: t.grand,
        };
      })
      .sort((a, b) => a.iso.localeCompare(b.iso) || String(a.no).localeCompare(String(b.no)));
  }, [invoices, from, to, type]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (s, r) => {
          s.cft += r.cft;
          s.net += r.net;
          s.gst += r.gst;
          s.total += r.total;
          return s;
        },
        { cft: 0, net: 0, gst: 0, total: 0 },
      ),
    [rows],
  );

  const typeLabel = type === "buy" ? "Purchase" : type === "all" ? "Invoice" : "Sales";
  const periodLabel =
    from && to ? `${fmtISO(from)}  to  ${fmtISO(to)}` : from ? `From ${fmtISO(from)}` : to ? `Up to ${fmtISO(to)}` : "All time";

  function preset(kind: "thisMonth" | "lastMonth" | "fy" | "all") {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    if (kind === "thisMonth") {
      setFrom(isoOf(y, m, 1));
      setTo(isoOf(y, m, new Date(y, m, 0).getDate()));
    } else if (kind === "lastMonth") {
      const lm = m === 1 ? 12 : m - 1;
      const ly = m === 1 ? y - 1 : y;
      setFrom(isoOf(ly, lm, 1));
      setTo(isoOf(ly, lm, new Date(ly, lm, 0).getDate()));
    } else if (kind === "fy") {
      const f = currentFY(now);
      setFrom(f.from);
      setTo(f.to);
    } else {
      setFrom("");
      setTo("");
    }
  }

  return (
    <div className="repwrap">
      <div className="sectitle no-print">
        Reports <small>— invoice summary by period</small>
      </div>

      {/* ---- controls (never printed) ---- */}
      <div className="rep-controls no-print">
        <div className="rep-presets">
          <button className="btn sm" onClick={() => preset("thisMonth")}>This month</button>
          <button className="btn sm" onClick={() => preset("lastMonth")}>Last month</button>
          <button className="btn sm" onClick={() => preset("fy")}>{fy.label}</button>
          <button className="btn sm" onClick={() => preset("all")}>All time</button>
        </div>
        <div className="rep-range">
          <label>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <div className="rep-seg">
            {(["sell", "buy", "all"] as TradeFilter[]).map((t) => (
              <button key={t} className={type === t ? "on" : ""} onClick={() => setType(t)}>
                {t === "sell" ? "Sales" : t === "buy" ? "Purchases" : "All"}
              </button>
            ))}
          </div>
          <button className="btn primary sm rep-print" onClick={() => window.print()}>Print / Save PDF</button>
        </div>
      </div>

      {/* ---- the printable report ---- */}
      <div className="rep-doc" id="report">
        <div className="rep-head">
          <div className="rep-brand">
            <h1>{brand.name || "Report"}</h1>
            {brand.addr && <div>{brand.addr}</div>}
            {brand.gstin && <div>GSTIN: {brand.gstin}</div>}
          </div>
          <div className="rep-meta">
            <div className="rep-title">{typeLabel} Report</div>
            <div className="rep-period">{periodLabel}</div>
          </div>
        </div>

        <div className="rep-summary">
          <div><b>{rows.length}</b><span>Invoices</span></div>
          <div><b>{num(totals.cft)}</b><span>CFT {type === "buy" ? "bought" : "sold"}</span></div>
          <div><b>₹{inr(totals.net)}</b><span>Net amount</span></div>
          <div><b>₹{inr(totals.gst)}</b><span>GST</span></div>
          <div><b>₹{inr(totals.total)}</b><span>Total</span></div>
        </div>

        <table className="rep-table">
          <colgroup>
            <col className="w-n" />
            <col className="w-date" />
            <col className="w-no" />
            <col className="w-cust" />
            <col className="w-gst" />
            <col className="w-cft" />
            <col className="w-net" />
            <col className="w-gstamt" />
            <col className="w-total" />
          </colgroup>
          <thead>
            <tr>
              <th className="c-n">#</th>
              <th>Date</th>
              <th>Invoice No</th>
              <th>Customer</th>
              <th>GSTIN</th>
              <th className="amt">CFT</th>
              <th className="amt">Net ₹</th>
              <th className="amt">GST ₹</th>
              <th className="amt">Total ₹</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              <>
                {rows.map((r, i) => (
                  <tr key={r.key}>
                    <td className="c-n">{i + 1}</td>
                    <td className="c-date">{r.date}</td>
                    <td className="c-no">{r.no}</td>
                    <td className="c-cust">{r.name}</td>
                    <td className="c-gst">{r.gstin || "—"}</td>
                    <td className="amt">{num(r.cft)}</td>
                    <td className="amt">{inr(r.net)}</td>
                    <td className="amt">{inr(r.gst)}</td>
                    <td className="amt">{inr(r.total)}</td>
                  </tr>
                ))}
                <tr className="rep-tot">
                  <td colSpan={5}>Total — {rows.length} invoice{rows.length === 1 ? "" : "s"}</td>
                  <td className="amt">{num(totals.cft)}</td>
                  <td className="amt">{inr(totals.net)}</td>
                  <td className="amt">{inr(totals.gst)}</td>
                  <td className="amt">{inr(totals.total)}</td>
                </tr>
              </>
            ) : (
              <tr>
                <td colSpan={9} className="rep-empty">No invoices in this period.</td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="rep-foot">Generated {fmtISO(isoOf(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate()))} · {brand.name}</div>
      </div>
    </div>
  );
}
