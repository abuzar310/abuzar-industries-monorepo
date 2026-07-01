"use client";
import { inr, rupeesInWords } from "@/lib/calc";
import type { Doc } from "@/lib/types";

interface Props {
  doc: Doc;
  sub: number;
  gstAmt: number;
  grand: number;
  onGst: (v: string) => void;
}

export default function Totals({ doc, sub, gstAmt, grand, onGst }: Props) {
  const isInv = doc.kind === "invoice";
  const paid = +doc.amountPaid || 0;
  const bal = Math.round((grand - paid) * 100) / 100;
  const half = Math.round((+doc.gst || 0) * 50) / 100; // e.g. 18 -> 9
  const halfAmt = Math.round(gstAmt * 50) / 100;
  return (
    <div className="totals">
      <div className="t-row">
        <span className="lab">{isInv ? "Taxable Amount" : "Sub-total"}</span>
        <span className="val">{inr(sub)}</span>
      </div>
      {isInv ? (
        <>
          <div className="t-row">
            <span className="lab">SGST {half}%</span>
            <span className="val">{inr(halfAmt)}</span>
          </div>
          <div className="t-row">
            <span className="lab">CGST {half}%</span>
            <span className="val">{inr(halfAmt)}</span>
          </div>
        </>
      ) : (
        <div className="t-row">
          <span className="lab gst-lab">
            GST{" "}
            <input type="number" inputMode="decimal" value={doc.gst} onChange={(e) => onGst(e.target.value)} />%
          </span>
          <span className="val">{inr(gstAmt)}</span>
        </div>
      )}
      <div className="t-row grand">
        <span className="lab">Grand total</span>
        <span className="val">₹ {inr(grand)}</span>
      </div>
      {isInv && (
        <div className="t-row">
          <span className="lab">Paid</span>
          <span className="val">{inr(paid)}</span>
        </div>
      )}
      {isInv && (
        <div className="t-row">
          <span className="lab">Balance</span>
          <span className="val">{inr(bal)}</span>
        </div>
      )}
      <div className="words">
        Amount in words: <b>{rupeesInWords(grand)}</b>
      </div>
    </div>
  );
}
