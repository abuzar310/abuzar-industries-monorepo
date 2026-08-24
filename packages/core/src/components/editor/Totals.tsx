"use client";
import { inr, rupeesInWords } from "@/lib/calc";
import { getFeatures } from "@/lib/features";
import { useApp } from "@/store/useApp";
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
  /** ₹ held as “Advance for next quote” from this quotation — always prints when set */
  advanceAmt?: number;
  onGst: (v: string) => void;
  onGstMode: (m: "percent" | "flat") => void;
  /** unofficial quote: optional permit fee charged to the customer */
  onPermitFee?: (v: number | undefined) => void;
}

export default function Totals({ doc, sub, gstAmt, grand, totalCft, totalCbm, totalPcs, payLines, advanceAmt, onGst, onGstMode, onPermitFee }: Props) {
  const { cloakMoney } = useApp();
  const isInv = doc.kind === "invoice";
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const permit = !isInv ? r2(Math.max(0, +doc.permitFee || 0)) : 0;
  const showPermit = permit > 0.005;
  const editPermit = !isInv && !!onPermitFee && getFeatures().simpleQuote;
  const finalPrice = !isInv && (doc.finalPrice || 0) > 0 ? r2(doc.finalPrice!) : 0;
  const hasFinal = finalPrice > 0;
  /** wood+GST only — permit sits on top of the rounded Final price, not inside the discount */
  const wood = r2(grand - permit);
  const billed = hasFinal ? r2(finalPrice + permit) : grand;
  /** print toggle — when off, discount/final still show on screen but stay off the paper */
  const printFinal = hasFinal && !!doc.showFinalOnPrint;
  const discAmt = hasFinal ? r2(wood - finalPrice) : 0;
  const hasDiscount = hasFinal && Math.abs(discAmt) > 0.5;
  const screenOnly = hasFinal && !printFinal ? " no-print" : "";
  const advance = !isInv && (advanceAmt || 0) > 0.5 ? r2(advanceAmt!) : 0;
  // the settlement block: every payment + received + balance/settled — printed with the final price
  const pays = printFinal && payLines ? [...payLines].reverse() : []; // oldest first on paper
  const received = r2(pays.reduce((s, l) => s + l.amount, 0));
  const balance = r2(billed - received);
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
            <input
              type="number"
              inputMode="decimal"
              value={cloakMoney ? "0" : doc.gst}
              readOnly={cloakMoney}
              onChange={(e) => {
                if (!cloakMoney) onGst(e.target.value);
              }}
            />
            {flat ? "" : "%"}
          </span>
          <span className="val">{inr(gstAmt)}</span>
        </div>
      )}
      {/* unofficial: optional permit fee — prints only when an amount is set */}
      {(editPermit || showPermit) && (
        <div className={"t-row permit" + (showPermit ? "" : " no-print")}>
          <span className="lab">Permit fee</span>
          {editPermit ? (
            <>
              <span className="val no-print gst-lab">
                ₹
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  placeholder="optional"
                  value={cloakMoney ? "0" : doc.permitFee ? String(doc.permitFee) : ""}
                  readOnly={cloakMoney}
                  onChange={(e) => {
                    if (cloakMoney || !onPermitFee) return;
                    const raw = e.target.value.trim();
                    const n = parseFloat(raw);
                    if (!raw || !isFinite(n) || n <= 0) onPermitFee(undefined);
                    else onPermitFee(r2(n));
                  }}
                />
              </span>
              {showPermit && <span className="val print-only">₹ {inr(permit)}</span>}
            </>
          ) : (
            <span className="val">₹ {inr(permit)}</span>
          )}
        </div>
      )}
      {/* dark bar stays on Grand total unless Final is also going on the printed sheet */}
      <div className={"t-row" + (printFinal ? "" : " grand")}>
        <span className="lab">Grand total</span>
        <span className="val">{printFinal ? inr(grand) : <>₹ {inr(grand)}</>}</span>
      </div>
      {/* final ≠ computed → Discount (or Round off if higher) */}
      {hasDiscount && (
        <div className={"t-row discount" + screenOnly}>
          <span className="lab">{discAmt > 0 ? "Discount" : "Round off"}</span>
          <span className="val">
            {discAmt > 0 ? "− " + inr(discAmt) : "+ " + inr(-discAmt)}
          </span>
        </div>
      )}
      {/* agreed figure — on screen whenever set; on paper only with the print toggle */}
      {hasFinal && (
        <div className={"t-row" + (printFinal ? " grand final-print" : " final-screen") + screenOnly}>
          <span className="lab">Final price</span>
          <span className="val">₹ {inr(billed)}</span>
        </div>
      )}
      {/* advance taken on this quote for the next one — always on the printed sheet */}
      {advance > 0 && (
        <div className="t-row advance">
          <span className="lab">Advance</span>
          <span className="val">₹ {inr(advance)}</span>
        </div>
      )}
      </div>
      {/* the COMPLETE settlement box — its own box below the totals, mirroring the
          on-screen payment card: every payment, total received, balance / Settled ✓ */}
      {printFinal && pays.length > 0 && (
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
              <td colSpan={3}>Total received — of final price ₹{inr(billed)}</td>
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
      <div className={"words" + (hasFinal && !printFinal ? " no-print" : "")}>
        Amount in words: <b>{rupeesInWords(hasFinal ? billed : grand)}</b>
      </div>
      {hasFinal && !printFinal && (
        <div className="words print-only">
          Amount in words: <b>{rupeesInWords(grand)}</b>
        </div>
      )}
    </>
  );
}
