"use client";
import { cftOf, inr } from "@/lib/calc";
import type { Section } from "@/lib/types";

interface Props {
  sec: Section;
  si: number;
  cft: number;
  amt: number;
  onName: (si: number, v: string) => void;
  onRate: (si: number, v: string) => void;
  onCell: (si: number, ri: number, k: "l" | "w" | "t" | "pcs", v: string) => void;
  onAddRow: (si: number) => void;
  onDelRow: (si: number, ri: number) => void;
  onDelSec: (si: number) => void;
}

const DIM: ("l" | "w" | "t" | "pcs")[] = ["l", "w", "t", "pcs"];

export default function SectionCard({
  sec,
  si,
  cft,
  amt,
  onName,
  onRate,
  onCell,
  onAddRow,
  onDelRow,
  onDelSec,
}: Props) {
  return (
    <div className="section">
      <div className="sec-head">
        <span className="grain">
          <i />
          <i />
          <i />
        </span>
        <input
          className="sec-name"
          value={sec.name}
          aria-label="Wood type name"
          onChange={(e) => onName(si, e.target.value)}
        />
        <span className="rate-box">
          Rate ₹{" "}
          <input
            type="number"
            inputMode="decimal"
            value={sec.rate}
            aria-label="Rate per CFT"
            onChange={(e) => onRate(si, e.target.value)}
          />{" "}
          / CFT
        </span>
        <button className="x-sec" title="Remove wood type" onClick={() => onDelSec(si)}>
          ✕
        </button>
      </div>
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
        <span>CFT</span>
        <span />
      </div>
      <div className="rows">
        {sec.rows.map((r, ri) => (
          <div className="row" key={ri}>
            <span className="sl">{ri + 1}</span>
            {DIM.map((k) => (
              <input
                key={k}
                className="dim"
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
            <span className="cft">{cftOf(r).toFixed(2)}</span>
            <button className="x-row" title="Remove line" onClick={() => onDelRow(si, ri)}>
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="sec-foot">
        <button className="add-row" onClick={() => onAddRow(si)}>
          + Add line
        </button>
        <span className="sec-tot">
          {cft.toFixed(2)} CFT &nbsp;·&nbsp; <b>₹ {inr(amt)}</b>
        </span>
      </div>
      <div className="formula">
        CFT = (L × W × T × Pcs) ÷ 144 &nbsp;·&nbsp; amount = CFT × <b>₹{sec.rate || 0}</b>
      </div>
    </div>
  );
}
