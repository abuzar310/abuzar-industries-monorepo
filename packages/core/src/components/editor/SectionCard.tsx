"use client";
import { cftOf, directOf, inr, pcsOf, rftOf } from "@/lib/calc";
import type { Section } from "@/lib/types";

type CellKey = "l" | "w" | "t" | "pcs" | "cft";
type Mode = "cft" | "direct" | "rft" | "pcs";

interface Props {
  sec: Section;
  si: number;
  cft: number;
  amt: number;
  modes: Mode[]; // which entry modes to offer
  onName: (si: number, v: string) => void;
  onRate: (si: number, v: string) => void;
  onSetMode: (si: number, mode: Mode) => void;
  onCell: (si: number, ri: number, k: CellKey, v: string) => void;
  onAddRow: (si: number) => void;
  onDelRow: (si: number, ri: number) => void;
  onDelSec: (si: number) => void;
}

const DIM: ("l" | "w" | "t" | "pcs")[] = ["l", "w", "t", "pcs"];
const MODE_LABEL: Record<Mode, string> = { cft: "By size", direct: "Total CFT", rft: "Running ft", pcs: "Per price" };

export default function SectionCard({ sec, si, cft, amt, modes, onName, onRate, onSetMode, onCell, onAddRow, onDelRow, onDelSec }: Props) {
  const mode: Mode =
    sec.calcMode === "rft" ? "rft" : sec.calcMode === "direct" ? "direct" : sec.calcMode === "pcs" ? "pcs" : "cft";
  const direct = mode === "direct";
  const rft = mode === "rft";
  const pcs = mode === "pcs";
  const single = direct || pcs; // one-input-per-line modes
  const singleKey: CellKey = direct ? "cft" : "pcs";
  const unit = rft ? "FT" : pcs ? "Pcs" : "CFT";
  const measure = (r: Section["rows"][number]) => (rft ? rftOf(r) : pcs ? pcsOf(r) : direct ? directOf(r) : cftOf(r));
  const totalText = pcs ? String(Math.round(cft)) : cft.toFixed(2);

  return (
    <div className={"section" + (single ? " direct" : "")}>
      <div className="sec-head">
        <span className="grain">
          <i />
          <i />
          <i />
        </span>
        <input className="sec-name" list="woodtypes" value={sec.name} aria-label="Wood type name" onChange={(e) => onName(si, e.target.value)} />
        <span className="mode-seg" role="group" aria-label="Entry mode">
          {modes.map((m) => (
            <button key={m} className={m === mode ? "on" : ""} onClick={() => onSetMode(si, m)} title={`Enter ${MODE_LABEL[m]}`}>
              {MODE_LABEL[m]}
            </button>
          ))}
        </span>
        <button className="x-sec" title="Remove wood type" onClick={() => onDelSec(si)}>
          ✕
        </button>
      </div>

      {single ? (
        <>
          <div className="thead dcols">
            <span>#</span>
            <span>
              {unit}
              <i className="unit">qty</i>
            </span>
            <span />
          </div>
          <div className="rows">
            {sec.rows.map((r, ri) => (
              <div className="row dcols" key={ri}>
                <span className="sl">{ri + 1}</span>
                <input
                  className="dim"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  aria-label={singleKey}
                  data-si={si}
                  data-ri={ri}
                  data-k={singleKey}
                  value={r[singleKey] === "" || r[singleKey] == null ? "" : (r[singleKey] as string | number)}
                  onChange={(e) => onCell(si, ri, singleKey, e.target.value)}
                />
                <button className="x-row" title="Remove line" onClick={() => onDelRow(si, ri)}>
                  ×
                </button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="thead">
            <span>#</span>
            <span>
              L<i className="unit">feet</i>
            </span>
            <span>
              W<i className="unit">inch</i>
            </span>
            <span>
              T<i className="unit">inch</i>
            </span>
            <span>
              Pcs<i className="unit">qty</i>
            </span>
            <span>{unit}</span>
            <span />
          </div>
          <div className="rows">
            {sec.rows.map((r, ri) => (
              <div className="row" key={ri}>
                <span className="sl">{ri + 1}</span>
                {DIM.map((k) => (
                  <input
                    key={k}
                    className={"dim" + (rft && (k === "w" || k === "t") ? " muted" : "")}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    aria-label={k}
                    data-si={si}
                    data-ri={ri}
                    data-k={k}
                    value={r[k] === "" || r[k] == null ? "" : (r[k] as string | number)}
                    onChange={(e) => onCell(si, ri, k, e.target.value)}
                  />
                ))}
                <span className="cft">{measure(r).toFixed(2)}</span>
                <button className="x-row" title="Remove line" onClick={() => onDelRow(si, ri)}>
                  ×
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="sec-foot">
        <button className="add-row" onClick={() => onAddRow(si)}>
          + Add line
        </button>
        <div className="sec-calc">
          <div className="sc-total">
            Total {unit} <b>{totalText}</b>
          </div>
          <div className="sc-row">
            <span className="sc">
              <i>Total {unit}</i>
              <b>{totalText}</b>
            </span>
            <span className="sc">
              <i>Rate ₹/{unit}</i>
              <input type="number" inputMode="decimal" value={sec.rate} aria-label="Rate" onChange={(e) => onRate(si, e.target.value)} />
            </span>
            <span className="sc amt">
              <i>Total Price</i>
              <b>₹ {inr(amt)}</b>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
