"use client";
import { useCallback, useEffect, useState } from "react";
import { allRec } from "@/lib/db";
import { inr } from "@/lib/calc";
import { computeTrading, docTrade, getStockConfig, MONTH_NAMES, monthKey, setStockConfig } from "@/lib/trading";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import type { Doc } from "@/lib/types";

const num = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface MRow {
  key: string;
  pTax: number;
  pGst: number;
  pTot: number;
  sTax: number;
  sGst: number;
  sTot: number;
}

export default function TradingView() {
  const { dataVersion } = useApp();
  const [invoices, setInvoices] = useState<Doc[]>([]);
  const [cfg, setCfg] = useState({ value: 0, cft: 0, closingCft: null as number | null });
  const [oVal, setOVal] = useState("");
  const [oCft, setOCft] = useState("");
  const [cCft, setCCft] = useState("");
  const [editOpening, setEditOpening] = useState(false);
  const [showMonths, setShowMonths] = useState(false);

  const load = useCallback(() => {
    allRec<Doc>("invoices").then((arr) => setInvoices(arr.filter((d) => !d.deletedAt && !d.purgedAt)));
    getStockConfig().then((c) => {
      setCfg(c);
      setOVal(c.value ? String(c.value) : "");
      setOCft(c.cft ? String(c.cft) : "");
      setCCft(c.closingCft != null ? String(c.closingCft) : "");
    });
  }, []);
  useEffect(() => {
    load();
  }, [load, dataVersion]);

  const lines = invoices.map(docTrade);
  const tr = computeTrading(lines, { value: cfg.value, cft: cfg.cft }, cfg.closingCft);

  // per-invoice stock movements: a sale DEBITS stock (amount + CFT), a purchase CREDITS it.
  const dsort = (d: string) => {
    const [dd, mm, yy] = (d || "").split("-");
    return "20" + (yy || "") + (mm || "") + (dd || "");
  };
  let runCft = tr.openCft;
  const moves = [...invoices]
    .sort((a, b) => dsort(a.date).localeCompare(dsort(b.date)))
    .map((d) => {
      const it = docTrade(d);
      runCft = Math.round((runCft + (it.buy ? it.cft : -it.cft)) * 100) / 100;
      return { id: d.id, name: d.customerName || d.id, date: d.date, buy: it.buy, cft: it.cft, amount: it.taxable, runCft };
    })
    .reverse();

  // month-wise Karnataka/GST/Total P.K vs Sell/Sell GST/Total Sell (like the Excel)
  const mmap = new Map<string, MRow>();
  invoices.forEach((d) => {
    const k = monthKey(d.date);
    const it = docTrade(d);
    const m = mmap.get(k) || { key: k, pTax: 0, pGst: 0, pTot: 0, sTax: 0, sGst: 0, sTot: 0 };
    if (it.buy) {
      m.pTax += it.taxable;
      m.pGst += it.gst;
      m.pTot += it.grand;
    } else {
      m.sTax += it.taxable;
      m.sGst += it.gst;
      m.sTot += it.grand;
    }
    mmap.set(k, m);
  });
  const monthName = (k: string) => {
    const [mm, yy] = k.split("-");
    return (MONTH_NAMES[mm] || mm) + " " + yy;
  };
  const mrows = [...mmap.values()].sort((a, b) => {
    // default "" on destructuring so a "??" / malformed month key can never be undefined here
    // (undefined.localeCompare threw and crashed the whole Stock page)
    const [ma = "", ya = ""] = a.key.split("-");
    const [mb = "", yb = ""] = b.key.split("-");
    return ya === yb ? ma.localeCompare(mb) : ya.localeCompare(yb);
  });

  async function saveCfg(e: React.FormEvent) {
    e.preventDefault();
    await setStockConfig({ value: +oVal || 0, cft: +oCft || 0, closingCft: cCft.trim() === "" ? null : +cCft || 0 });
    setEditOpening(false);
    load();
    bumpData();
    toast("Stock opening saved");
  }

  const stmt: { k: string; cft: number; val: number; sub?: boolean; tot?: boolean }[] = [
    { k: "Opening stock", cft: tr.openCft, val: tr.openValue },
    { k: "+ Purchases", cft: tr.purchaseCft, val: tr.purchaseValue },
    { k: "= Goods available", cft: tr.availCft, val: tr.availValue, sub: true },
    { k: "− Sold (at cost)", cft: tr.saleCft, val: tr.cogs },
    { k: "= Closing stock", cft: tr.closingCft, val: tr.closingValue, tot: true },
  ];

  return (
    <div>
      <div className="sectitle">
        Stock <small>— opening + purchases − sold = closing</small>
      </div>

      {/* Stock Summary sheet */}
      <div className="tsheet">
        <div className="tsheet-head">
          <span>Stock Summary</span>
          <small>avg ₹{inr(tr.avgRate)} / CFT</small>
        </div>
        <div className="tsheet-body">
          <div className="tsum">
            <div><b>{num(tr.closingCft)}</b><span>Closing stock (CFT)</span></div>
            <div><b>₹{inr(tr.closingValue)}</b><span>Stock value</span></div>
            <div><b>₹{inr(tr.saleValue)}</b><span>Sales · {num(tr.saleCft)} CFT sold</span></div>
            <div><b style={{ color: tr.grossProfit < 0 ? "var(--t-cr)" : "var(--t-dr)" }}>₹{inr(tr.grossProfit)}</b><span>Gross profit</span></div>
          </div>

          <table className="t-table narrow">
            <thead><tr><th>Particulars</th><th className="amt">CFT</th><th className="amt">Value ₹</th></tr></thead>
            <tbody>
              {stmt.map((r) => (
                <tr key={r.k} className={r.tot ? "tot" : r.sub ? "op" : ""}>
                  <td>{r.k}</td>
                  <td className="amt">{num(r.cft)}</td>
                  <td className="amt">{inr(r.val)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* opening — collapsed by default (set once) */}
          <div style={{ marginTop: 10 }}>
            {!editOpening ? (
              <button className="tlink" onClick={() => setEditOpening(true)}>
                Opening: {num(tr.openCft)} CFT · ₹{inr(tr.openValue)} — edit
              </button>
            ) : (
              <form className="tform" onSubmit={saveCfg}>
                <label>Opening value ₹<input type="number" inputMode="decimal" placeholder="0" value={oVal} onChange={(e) => setOVal(e.target.value)} /></label>
                <label>Opening CFT<input type="number" inputMode="decimal" placeholder="0" value={oCft} onChange={(e) => setOCft(e.target.value)} /></label>
                <label>Closing CFT (physical, optional)<input type="number" inputMode="decimal" placeholder={num(tr.availCft - tr.saleCft) + " auto"} value={cCft} onChange={(e) => setCCft(e.target.value)} /></label>
                <button className="btn primary sm" type="submit">Save</button>
                <button className="btn sm" type="button" onClick={() => setEditOpening(false)}>Cancel</button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Stock movements */}
      <div className="tsheet">
        <div className="tsheet-head"><span>Stock Movements</span><small>each sale debits stock · each purchase adds</small></div>
        <div className="tsheet-body" style={{ overflowX: "auto" }}>
          {moves.length ? (
            <table className="t-table">
              <thead><tr><th>Date</th><th>Party</th><th>Type</th><th className="amt">CFT</th><th className="amt">Value ₹</th><th className="amt">Balance CFT</th></tr></thead>
              <tbody>
                {moves.map((m) => (
                  <tr key={m.id}>
                    <td>{m.date}</td>
                    <td>{m.name}</td>
                    <td className={m.buy ? "dr" : "cr"} style={{ fontWeight: 700 }}>{m.buy ? "Buy" : "Sale"}</td>
                    <td className={"amt " + (m.buy ? "dr" : "cr")}>{m.buy ? "+" : "−"}{num(m.cft)}</td>
                    <td className="amt">{inr(m.amount)}</td>
                    <td className="amt">{num(m.runCft)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="t-empty">No stock movements yet — selling invoices debit stock, buying invoices add to it.</div>
          )}
        </div>
      </div>

      {/* Month-wise — collapsed */}
      {mrows.length > 0 && (
        <div className="tsheet">
          <div className="tsheet-head" style={{ cursor: "pointer" }} onClick={() => setShowMonths((s) => !s)}>
            <span>{showMonths ? "▾" : "▸"} Month-wise · Purchase vs Sell</span>
            <small>{mrows.length} month{mrows.length === 1 ? "" : "s"}</small>
          </div>
          {showMonths && (
            <div className="tsheet-body" style={{ overflowX: "auto" }}>
              <table className="t-table">
                <thead><tr><th>Month</th><th className="amt">Purchase</th><th className="amt">GST</th><th className="amt">Total</th><th className="amt">Sell</th><th className="amt">Sell GST</th><th className="amt">Total</th></tr></thead>
                <tbody>
                  {mrows.map((m) => (
                    <tr key={m.key}>
                      <td>{monthName(m.key)}</td>
                      <td className="amt">{inr(m.pTax)}</td>
                      <td className="amt">{inr(m.pGst)}</td>
                      <td className="amt">{inr(m.pTot)}</td>
                      <td className="amt">{inr(m.sTax)}</td>
                      <td className="amt">{inr(m.sGst)}</td>
                      <td className="amt">{inr(m.sTot)}</td>
                    </tr>
                  ))}
                  <tr className="tot">
                    <td>Total</td>
                    <td className="amt">{inr(tr.purchaseValue)}</td>
                    <td className="amt">{inr(tr.purchaseGst)}</td>
                    <td className="amt">{inr(tr.purchaseTotal)}</td>
                    <td className="amt">{inr(tr.saleValue)}</td>
                    <td className="amt">{inr(tr.saleGst)}</td>
                    <td className="amt">{inr(tr.saleTotal)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
