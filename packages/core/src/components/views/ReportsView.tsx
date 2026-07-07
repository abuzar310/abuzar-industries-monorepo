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

/** Trailing run of digits in an invoice number, for numeric sorting ("2694" → 2694). */
const numOf = (s: unknown) => {
  const m = String(s ?? "").match(/(\d+)\D*$/);
  return m ? parseInt(m[1], 10) : 0;
};

type TradeFilter = "sell" | "buy" | "all";

/** Any day-first invoice date → sortable ISO "yyyy-mm-dd". Tolerates "-" or "/" separators
 *  and 2- or 4-digit years (e.g. "30/05/2026", "22-05-26", "7/4/26"). Falls back to createdAt. */
function docISO(d: Doc): string {
  const m = (d.date || "").trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (m) {
    const dd = +m[1];
    const mm = +m[2];
    const yy = m[3].length <= 2 ? 2000 + +m[3] : +m[3];
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) return `${yy}-${pad(mm)}-${pad(dd)}`;
  }
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
  const [cls, setCls] = useState<"all" | "b2b" | "b2c" | "rented" | "igst" | "split">("all"); // All · B2B · B2C · Rented · IGST · Split

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
        const iso = docISO(d);
        return {
          key: d.id,
          no: d.number || d.id,
          date: fmtISO(iso), // normalized dd-mm-yyyy (raw dates come in mixed formats)
          iso,
          name: d.customerName || "—",
          gstin: d.custGstin || "",
          rented: !!d.rented,
          igst: d.gstKind === "igst",
          buy: t.buy,
          cft: t.cft,
          net: t.taxable,
          gst: t.gst,
          total: t.grand,
        };
      })
      .sort((a, b) => numOf(b.no) - numOf(a.no) || b.iso.localeCompare(a.iso)); // latest invoice number first
  }, [invoices, from, to, type]);

  const sumOf = (list: typeof rows) =>
    list.reduce(
      (s, r) => {
        s.cft += r.cft;
        s.net += r.net;
        s.gst += r.gst;
        s.total += r.total;
        return s;
      },
      { cft: 0, net: 0, gst: 0, total: 0 },
    );
  // Rented (rental invoices) · B2B (has GSTIN) · B2C (no GSTIN) — rented is its own class
  const rentedRows = useMemo(() => rows.filter((r) => r.rented), [rows]);
  const b2bRows = useMemo(() => rows.filter((r) => !r.rented && (r.gstin || "").trim() !== ""), [rows]);
  const b2cRows = useMemo(() => rows.filter((r) => !r.rented && (r.gstin || "").trim() === ""), [rows]);
  const igstRows = useMemo(() => rows.filter((r) => r.igst), [rows]); // interstate (IGST) invoices
  // Split view = a clean partition (each invoice in exactly one table): Rented → IGST → B2B → B2C
  const splitIgst = useMemo(() => rows.filter((r) => !r.rented && r.igst), [rows]);
  const splitB2b = useMemo(() => rows.filter((r) => !r.rented && !r.igst && (r.gstin || "").trim() !== ""), [rows]);
  const splitB2c = useMemo(() => rows.filter((r) => !r.rented && !r.igst && (r.gstin || "").trim() === ""), [rows]);
  const shownRows =
    cls === "b2b" ? b2bRows : cls === "b2c" ? b2cRows : cls === "rented" ? rentedRows : cls === "igst" ? igstRows : rows;
  const shownTotals = sumOf(shownRows);

  /** One invoice table. B2B tables show GSTIN + Net + GST columns; Regular tables omit GST. */
  const renderTable = (list: typeof rows, withGst: boolean, heading: string) => {
    const t = sumOf(list);
    return (
      <div className="rep-block">
        {heading ? (
          <div className="rep-title rep-subhead">
            {heading} <span className="rep-subcount">· {list.length} invoice{list.length === 1 ? "" : "s"}</span>
          </div>
        ) : null}
        <table className="rep-table">
          <colgroup>
            <col className="w-n" />
            <col className="w-date" />
            <col className="w-no" />
            <col className="w-cust" />
            {withGst && <col className="w-gst" />}
            <col className="w-cft" />
            {withGst && <col className="w-net" />}
            {withGst && <col className="w-gstamt" />}
            <col className="w-total" />
          </colgroup>
          <thead>
            <tr>
              <th className="c-n">#</th>
              <th>Date</th>
              <th>Invoice No</th>
              <th>Customer</th>
              {withGst && <th>GSTIN</th>}
              <th className="amt">CFT</th>
              {withGst && <th className="amt">Net ₹</th>}
              {withGst && <th className="amt">GST ₹</th>}
              <th className="amt">Total ₹</th>
            </tr>
          </thead>
          <tbody>
            {list.length ? (
              <>
                {list.map((r, i) => (
                  <tr key={r.key}>
                    <td className="c-n">{i + 1}</td>
                    <td className="c-date">{r.date}</td>
                    <td className="c-no">{r.no}</td>
                    <td className="c-cust">{r.name}</td>
                    {withGst && <td className="c-gst">{r.gstin || "—"}</td>}
                    <td className="amt">{num(r.cft)}</td>
                    {withGst && <td className="amt">{inr(r.net)}</td>}
                    {withGst && <td className="amt">{inr(r.gst)}</td>}
                    <td className="amt">{inr(r.total)}</td>
                  </tr>
                ))}
                <tr className="rep-tot">
                  <td colSpan={withGst ? 5 : 4}>Total — {list.length} invoice{list.length === 1 ? "" : "s"}</td>
                  <td className="amt">{num(t.cft)}</td>
                  {withGst && <td className="amt">{inr(t.net)}</td>}
                  {withGst && <td className="amt">{inr(t.gst)}</td>}
                  <td className="amt">{inr(t.total)}</td>
                </tr>
              </>
            ) : (
              <tr>
                <td colSpan={withGst ? 9 : 6} className="rep-empty">No invoices in this period.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  };

  const typeLabel = type === "buy" ? "Purchase" : type === "all" ? "Invoice" : "Sales";
  const clsLabel =
    cls === "b2b" ? " · B2B" : cls === "b2c" ? " · B2C" : cls === "rented" ? " · Rented" : cls === "igst" ? " · IGST" : cls === "split" ? " · B2B + B2C + IGST + Rented" : "";
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
          <div className="rep-seg" role="group" aria-label="Invoice class">
            {(["all", "b2b", "b2c", "rented", "igst", "split"] as const).map((c) => (
              <button
                key={c}
                className={cls === c ? "on" : ""}
                onClick={() => setCls(c)}
                title={
                  c === "all"
                    ? "All invoices in one table (normal)"
                    : c === "b2b"
                      ? "GSTIN invoices (with GST)"
                      : c === "b2c"
                        ? "Non-GSTIN invoices"
                        : c === "rented"
                          ? "Rental invoices (CGST + SGST)"
                          : c === "igst"
                            ? "Interstate IGST invoices"
                            : "Separate tables: B2B, B2C, IGST, Rented"
                }
              >
                {c === "all" ? "All" : c === "b2b" ? "B2B" : c === "b2c" ? "B2C" : c === "rented" ? "Rented" : c === "igst" ? "IGST" : "Split"}
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
            <div className="rep-title">{typeLabel} Report{clsLabel}</div>
            <div className="rep-period">{periodLabel}</div>
          </div>
        </div>

        <div className="rep-summary">
          <div><b>{shownRows.length}</b><span>Invoices</span></div>
          <div><b>{num(shownTotals.cft)}</b><span>CFT {type === "buy" ? "bought" : "sold"}</span></div>
          <div><b>₹{inr(shownTotals.net)}</b><span>Net amount</span></div>
          <div><b>₹{inr(shownTotals.gst)}</b><span>GST</span></div>
          <div><b>₹{inr(shownTotals.total)}</b><span>Total</span></div>
        </div>

        {cls === "all" && renderTable(rows, true, "")}
        {cls === "b2b" && renderTable(b2bRows, true, "")}
        {cls === "b2c" && renderTable(b2cRows, true, "")}
        {cls === "rented" && renderTable(rentedRows, true, "")}
        {cls === "igst" && renderTable(igstRows, true, "")}
        {cls === "split" && renderTable(splitB2b, true, "B2B — CGST + SGST")}
        {cls === "split" && renderTable(splitB2c, true, "B2C")}
        {cls === "split" && renderTable(splitIgst, true, "IGST — interstate")}
        {cls === "split" && renderTable(rentedRows, true, "Rented — CGST + SGST")}

        <div className="rep-foot">Generated {fmtISO(isoOf(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate()))} · {brand.name}</div>
      </div>
    </div>
  );
}
