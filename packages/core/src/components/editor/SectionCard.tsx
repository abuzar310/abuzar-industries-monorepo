"use client";
import { cftOf, directOf, inr, pcsOf, rftOf } from "@/lib/calc";
import type { Section } from "@/lib/types";

type CellKey = "l" | "w" | "t" | "pcs" | "cft";
type Mode = "cft" | "direct" | "rft" | "pcs" | "cbm";

interface Props {
  sec: Section;
  si: number;
  cft: number;
  modes: Mode[]; // which entry modes to offer
  selRows: Set<number>; // selected line indices in this box (for Excel-style copy)
  reorderable: boolean; // allow dragging this box by its header to reorder (auto layout)
  onName: (si: number, v: string) => void;
  onRate: (si: number, v: string) => void;
  onSetMode: (si: number, mode: Mode) => void;
  onCell: (si: number, ri: number, k: CellKey, v: string) => void;
  onAmt: (si: number, v: string) => void; // override the section Total Price directly
  onSelRow: (si: number, ri: number) => void; // click a line number to (de)select it
  onSelAll: (si: number) => void; // click the "#" header to select/clear the whole box
  onDragStartSec: (si: number) => void;
  onDropSec: (si: number) => void;
  onAddRow: (si: number) => void;
  onDelRow: (si: number, ri: number) => void;
  onDelSec: (si: number) => void;
}

const DIM: ("l" | "w" | "t" | "pcs")[] = ["l", "w", "t", "pcs"];
const MODE_LABEL: Record<Mode, string> = { cft: "By size", direct: "Total CFT", cbm: "Total CBM", rft: "Running ft", pcs: "Per price" };

export default function SectionCard({ sec, si, cft, modes, selRows, reorderable, onName, onRate, onSetMode, onCell, onAmt, onSelRow, onSelAll, onDragStartSec, onDropSec, onAddRow, onDelRow, onDelSec }: Props) {
  const mode: Mode =
    sec.calcMode === "rft"
      ? "rft"
      : sec.calcMode === "direct"
        ? "direct"
        : sec.calcMode === "cbm"
          ? "cbm"
          : sec.calcMode === "pcs"
            ? "pcs"
            : "cft";
  const direct = mode === "direct";
  const cbm = mode === "cbm";
  const rft = mode === "rft";
  const pcs = mode === "pcs";
  const single = direct || cbm; // "Total CFT" / "Total CBM" use a single input; "Per price" shows full dimensions
  const singleKey: CellKey = "cft";
  const unit = cbm ? "CBM" : rft ? "FT" : pcs ? "Pcs" : "CFT";
  const measure = (r: Section["rows"][number]) =>
    rft ? rftOf(r) : pcs ? pcsOf(r) : direct || cbm ? directOf(r) : cftOf(r);
  const totalText = pcs ? String(Math.round(cft)) : cft.toFixed(2);
  const totalPcs = sec.rows.reduce((s, r) => s + (Math.round(+r.pcs) || 0), 0);
  // per-price prices by piece, but the L·W·T·Pcs are entered — show the CFT for reference (pricing unchanged)
  const pcsCft = pcs ? sec.rows.reduce((s, r) => s + cftOf(r), 0) : 0;
  const baseAmt = Math.round(cft * (+sec.rate || 0) * 100) / 100; // qty × rate (before any manual override)
  const allSel = sec.rows.length > 0 && selRows.size === sec.rows.length; // whole box selected

  const numHead = (
    <span
      className={"selall" + (allSel ? " sel" : "")}
      title="Select all lines in this box (then Ctrl/Cmd+C)"
      onClick={() => onSelAll(si)}
    >
      #
    </span>
  );

  // header cells for the CFT-first table (# · CFT · L · W · T · Pcs)
  const head = (
    <>
      {numHead}
      {!pcs && <span>{unit}</span>}
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
      <span />
    </>
  );

  return (
    <div
      className={"section" + (single ? " direct" : "")}
      onDragOver={reorderable ? (e) => e.preventDefault() : undefined}
      onDrop={reorderable ? () => onDropSec(si) : undefined}
    >
      <div className="sec-head">
        <span
          className={"grain" + (reorderable ? " draghandle" : "")}
          draggable={reorderable}
          onDragStart={reorderable ? () => onDragStartSec(si) : undefined}
          title={reorderable ? "Drag to reorder this box" : undefined}
        >
          <i />
          <i />
          <i />
        </span>
        <input className="sec-name" list="woodtypes" value={sec.name} aria-label="Wood type name" onChange={(e) => onName(si, e.target.value)} />
        {!single && (
          <span className="sec-pcs">
            Total Pcs <b>{totalPcs}</b>
          </span>
        )}
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
            {numHead}
            <span>
              {unit}
              <i className="unit">qty</i>
            </span>
            <span />
          </div>
          <div className="rows">
            {sec.rows.map((r, ri) => (
              <div className={"row dcols" + (selRows.has(ri) ? " selrow" : "")} key={ri}>
                <span
                  className={"sl selsl" + (selRows.has(ri) ? " sel" : "")}
                  title="Click to select this line (copy with Ctrl/Cmd+C)"
                  onClick={() => onSelRow(si, ri)}
                >
                  {ri + 1}
                </span>
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
          <div className={"thead cf" + (pcs ? " pcstab" : "")}>{head}</div>
          <div className="rows">
            {sec.rows.map((r, ri) => (
              <div className={"row cf" + (pcs ? " pcstab" : "") + (selRows.has(ri) ? " selrow" : "")} key={ri}>
                <span
                  className={"sl selsl" + (selRows.has(ri) ? " sel" : "")}
                  title="Click to select this line (copy with Ctrl/Cmd+C)"
                  onClick={() => onSelRow(si, ri)}
                >
                  {ri + 1}
                </span>
                {!pcs && <span className="cft">{measure(r).toFixed(2)}</span>}
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
        {/* one row: Total CFT · Rate · Total Price */}
        <div className="sec-calc oneline">
          <span className="sc">
            <i>Total {unit}</i>
            <b>{totalText}</b>
          </span>
          {pcs && (
            <span className="sc">
              <i>Total CFT</i>
              <b>{pcsCft.toFixed(2)}</b>
            </span>
          )}
          <span className="sc">
            <i>Rate ₹/{unit}</i>
            <input type="number" inputMode="decimal" value={sec.rate} aria-label="Rate" onChange={(e) => onRate(si, e.target.value)} />
          </span>
          <span className="sc amt">
            <i>Total Price</i>
            <span className="amt-edit no-print">
              ₹{" "}
              <input
                type="number"
                inputMode="decimal"
                aria-label="Total price"
                title="Type to set a custom total; clear to use quantity × rate"
                value={sec.amtOverride ?? ""}
                placeholder={inr(baseAmt)}
                onChange={(e) => onAmt(si, e.target.value)}
              />
            </span>
            {/* solid value for print (the input's placeholder prints too faint) */}
            <b className="amt-print">₹ {inr(sec.amtOverride != null ? +sec.amtOverride : baseAmt)}</b>
          </span>
        </div>
      </div>
    </div>
  );
}
