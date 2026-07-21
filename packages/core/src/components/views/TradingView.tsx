"use client";
import { useCallback, useEffect, useState } from "react";
import { allRec } from "@/lib/data";
import { dateSortKey, inr, pad } from "@/lib/calc";
import { computeItc, computeTrading, docItc, docTrade, getStockConfig, MONTH_NAMES, monthKey, setStockConfig, type StockConfig } from "@/lib/trading";
import { brandFor } from "@/lib/brand";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import type { Doc } from "@/lib/types";

const num = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// period helpers (same behavior as the Reports page)
const docISO = (d: Doc) => dateSortKey(d.date) || (d.createdAt || "").slice(0, 10);
const isoOf = (y: number, m: number, day: number) => `${y}-${pad(m)}-${pad(day)}`;
const fmtISO = (iso: string) => {
  const [y, m, d] = (iso || "").split("-");
  return y && m && d ? `${d}-${m}-${y}` : iso;
};
function currentFY(now = new Date()): { from: string; to: string; label: string } {
  const y = now.getFullYear();
  const startY = now.getMonth() + 1 >= 4 ? y : y - 1;
  return { from: isoOf(startY, 4, 1), to: isoOf(startY + 1, 3, 31), label: `FY ${startY}-${String(startY + 1).slice(2)}` };
}
const todayISO = () => {
  const d = new Date();
  return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
};

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
  const { dataVersion, brandMode } = useApp();
  const brand = brandFor(brandMode);
  const [invoices, setInvoices] = useState<Doc[]>([]);
  const [cfg, setCfg] = useState<StockConfig>({ value: 0, cft: 0, closingCft: null, gpMode: "stock", gpPercent: 10 });
  const [oVal, setOVal] = useState("");
  const [oCft, setOCft] = useState("");
  const [cCft, setCCft] = useState("");
  const [gpPct, setGpPct] = useState("10");
  const [editOpening, setEditOpening] = useState(false);
  const [showMonths, setShowMonths] = useState(false);
  // ITC opening-balance edit form (CGST / SGST / IGST)
  const [editItc, setEditItc] = useState(false);
  const [iCgst, setICgst] = useState("");
  const [iSgst, setISgst] = useState("");
  const [iIgst, setIIgst] = useState("");
  // period window ("" = open-ended) — default all time, presets like the Reports page
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(() => {
    allRec<Doc>("invoices").then((arr) => setInvoices(arr.filter((d) => !d.deletedAt && !d.purgedAt)));
    getStockConfig().then((c) => {
      setCfg(c);
      setOVal(c.value ? String(c.value) : "");
      setOCft(c.cft ? String(c.cft) : "");
      setCCft(c.closingCft != null ? String(c.closingCft) : "");
      setGpPct(String(c.gpPercent ?? 10));
      setICgst(c.itcOpen?.cgst ? String(c.itcOpen.cgst) : "");
      setISgst(c.itcOpen?.sgst ? String(c.itcOpen.sgst) : "");
      setIIgst(c.itcOpen?.igst ? String(c.itcOpen.igst) : "");
    });
  }, []);
  useEffect(() => {
    load();
  }, [load, dataVersion]);

  const gpMode = cfg.gpMode === "percent" ? "percent" : "stock";

  // period accounting: invoices BEFORE the window roll into a derived opening
  // (configured opening + earlier purchases − earlier sales at cost), so any
  // month/FY window is a correct standalone trading account.
  const beforeDocs = from ? invoices.filter((d) => docISO(d) < from) : [];
  const periodDocs = invoices.filter((d) => {
    const iso = docISO(d);
    if (from && iso < from) return false;
    if (to && iso > to) return false;
    return true;
  });
  const baseOpening = { value: cfg.value, cft: cfg.cft };
  const opening = beforeDocs.length
    ? (() => {
        const pre = computeTrading(beforeDocs.map(docTrade), baseOpening, null); // at cost — GP method irrelevant here
        return { value: pre.closingValue, cft: pre.closingCft };
      })()
    : baseOpening;
  // the physical closing count describes TODAY's stock — only apply it when the window reaches today
  const includesNow = !to || to >= todayISO();
  const tr = computeTrading(periodDocs.map(docTrade), opening, includesNow ? cfg.closingCft : null, {
    mode: gpMode,
    percent: cfg.gpPercent ?? 10,
  });

  // GST Input-Tax-Credit ledger, same rolling-window treatment as the stock:
  // credits before the window fold into the period's opening balances
  const itcBase = cfg.itcOpen || { cgst: 0, sgst: 0, igst: 0 };
  const itcOpening = beforeDocs.length
    ? (() => {
        const pre = computeItc(beforeDocs.map(docItc), itcBase);
        return { cgst: pre.cgst.closing, sgst: pre.sgst.closing, igst: pre.igst.closing };
      })()
    : itcBase;
  const itc = computeItc(periodDocs.map(docItc), itcOpening);
  const periodLabel =
    from && to ? `${fmtISO(from)}  to  ${fmtISO(to)}` : from ? `From ${fmtISO(from)}` : to ? `Up to ${fmtISO(to)}` : "All time";
  const fy = currentFY();
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
      setFrom(fy.from);
      setTo(fy.to);
    } else {
      setFrom("");
      setTo("");
    }
  }

  async function saveGp(next: Partial<StockConfig>) {
    const merged = { ...cfg, ...next };
    await setStockConfig(merged);
    setCfg(merged);
    bumpData();
  }

  // per-invoice stock movements: a sale DEBITS stock (amount + CFT), a purchase CREDITS it.
  const dsort = (d: string) => {
    const [dd, mm, yy] = (d || "").split("-");
    return "20" + (yy || "") + (mm || "") + (dd || "");
  };
  let runCft = tr.openCft;
  const moves = [...periodDocs]
    .sort((a, b) => dsort(a.date).localeCompare(dsort(b.date)))
    .map((d) => {
      const it = docTrade(d);
      runCft = Math.round((runCft + (it.buy ? it.cft : -it.cft)) * 100) / 100;
      return { id: d.id, name: d.customerName || d.id, date: d.date, buy: it.buy, cft: it.cft, amount: it.taxable, runCft };
    })
    .reverse();

  // month-wise Karnataka/GST/Total P.K vs Sell/Sell GST/Total Sell (like the Excel)
  const mmap = new Map<string, MRow>();
  periodDocs.forEach((d) => {
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
    await setStockConfig({ ...cfg, value: +oVal || 0, cft: +oCft || 0, closingCft: cCft.trim() === "" ? null : +cCft || 0 });
    setEditOpening(false);
    load();
    bumpData();
    toast("Stock opening saved");
  }

  async function saveItc(e: React.FormEvent) {
    e.preventDefault();
    await setStockConfig({ ...cfg, itcOpen: { cgst: +iCgst || 0, sgst: +iSgst || 0, igst: +iIgst || 0 } });
    setEditItc(false);
    load();
    bumpData();
    toast("ITC opening balances saved");
  }

  const stmt: { k: string; cft: number; val: number; sub?: boolean; tot?: boolean }[] = [
    { k: "Opening stock", cft: tr.openCft, val: tr.openValue },
    { k: "+ Purchases", cft: tr.purchaseCft, val: tr.purchaseValue },
    { k: "= Goods available", cft: tr.availCft, val: tr.availValue, sub: true },
    { k: "− Sold (at cost)", cft: tr.saleCft, val: tr.cogs },
    { k: "= Closing stock", cft: tr.closingCft, val: tr.closingValue, tot: true },
  ];

  // printable Trading A/C: CFT on both sides must reconcile too — any gap between
  // goods available and (sold + closing) is a physical shortage/excess, shown explicitly
  const rightCft = Math.round((tr.saleCft + tr.closingCft) * 100) / 100;
  const cftDiff = Math.round((tr.availCft - rightCft) * 100) / 100;
  const gToday = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  const genOn = `${p2(gToday.getDate())}-${p2(gToday.getMonth() + 1)}-${gToday.getFullYear()}`;
  const gpLabel =
    gpMode === "percent" ? `Gross Profit (${num(cfg.gpPercent ?? 10)}% of sales)` : "Gross Profit (from closing stock)";

  return (
    <div>
      <div className="cd-screen">
      <div className="sectitle" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span>Stock <small>— opening + purchases − sold = closing</small></span>
        <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => window.print()}>
          Print Trading A/C
        </button>
      </div>

      {/* period window — same clean controls as Reports; earlier trade rolls into the opening */}
      <div className="rep-controls">
        <div className="rep-presets">
          <button className="btn sm" onClick={() => preset("thisMonth")}>This month</button>
          <button className="btn sm" onClick={() => preset("lastMonth")}>Last month</button>
          <button className="btn sm" onClick={() => preset("fy")}>{fy.label}</button>
          <button className="btn sm" onClick={() => preset("all")}>All time</button>
        </div>
        <div className="rep-range">
          <label>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
      </div>

      {/* Stock Summary sheet */}
      <div className="tsheet">
        <div className="tsheet-head">
          <span>Stock Summary</span>
          <small>{periodLabel} · avg ₹{inr(tr.avgRate)} / CFT{from ? " · opening carried in from earlier trade" : ""}</small>
        </div>
        <div className="tsheet-body">
          <div className="tsum">
            <div><b>{num(tr.closingCft)}</b><span>Closing stock (CFT)</span></div>
            <div><b>₹{inr(tr.closingValue)}</b><span>Stock value</span></div>
            <div><b>₹{inr(tr.saleValue)}</b><span>Sales · {num(tr.saleCft)} CFT sold</span></div>
            <div><b style={{ color: tr.grossProfit < 0 ? "var(--t-cr)" : "var(--t-dr)" }}>₹{inr(tr.grossProfit)}</b><span>Gross profit</span></div>
          </div>

          {/* how Gross Profit is computed — the owner picks the method, the math is shown in full */}
          <div className="gp-ctl">
            <span className="gp-lbl">Gross profit method</span>
            <div className="rep-seg" role="group" aria-label="Gross profit method">
              <button
                className={gpMode === "percent" ? "on" : ""}
                title="GP = Sales × your % (closing stock value balances the account — like the accountant's sheet)"
                onClick={() => { saveGp({ gpMode: "percent" }); toast("GP = sales × " + (cfg.gpPercent ?? 10) + "%"); }}
              >
                % of sales
              </button>
              <button
                className={gpMode === "stock" ? "on" : ""}
                title="GP = Sales − cost of goods sold (closing stock counted at average cost rate)"
                onClick={() => { saveGp({ gpMode: "stock" }); toast("GP from closing stock"); }}
              >
                From closing stock
              </button>
            </div>
            {gpMode === "percent" && (
              <label className="gp-pct">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step="0.1"
                  value={gpPct}
                  onChange={(e) => setGpPct(e.target.value)}
                  onBlur={() => {
                    const p = Math.max(0, Math.min(100, +gpPct || 0));
                    if (p !== (cfg.gpPercent ?? 10)) {
                      saveGp({ gpPercent: p });
                      toast("GP set to " + p + "% of sales");
                    }
                  }}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                />
                <span>%</span>
              </label>
            )}
          </div>
          <div className="gp-how">
            {gpMode === "percent" ? (
              <>
                GP = Sales ₹{inr(tr.saleValue)} × {num(cfg.gpPercent ?? 10)}% = <b>₹{inr(tr.grossProfit)}</b>
                {" "}· Closing stock is the balancing figure: ₹{inr(tr.availValue)} + ₹{inr(tr.grossProfit)} − ₹{inr(tr.saleValue)} = <b>₹{inr(tr.closingValue)}</b>
              </>
            ) : (
              <>
                Closing = {num(tr.closingCft)} CFT × avg ₹{inr(tr.avgRate)} = ₹{inr(tr.closingValue)}
                {" "}· GP = Sales ₹{inr(tr.saleValue)} − cost of goods sold ₹{inr(tr.cogs)} = <b>₹{inr(tr.grossProfit)}</b>
              </>
            )}
          </div>

          {/* Trading A/C — the accountant's two-sided sheet; both sides always total the same */}
          <table className="t-table narrow" style={{ marginTop: 12 }}>
            <thead>
              <tr><th colSpan={4} style={{ textAlign: "center" }}>Trading A/C — both sides balance</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>Opening</td><td className="amt">{inr(tr.openValue)}</td>
                <td>Sell</td><td className="amt">{inr(tr.saleValue)}</td>
              </tr>
              <tr>
                <td>Purchase</td><td className="amt">{inr(tr.purchaseValue)}</td>
                <td>Closing</td><td className="amt">{inr(tr.closingValue)}</td>
              </tr>
              <tr>
                <td>G/P {gpMode === "percent" ? "(" + num(cfg.gpPercent ?? 10) + "% of sell)" : "(from stock)"}</td>
                <td className="amt" style={{ color: tr.grossProfit < 0 ? "var(--t-cr)" : "inherit" }}>{inr(tr.grossProfit)}</td>
                <td /><td />
              </tr>
              <tr className="tot">
                <td>Total</td><td className="amt">{inr(tr.totalAmount)}</td>
                <td>Total</td><td className="amt">{inr(tr.saleValue + tr.closingValue)}</td>
              </tr>
            </tbody>
          </table>

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
                Opening{from ? " (this period, carried in)" : ""}: {num(tr.openCft)} CFT · ₹{inr(tr.openValue)} — edit
                {from ? " original" : ""}
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

      {/* GST Input Tax Credit — purchases add credit, every sale's tax is set off (minus) */}
      <div className="tsheet">
        <div className="tsheet-head">
          <span>GST Input Tax Credit</span>
          <small>{periodLabel} · purchases add credit · sales minus · closing carries</small>
        </div>
        <div className="tsheet-body" style={{ overflowX: "auto" }}>
          <table className="t-table narrow">
            <thead>
              <tr>
                <th>Head</th>
                <th className="amt">Opening ₹</th>
                <th className="amt">+ Input (purchases)</th>
                <th className="amt">− Output (sales)</th>
                <th className="amt">Closing ₹</th>
              </tr>
            </thead>
            <tbody>
              {([["CGST", itc.cgst], ["SGST", itc.sgst], ["IGST", itc.igst]] as const).map(([k, h]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td className="amt">{inr(h.open)}</td>
                  <td className="amt">{inr(h.input)}</td>
                  <td className="amt">{inr(h.output)}</td>
                  <td className="amt" style={{ color: h.closing < -0.005 ? "var(--t-cr)" : "inherit", fontWeight: 700 }}>
                    {inr(h.closing)}
                    {h.closing < -0.005 ? " (payable)" : ""}
                  </td>
                </tr>
              ))}
              <tr className="tot">
                <td>Total</td>
                <td className="amt">{inr(itc.total.open)}</td>
                <td className="amt">{inr(itc.total.input)}</td>
                <td className="amt">{inr(itc.total.output)}</td>
                <td className="amt" style={{ color: itc.total.closing < -0.005 ? "var(--t-cr)" : "inherit" }}>
                  {inr(itc.total.closing)}
                  {itc.total.closing < -0.005 ? " (payable)" : ""}
                </td>
              </tr>
            </tbody>
          </table>
          <div className="gp-how" style={{ marginTop: 8 }}>
            Closing credit = opening + tax paid on purchases − tax on sales, per head. A negative
            closing means the credit is used up — that much is payable. Interstate (IGST) invoices
            go to IGST; CGST+SGST invoices split half-half.
          </div>
          <div style={{ marginTop: 10 }}>
            {!editItc ? (
              <button className="tlink" onClick={() => setEditItc(true)}>
                Opening credit{from ? " (this period, carried in)" : ""}: CGST ₹{inr(itcOpening.cgst)} · SGST ₹{inr(itcOpening.sgst)} · IGST ₹{inr(itcOpening.igst)} — edit{from ? " original" : ""}
              </button>
            ) : (
              <form className="tform" onSubmit={saveItc}>
                <label>CGST opening ₹<input type="number" inputMode="decimal" placeholder="0" value={iCgst} onChange={(e) => setICgst(e.target.value)} /></label>
                <label>SGST opening ₹<input type="number" inputMode="decimal" placeholder="0" value={iSgst} onChange={(e) => setISgst(e.target.value)} /></label>
                <label>IGST opening ₹<input type="number" inputMode="decimal" placeholder="0" value={iIgst} onChange={(e) => setIIgst(e.target.value)} /></label>
                <button className="btn primary sm" type="submit">Save</button>
                <button className="btn sm" type="button" onClick={() => setEditItc(false)}>Cancel</button>
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

      {/* clean printable TRADING ACCOUNT — rendered only on print (Print Trading A/C button) */}
      <div className="cd-print rep-doc">
        <div className="rep-head">
          <div className="rep-brand">
            <h1>{brand.name || "Trading Account"}</h1>
            {brand.addr && <div>{brand.addr}</div>}
            {brand.gstin && <div>GSTIN: {brand.gstin}</div>}
          </div>
          <div className="rep-meta">
            <div className="rep-title">Trading Account</div>
            <div className="rep-period">{periodLabel === "All time" ? "As on " + genOn : periodLabel}</div>
          </div>
        </div>

        <div className="rep-summary cols4">
          <div><b>{num(tr.closingCft)}</b><span>Closing CFT</span></div>
          <div><b>₹{inr(tr.closingValue)}</b><span>Closing value</span></div>
          <div><b>₹{inr(tr.avgRate)}</b><span>Avg rate / CFT</span></div>
          <div><b>₹{inr(tr.grossProfit)}</b><span>Gross profit</span></div>
        </div>

        {/* the classic two-sided account — ₹ AND CFT on both sides, both sides balance */}
        <table className="rep-table">
          <colgroup>
            <col style={{ width: "22%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "22%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "16%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Particulars</th>
              <th className="amt">CFT</th>
              <th className="amt">Amount ₹</th>
              <th>Particulars</th>
              <th className="amt">CFT</th>
              <th className="amt">Amount ₹</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Opening stock</td>
              <td className="amt">{num(tr.openCft)}</td>
              <td className="amt">{inr(tr.openValue)}</td>
              <td>Sales</td>
              <td className="amt">{num(tr.saleCft)}</td>
              <td className="amt">{inr(tr.saleValue)}</td>
            </tr>
            <tr>
              <td>Purchases</td>
              <td className="amt">{num(tr.purchaseCft)}</td>
              <td className="amt">{inr(tr.purchaseValue)}</td>
              <td>Closing stock</td>
              <td className="amt">{num(tr.closingCft)}</td>
              <td className="amt">{inr(tr.closingValue)}</td>
            </tr>
            <tr>
              <td>{gpLabel}</td>
              <td className="amt">—</td>
              <td className="amt">{inr(tr.grossProfit)}</td>
              {Math.abs(cftDiff) > 0.01 ? (
                <>
                  <td>CFT difference ({cftDiff > 0 ? "shortage" : "excess"})</td>
                  <td className="amt">{num(Math.abs(cftDiff))}</td>
                  <td className="amt">—</td>
                </>
              ) : (
                <>
                  <td />
                  <td />
                  <td />
                </>
              )}
            </tr>
            <tr className="rep-tot">
              <td>Total</td>
              <td className="amt">{num(tr.availCft)}</td>
              <td className="amt">{inr(tr.totalAmount)}</td>
              <td>Total</td>
              <td className="amt">{num(Math.round((rightCft + Math.max(0, cftDiff)) * 100) / 100)}</td>
              <td className="amt">{inr(Math.round((tr.saleValue + tr.closingValue) * 100) / 100)}</td>
            </tr>
          </tbody>
        </table>

        <div className="rep-title" style={{ marginTop: 18, marginBottom: 8 }}>GST Input Tax Credit</div>
        <table className="rep-table">
          <thead>
            <tr>
              <th>Head</th>
              <th className="amt">Opening ₹</th>
              <th className="amt">+ Input (purchases)</th>
              <th className="amt">− Output (sales)</th>
              <th className="amt">Closing ₹</th>
            </tr>
          </thead>
          <tbody>
            {([["CGST", itc.cgst], ["SGST", itc.sgst], ["IGST", itc.igst]] as const).map(([k, h]) => (
              <tr key={k}>
                <td>{k}</td>
                <td className="amt">{inr(h.open)}</td>
                <td className="amt">{inr(h.input)}</td>
                <td className="amt">{inr(h.output)}</td>
                <td className="amt">{inr(h.closing)}{h.closing < -0.005 ? " (payable)" : ""}</td>
              </tr>
            ))}
            <tr className="rep-tot">
              <td>Total</td>
              <td className="amt">{inr(itc.total.open)}</td>
              <td className="amt">{inr(itc.total.input)}</td>
              <td className="amt">{inr(itc.total.output)}</td>
              <td className="amt">{inr(itc.total.closing)}{itc.total.closing < -0.005 ? " (payable)" : ""}</td>
            </tr>
          </tbody>
        </table>

        {mrows.length > 0 && (
          <>
            <div className="rep-title" style={{ marginTop: 18, marginBottom: 8 }}>Month-wise · Purchase vs Sell</div>
            <table className="rep-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="amt">Purchase ₹</th>
                  <th className="amt">GST ₹</th>
                  <th className="amt">Total ₹</th>
                  <th className="amt">Sell ₹</th>
                  <th className="amt">Sell GST ₹</th>
                  <th className="amt">Total ₹</th>
                </tr>
              </thead>
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
                <tr className="rep-tot">
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
          </>
        )}

        <div className="rep-foot">Generated {genOn} · {brand.name}</div>
      </div>
    </div>
  );
}
