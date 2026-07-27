"use client";
import { inr, rupeesInWords } from "@/lib/calc";
import type { PartyStatement } from "@/lib/payments";
import type { Doc } from "@/lib/types";

interface Props {
  doc: Doc;
  sub: number;
  gstAmt: number;
  grand: number;
  totalCft?: number;
  totalCbm?: number;
  totalPcs?: number;
  /** this quote's recorded payments — printed under the final price when the toggle is on */
  payLines?: PartyStatement[];
  onGst: (v: string) => void;
  onGstMode: (m: "percent" | "flat") => void;
}

export default function Totals({ doc, sub, gstAmt, grand, totalCft, totalCbm, totalPcs, payLines, onGst, onGstMode }: Props) {
  const isInv = doc.kind === "invoice";
  const showFinal = !isInv && !!doc.showFinalOnPrint && (doc.finalPrice || 0) > 0;
  // the settlement block: every payment + received + balance/settled — printed with the final price
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const pays = showFinal && payLines ? [...payLines].reverse() : []; // oldest first on paper
  const received = r2(pays.reduce((s, l) => s + l.amount, 0));
  const balance = r2((doc.finalPrice || 0) - received);
  const settled = balance <= 0.5;
  const flat = doc.gstMode === "flat";
  const half = Math.round((+doc.gst || 0) * 50) / 100; // e.g. 18 -> 9
  const halfAmt = Math.round(gstAmt * 50) / 100;
  return (
    <>
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
      {/* the agreed round figure — printed only when the toggle next to Final price is on */}
      {showFinal && (
        <div className="t-row grand final-print">
          <span className="lab">Final price (agreed)</span>
          <span className="val">₹ {inr(doc.finalPrice!)}</span>
        </div>
      )}
      </div>
      {/* the COMPLETE settlement box — its own box below the totals, mirroring the
          on-screen payment card: every payment, total received, balance / Settled ✓ */}
      {showFinal && pays.length > 0 && (
        <table className="pay-sheet">
          <colgroup>
            <col style={{ width: "26%" }} />
            <col style={{ width: "20%" }} />
            <col style={{ width: "30%" }} />
            <col style={{ width: "24%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Payment</th>
              <th>Mode</th>
              <th>Account</th>
              <th className="amt">Amount ₹</th>
            </tr>
          </thead>
          <tbody>
            {pays.map((l) => (
              <tr key={l.id}>
                <td>{l.date || "—"}</td>
                <td>{l.mode === "upi" ? (l.toOwner ? "UPI → Owner" : "UPI") : l.toOwner ? "Cash → Owner" : "Cash"}</td>
                <td>{l.account || "—"}</td>
                <td className="amt">{inr(l.amount)}</td>
              </tr>
            ))}
            <tr className="ps-tot">
              <td colSpan={3}>Total received — of final price ₹{inr(doc.finalPrice!)}</td>
              <td className="amt">{inr(received)}</td>
            </tr>
            <tr className={"ps-bal" + (settled ? " ok" : "")}>
              <td colSpan={3}>{settled ? "Settled" : "Balance due"}</td>
              <td className="amt">{settled ? "✓ Paid in full" : inr(Math.max(0, balance))}</td>
            </tr>
          </tbody>
        </table>
      )}
      {/* amount-in-words lives OUTSIDE the totals box (which clips overflow) so it can never be cut off */}
      <div className="words">
        Amount in words: <b>{rupeesInWords(showFinal ? doc.finalPrice! : grand)}</b>
      </div>
    </>
  );
}
