"use client";
// The PRINTED tax invoice (design "3A · Woodmark"): TAX INVOICE centred on top,
// logo-led woody letterhead, ticket chips, party boxes, the app's classic wood
// CFT boxes (min 6 ruled rows), maroon grand-total band, words strip, signatures.
// Print & Save-PDF ONLY — the on-screen editor keeps its own sheet; this node is
// display:none on screen (.cd-print) and becomes the page on print / PDF render.
import { forwardRef } from "react";
import { amountOf, cftOf, directOf, inr, pcsOf, rftOf, rupeesInWords } from "@/lib/calc";
import type { DocTotals } from "@/lib/calc";
import type { BankInfo, Brand } from "@/lib/brand";
import type { Doc, Row, Section } from "@/lib/types";

interface Props {
  doc: Doc;
  totals: DocTotals;
  brand: Brand;
  bank?: BankInfo;
  totalCft: number;
}

const UNIT: Record<string, string> = { cbm: "CBM", rft: "RFT", pcs: "Pcs" };
const unitOf = (m?: string) => UNIT[m || ""] || "CFT";
const measurerOf = (m?: string) =>
  m === "rft" ? rftOf : m === "direct" || m === "cbm" ? directOf : m === "pcs" ? pcsOf : cftOf;
/** the box always shows at least this many ruled lines — a real ledger box */
const MIN_ROWS = 6;

