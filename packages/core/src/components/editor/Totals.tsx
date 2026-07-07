"use client";
import { inr, rupeesInWords } from "@/lib/calc";
import type { Doc } from "@/lib/types";

interface Props {
  doc: Doc;
  sub: number;
  gstAmt: number;
  grand: number;
  totalCft?: number;
  totalCbm?: number;
  totalPcs?: number;
  onGst: (v: string) => void;
  onGstMode: (m: "percent" | "flat") => void;
}

export default function Totals({ doc, sub, gstAmt, grand, totalCft, totalCbm, totalPcs, onGst, onGstMode }: Props) {
  const isInv = doc.kind === "invoice";
  const flat = doc.gstMode === "flat";
  const half = Math.round((+doc.gst || 0) * 50) / 100; // e.g. 18 -> 9
  const halfAmt = Math.round(gstAmt * 50) / 100;
  return (
    <div className="totals">
      {isInv && totalCft ? (
        <div className="t-row">
          <span className="lab">Total CFT</span>
          <span className="val">{totalCft.toFixed(2)}</span>
        </div>
      ) : null}
      {isInv && totalCbm ? (
        <div className="t-row">
          <span className="lab">Total CBM</span>
          <span className="val">{totalCbm.toFixed(3)}</span>
        </div>
      ) : null}
      {isInv && totalPcs ? (
        <div className="t-row">
          <span className="lab">Total Pcs</span>
          <span className="val">{totalPcs}</span>
        </div>
      ) : null}
      <div className="t-row">
        <span className="lab">{isInv ? "Taxable Amount" : "Sub-total"}</span>
        <span className="val">{inr(sub)}</span>
      </div>
      {isInv ? (
        doc.gstKind === "igst" ? (
          <div className="t-row">
            <span className="lab">IGST {+doc.gst || 0}%</span>
            <span className="val">{inr(gstAmt)}</span>
          </div>
        ) : (
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
        )
      ) : (
        <div className="t-row">
          <span className="lab gst-lab">
            GST
            <button type="button" className="gst-toggle" title="Switch % / flat ₹" onClick={() => onGstMode(flat ? "percent" : "flat")}>
              {flat ? "₹ flat" : "%"}
            </button>
            <input type="number" inputMode="decimal" value={doc.gst} onChange={(e) => onGst(e.target.value)} />
            {flat ? "" : "%"}
          </span>
          <span className="val">{inr(gstAmt)}</span>
        </div>
      )}
      <div className="t-row grand">
        <span className="lab">Grand total</span>
        <span className="val">₹ {inr(grand)}</span>
      </div>
      <div className="words">
        Amount in words: <b>{rupeesInWords(grand)}</b>
      </div>
    </div>
  );
}
