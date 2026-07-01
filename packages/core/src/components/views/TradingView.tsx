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

  const load = useCallback(() => {
    allRec<Doc>("invoices").then(setInvoices);
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
    const [ma, ya] = a.key.split("-");
    const [mb, yb] = b.key.split("-");
    return ya === yb ? ma.localeCompare(mb) : ya.localeCompare(yb);
  });

  async function saveCfg(e: React.FormEvent) {
    e.preventDefault();
    await setStockConfig({ value: +oVal || 0, cft: +oCft || 0, closingCft: cCft.trim() === "" ? null : +cCft || 0 });
    load();
    bumpData();
    toast("Stock opening saved");
  }

  const boxes = [
    { k: "Opening", v: "₹ " + inr(tr.openValue), sub: num(tr.openCft) + " CFT" },
    { k: "Purchase", v: "₹ " + inr(tr.purchaseValue), sub: num(tr.purchaseCft) + " CFT" },
    { k: "Sell", v: "₹ " + inr(tr.saleValue), sub: num(tr.saleCft) + " CFT", money: true },
    { k: "Gross Profit", v: "₹ " + inr(tr.grossProfit), tone: tr.grossProfit < 0 ? "var(--danger)" : "var(--green)" },
    { k: "Total Amount", v: "₹ " + inr(tr.totalAmount) },
    { k: "Closing Stock Today", v: "₹ " + inr(tr.closingValue), sub: num(tr.closingCft) + " CFT · avg ₹" + inr(tr.avgRate), money: true },
  ];

  return (
    <div>
      <div className="sectitle">
        Stock &amp; Trading <small>— opening → purchases − sales = closing</small>
      </div>

      <form className="panel-card daybook-entry" onSubmit={saveCfg}>
        <div style={{ flexBasis: "100%", fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-faint)" }}>
          Opening stock before recording. Sales reduce closing stock automatically; set a physical closing count only if you counted it.
        </div>
        <label className="modal-field">
          <span>Opening value (₹)</span>
          <input type="number" inputMode="decimal" placeholder="0" value={oVal} onChange={(e) => setOVal(e.target.value)} />
        </label>
        <label className="modal-field">
          <span>Opening CFT</span>
          <input type="number" inputMode="decimal" placeholder="0" value={oCft} onChange={(e) => setOCft(e.target.value)} />
        </label>
        <label className="modal-field">
          <span>Closing CFT (physical, optional)</span>
          <input type="number" inputMode="decimal" placeholder={num(tr.availCft - tr.saleCft) + " (auto)"} value={cCft} onChange={(e) => setCCft(e.target.value)} />
        </label>
        <button className="btn primary" type="submit">
          Save
        </button>
      </form>

      <div className="dash-grid" style={{ marginTop: 8, gridTemplateColumns: "repeat(3,1fr)" }}>
        {boxes.map((b) => (
          <div className="stat" key={b.k}>
            <div className="k">{b.k}</div>
            <div className={"v" + (b.money ? " money" : "")} style={b.tone ? { color: b.tone } : undefined}>
              {b.v}
            </div>
            {b.sub && <div className="sub">{b.sub}</div>}
          </div>
        ))}
      </div>

      <div className="panel-card" style={{ marginTop: 20, overflowX: "auto" }}>
        <div className="pc-head">Month-wise · Purchase (Karnataka) vs Sell</div>
        <div className="tgrid thead-tg">
          <span>Month</span>
          <span>Karnataka</span>
          <span>GST</span>
          <span>Total P.K</span>
          <span>Sell</span>
          <span>Sell GST</span>
          <span>Total Sell</span>
        </div>
        {mrows.length ? (
          mrows.map((m) => (
            <div className="tgrid" key={m.key}>
              <span className="tg-m">{monthName(m.key)}</span>
              <span>{inr(m.pTax)}</span>
              <span>{inr(m.pGst)}</span>
              <span className="tg-b">{inr(m.pTot)}</span>
              <span>{inr(m.sTax)}</span>
              <span>{inr(m.sGst)}</span>
              <span className="tg-b">{inr(m.sTot)}</span>
            </div>
          ))
        ) : (
          <div className="empty">
            <div className="empty-icon">📦</div>
            <div className="empty-title">No invoices yet</div>
            <div className="empty-note">Selling invoices reduce stock; buying invoices add to it. Totals appear here.</div>
          </div>
        )}
        {mrows.length > 0 && (
          <div className="tgrid tg-tot">
            <span className="tg-m">Total</span>
            <span>{inr(tr.purchaseValue)}</span>
            <span>{inr(tr.purchaseGst)}</span>
            <span className="tg-b">{inr(tr.purchaseTotal)}</span>
            <span>{inr(tr.saleValue)}</span>
            <span>{inr(tr.saleGst)}</span>
            <span className="tg-b">{inr(tr.saleTotal)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