function WoodBox({ sec, measure }: { sec: Section; measure: number }) {
  const bySize = !sec.calcMode || sec.calcMode === "cft";
  const unit = unitOf(sec.calcMode);
  const measurer = measurerOf(sec.calcMode);
  const rows = (sec.rows || []).filter((r) => measurer(r) > 0);
  const amount = amountOf(sec, measure);
  const totalPcs = rows.reduce((s, r) => s + (+r.pcs || 0), 0);
  const n = Math.max(rows.length, MIN_ROWS);
  const cell = (r: Row | undefined, v: (r: Row) => string) => (r ? v(r) : "\u00A0");
  return (
    <div className="i3-box">
      <div className="i3-bhead">
        <span>{sec.name || "Wood"}</span>
        {totalPcs > 0 && <em>Total Pcs {totalPcs}</em>}
      </div>
      <table className="i3-btbl">
        {bySize ? (
          <colgroup>
            <col style={{ width: "8%" }} /><col style={{ width: "20%" }} /><col style={{ width: "18%" }} />
            <col style={{ width: "18%" }} /><col style={{ width: "18%" }} /><col style={{ width: "18%" }} />
          </colgroup>
        ) : (
          <colgroup>
            <col style={{ width: "10%" }} /><col style={{ width: "60%" }} /><col style={{ width: "30%" }} />
          </colgroup>
        )}
        <thead>
          {bySize ? (
            <tr>
              <th className="c">#</th><th>CFT</th><th className="c">L <small>feet</small></th>
              <th className="c">W <small>inch</small></th><th className="c">T <small>inch</small></th><th className="c">Pcs <small>qty</small></th>
            </tr>
          ) : (
            <tr>
              <th className="c">#</th><th>{unit}</th><th className="c">Pcs</th>
            </tr>
          )}
        </thead>
        <tbody>
          {Array.from({ length: n }, (_, i) => {
            const r = rows[i];
            return bySize ? (
              <tr key={i}>
                <td className="c i3-sl">{i + 1}</td>
                <td className="i3-cft">{cell(r, (x) => inr(cftOf(x)))}</td>
                <td className="c i3-dim">{cell(r, (x) => String(x.l ?? ""))}</td>
                <td className="c i3-dim">{cell(r, (x) => String(x.w ?? ""))}</td>
                <td className="c i3-dim">{cell(r, (x) => String(x.t ?? ""))}</td>
                <td className="c i3-dim">{cell(r, (x) => String(x.pcs ?? ""))}</td>
              </tr>
            ) : (
              <tr key={i}>
                <td className="c i3-sl">{i + 1}</td>
                <td className="i3-cft">{cell(r, (x) => inr(measurer(x)))}</td>
                <td className="c i3-dim">{cell(r, (x) => String(x.pcs || "\u00A0"))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="i3-bfoot">
        <div><span>Total {unit}</span><b>{inr(measure)}</b></div>
        <div><span>Rate ₹/{unit}</span><b>{inr(+sec.rate || 0)}</b></div>
        <div className="tp"><span>Total Price</span><b>₹ {inr(amount)}</b></div>
      </div>
    </div>
  );
}

const InvoicePrintA = forwardRef<HTMLDivElement, Props>(function InvoicePrintA(
  { doc, totals, brand, bank, totalCft },
  ref,
) {
  const half = Math.round((+doc.gst || 0) * 50) / 100;
  const halfAmt = Math.round(totals.gstAmt * 50) / 100;
  const igst = doc.gstKind === "igst";
  return (
    <div className="cd-print inv3a" ref={ref}>
      {/* TAX INVOICE — centred on top */}
      <div className="i3-kindtop"><span>Tax Invoice</span></div>

      {/* woodmark letterhead */}
      <div className="i3-mast">
        {brand.logo && <img src="/logo.png" alt={brand.name} />}
        <div className="i3-id">
          <div className="i3-nm">{brand.name}</div>
          <div className="i3-tg">Timber · Est. 1995</div>
          <div className="i3-ad">{brand.addr}{brand.phone ? " · Ph " + brand.phone : ""}</div>
          {brand.gstin && <div className="i3-gs">GSTIN {brand.gstin}</div>}
        </div>
      </div>
      <div className="i3-dbl" />

      {/* ticket chips */}
      <div className="i3-chips">
        <div className="i3-chip"><span>Invoice No.</span><b>{doc.number || "—"}</b></div>
        <div className="i3-chip"><span>Date</span><b>{doc.date || "—"}</b></div>
        <div className="i3-chip"><span>HSN Code</span><b>{doc.hsn || "—"}</b></div>
        <div className="i3-chip"><span>Vehicle No.</span><b>{doc.vehicleNo || "—"}</b></div>
        <div className="i3-chip"><span>Payment</span><b>{doc.payType || "—"}</b></div>
      </div>

      {/* parties */}
      <div className="i3-parties">
        <div className="i3-pbox">
          <div className="i3-lbl">Billed To</div>
          <div className="i3-pnm">{doc.customerName || "—"}</div>
          {doc.address && <div className="i3-ln">{doc.address}</div>}
          <div className="i3-ln i3-mono">
            {[doc.phone, doc.custGstin ? "GSTIN " + doc.custGstin : ""].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
        <div className="i3-pbox">
          <div className="i3-lbl">Ship To</div>
          <div className="i3-pnm">{doc.shipTo || "—"}</div>
        </div>
      </div>

      {/* the classic wood CFT boxes — always at least 6 ruled lines each */}
      {(doc.sections || []).map((sec, si) => (
        <WoodBox key={si} sec={sec} measure={totals.secCft[si] ?? 0} />
      ))}

      {/* totals (right) + a slim amount-in-words strip */}
      <div className="i3-tots">
        {totalCft > 0 && (
          <div className="i3-trow"><span>Total CFT</span><span className="v">{inr(totalCft)}</span></div>
        )}
        <div className="i3-trow"><span>Taxable Amount</span><span className="v">{inr(totals.sub)}</span></div>
        {igst ? (
          <div className="i3-trow"><span>IGST {+doc.gst || 0}%</span><span className="v">{inr(totals.gstAmt)}</span></div>
        ) : (
          <>
            <div className="i3-trow"><span>SGST {half}%</span><span className="v">{inr(halfAmt)}</span></div>
            <div className="i3-trow"><span>CGST {half}%</span><span className="v">{inr(halfAmt)}</span></div>
          </>
        )}
        <div className="i3-grand"><span className="l">Grand Total</span><span className="v">₹ {inr(totals.grand)}</span></div>
      </div>
      <div className="i3-words">Amount in words: <b>{rupeesInWords(totals.grand)}</b></div>

      {/* tear line + office strip */}
      <div className="i3-tear" />
      <div className="i3-office">
        <div className="i3-bank">
          <div className="i3-lbl">Bank Details</div>
          <div>{bank?.name || "—"}</div>
          <div>A/c {bank?.acName || brand.name}</div>
          <div className="i3-mono">{[bank?.ac, bank?.ifsc].filter(Boolean).join(" · ") || "—"}</div>
        </div>
        <div className="i3-terms">
          <div className="i3-lbl">Terms &amp; Conditions</div>
          <ol>
            {(brand.terms || []).map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
        </div>
      </div>
      <div className="i3-signs">
        <div className="i3-sig">
          <div className="for">&nbsp;</div>
          <div className="line">Customer Signature</div>
        </div>
        <div className="i3-sig">
          <div className="for">For {brand.name}</div>
          <div className="line">Proprietor · Authorised Signature</div>
        </div>
      </div>
    </div>
  );
});

export default InvoicePrintA;
