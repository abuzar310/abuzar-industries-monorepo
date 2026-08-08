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
/** ruled lines per box: one box gets the full 6-line ledger; more boxes shrink so
 *  everything still holds ONE printed page (2 boxes → 4 lines, 3 → 3, 4+ → no padding) */
const minRowsFor = (boxes: number) => (boxes <= 1 ? 6 : boxes === 2 ? 4 : boxes === 3 ? 3 : 1);

function WoodBox({ sec, measure, minRows }: { sec: Section; measure: number; minRows: number }) {
  const bySize = !sec.calcMode || sec.calcMode === "cft";
  const unit = unitOf(sec.calcMode);
  const measurer = measurerOf(sec.calcMode);
  const rows = (sec.rows || []).filter((r) => measurer(r) > 0);
  const amount = amountOf(sec, measure);
  const totalPcs = rows.reduce((s, r) => s + (+r.pcs || 0), 0);
  const hasPcs = totalPcs > 0; // direct/CBM boxes drop the Pcs column when nothing uses it
  const n = Math.max(rows.length, minRows);
  const cell = (r: Row | undefined, v: (r: Row) => string) => (r ? v(r) : "\u00A0");
  return (
    <div className="i3-box">
      <div className="i3-bhead">
        <span>{sec.name || "Wood"}</span>
        {totalPcs > 0 && <em>Total Pcs {totalPcs}</em>}
      </div>
      <table className="i3-btbl">
        {bySize ? (
          /* sizes first (L · W · T · Pcs), the computed CFT LAST on the right */
          <colgroup>
            <col style={{ width: "7%" }} /><col style={{ width: "16%" }} /><col style={{ width: "16%" }} />
            <col style={{ width: "16%" }} /><col style={{ width: "15%" }} /><col style={{ width: "30%" }} />
          </colgroup>
        ) : (
          /* just a quantity: ruled line runs out, the figure sits at ~65%, price column closes the right */
          <colgroup>
            <col style={{ width: "7%" }} />
            <col style={{ width: hasPcs ? "31%" : "46%" }} />
            {hasPcs && <col style={{ width: "15%" }} />}
            <col style={{ width: "18%" }} />
            <col style={{ width: "29%" }} />
          </colgroup>
        )}
        <thead>
          {bySize ? (
            <tr>
              <th className="c">#</th><th className="c">L <small>feet</small></th><th className="c">W <small>inch</small></th>
              <th className="c">T <small>inch</small></th><th className="c">Pcs <small>qty</small></th><th className="r">CFT</th>
            </tr>
          ) : (
            <tr>
              <th className="c">#</th><th>&nbsp;</th>{hasPcs && <th className="c">Pcs</th>}<th className="c">{unit}</th><th>&nbsp;</th>
            </tr>
          )}
        </thead>
        <tbody>
          {Array.from({ length: n }, (_, i) => {
            const r = rows[i];
            return bySize ? (
              <tr key={i}>
                <td className="c i3-sl">{i + 1}</td>
                <td className="c i3-dim">{cell(r, (x) => String(x.l ?? ""))}</td>
                <td className="c i3-dim">{cell(r, (x) => String(x.w ?? ""))}</td>
                <td className="c i3-dim">{cell(r, (x) => String(x.t ?? ""))}</td>
                <td className="c i3-dim">{cell(r, (x) => String(x.pcs ?? ""))}</td>
                <td className="r i3-cft">{cell(r, (x) => inr(cftOf(x)))}</td>
              </tr>
            ) : (
              <tr key={i}>
                <td className="c i3-sl">{i + 1}</td>
                <td>&nbsp;</td>
                {hasPcs && <td className="c i3-dim">{cell(r, (x) => String(x.pcs || "\u00A0"))}</td>}
                <td className="c i3-cft">{cell(r, (x) => inr(measurer(x)))}</td>
                <td>&nbsp;</td>
              </tr>
            );
          })}
        </tbody>
        {!bySize && (
          /* footer INSIDE the table: Total CFT exactly under the CFT column, rate beside, price at the edge */
          <tfoot>
            <tr>
              {/* Rate sits LEFT of Total CFT; Total CFT stays under its column; price closes the row */}
              <td colSpan={hasPcs ? 3 : 2} className="ft-rate">
                <span className="fl">Rate ₹/{unit}</span><b>{inr(+sec.rate || 0)}</b>
              </td>
              <td className="c"><span className="fl">Total {unit}</span><b>{inr(measure)}</b></td>
              <td className="ft-tail">
                <span className="fl">Total Price</span><b>₹ {inr(amount)}</b>
              </td>
            </tr>
          </tfoot>
        )}
      </table>
      {bySize && (
        <div className="i3-bfoot">
          <div><span>Total {unit}</span><b>{inr(measure)}</b></div>
          <div><span>Rate ₹/{unit}</span><b>{inr(+sec.rate || 0)}</b></div>
          <div className="tp"><span>Total Price</span><b>₹ {inr(amount)}</b></div>
        </div>
      )}
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
  // Density tiers (letterhead never shrinks — Tax Invoice + logo + name only):
  //   i3-c1 → Amount in Words + totals / Grand Total (first sacrifice)
  //   i3-c2 → wood Rate·CFT·Total Price footers, then line columns
  //   i3-c3 → signature block
  const boxes = (doc.sections || []).length;
  const minRows = minRowsFor(boxes);
  const rowsTotal = (doc.sections || []).reduce((s, sec) => {
    const measurer = measurerOf(sec.calcMode);
    return s + Math.max((sec.rows || []).filter((r) => measurer(r) > 0).length, minRows);
  }, 0);
  let dense = "";
  if (boxes >= 2 || rowsTotal >= 8) dense += " i3-c1";
  if (rowsTotal >= 14 || boxes >= 3) dense += " i3-c2";
  if (rowsTotal >= 18 || boxes >= 4) dense += " i3-c3";
  return (
    <div className={"cd-print inv3a" + dense} ref={ref}>
      {/* TAX INVOICE — centred on top */}
      <div className="i3-kindtop"><span>Tax Invoice</span></div>

      {/* letterhead: logo + company name only */}
      <div className="i3-mast">
        {brand.logo && <img src="/logo.png" alt={brand.name} />}
        <div className="i3-id">
          <div className="i3-nm">{brand.name}</div>
        </div>
      </div>
      <div className="i3-dbl" />
      {/* seller GSTIN kept for the tax invoice, outside the brand block */}
      {brand.gstin && <div className="i3-gs">GSTIN {brand.gstin}</div>}

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

      {/* the classic wood CFT boxes — ruled lines scale with the box count so ONE page always fits */}
      <div className="i3-boxes">
        {(doc.sections || []).map((sec, si) => (
          <WoodBox key={si} sec={sec} measure={totals.secCft[si] ?? 0} minRows={minRows} />
        ))}
      </div>

      {/* amount-in-words fills the left; the totals box sits right, under the price column */}
      <div className="i3-totrow">
        <div className="i3-words">
          <span className="i3-lbl">Amount in Words</span>
          <b>{rupeesInWords(totals.grand)}</b>
        </div>
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
      </div>

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
