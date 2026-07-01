"use client";
import { cftOf, directOf, inr, rftOf } from "@/lib/calc";
import type { Section } from "@/lib/types";

type CellKey = "l" | "w" | "t" | "pcs" | "cft";

interface Props {
  sec: Section;
  si: number;
  cft: number;
  amt: number;
  onName: (si: number, v: string) => void;
  onRate: (si: number, v: string) => void;
  onMode: (si: number) => void;
  onCell: (si: number, ri: number, k: CellKey, v: string) => void;
  onAddRow: (si: number) => void;
  onDelRow: (si: number, ri: number) => void;
  onDelSec: (si: number) => void;
}

const DIM: ("l" | "w" | "t" | "pcs")[] = ["l", "w", "t", "pcs"];

export default function SectionCard({ sec, si, cft, amt, onName, onRate, onMode, onCell, onAddRow, onDelRow, onDelSec }: Props) {
  const mode = sec.calcMode === "rft" ? "rft" : sec.calcMode === "direct" ? "direct" : "cft";
  const direct = mode === "direct";
  const rft = mode === "rft";
  const unit = rft ? "FT" : "CFT";
  const modeLabel = direct ? "CFT" : rft ? "FT" : "DIM";
  const measure = (r: Section["rows"][number]) => (rft ? rftOf(r) : direct ? directOf(r) : cftOf(r));
  return (
    <div className={"section" + (direct ? " direct" : "")}>
      <div className="sec-head">
        <span className="grain">
          <i />
          <i />
          <i />
        </span>
        <input className="sec-name" list="woodtypes" value={sec.name} aria-label="Wood type name" onChange={(e) => onName(si, e.target.value)} />
        <button className="mode-btn" title="Switch entry: DIM (L·W·T·Pcs) · CFT (direct) · FT (running feet)" onClick={() => onMode(si)}>
          {modeLabel}
        </button>
        <button className="x-sec" title="Remove wood type" onClick={() => onDelSec(si)}>
          ✕
        </button>
      </div>

      {direct ? (
        <>
          <div className="thead dcols">
            <span>#</span>
            <span>
              CFT<i className="unit">qty</i>
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
                  aria-label="cft"
                  data-si={si}
                  data-ri={ri}
                  data-k="cft"
                  value={r.cft === "" || r.cft == null ? "" : (r.cft as string | number)}
                  onChange={(e) => onCell(si, ri, "cft", e.target.value)}
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
        <span className="rate-box">
          Rate ₹{" "}
          <input type="number" inputMode="decimal" value={sec.rate} aria-label="Rate" onChange={(e) => onRate(si, e.target.value)} />{" "}
          / {unit}
        </span>
        <span className="sec-tot">
          {cft.toFixed(2)} {unit} &nbsp;·&nbsp; <b>₹ {inr(amt)}</b>
        </span>
      </div>
      <div className="formula">
        {direct ? (
          <>
            amount = CFT × <b>₹{sec.rate || 0}</b>
          </>
        ) : rft ? (
          <>
            {unit} = L × Pcs &nbsp;·&nbsp; amount = {unit} × <b>₹{sec.rate || 0}</b>
          </>
        ) : (
          <>
            CFT = (L × W × T × Pcs) ÷ 144 &nbsp;·&nbsp; amount = CFT × <b>₹{sec.rate || 0}</b>
          </>
        )}
      </div>
    </div>
  );
}
