"use client";
import { useEffect, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import type { BoxRect, Doc } from "@/lib/types";

// The A4 PRINTABLE area (210×297mm minus the 6mm @page margins = 198×285mm) at 96dpi, in logical px.
// The canvas is always this size; on screen it's scaled to fit the editor width (react-rnd's `scale`
// prop keeps drag/resize in sync), and it prints 1:1 inside the page margins (748px ≈ 198mm).
const PAGE_W = 748;
const PAGE_H = 1077;
const PAD = 10;
const GAP = 10;
const MAST_H = 150; // masthead band at the top of the page (fixed, not draggable)
const ROW_PX = 27; // one data row at --sqrow 0.72cm ≈ 27px
const CHROME_PX = 128; // box header + column labels + footer

const boxH = (rows: number) => CHROME_PX + Math.max(1, rows) * ROW_PX;

export default function QuoteCanvas({
  doc,
  header,
  renderCard,
  renderBill,
  onBox,
  onBillBox,
}: {
  doc: Doc;
  header: React.ReactNode;
  renderCard: (si: number) => React.ReactNode;
  renderBill: () => React.ReactNode;
  onBox: (si: number, r: BoxRect) => void;
  onBillBox: (r: BoxRect) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setScale(Math.min(1, el.clientWidth / PAGE_W));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // default placement (2-column stack) for any box the user hasn't arranged yet
  const colW = (PAGE_W - PAD * 2 - GAP) / 2;
  const defaultBox = (si: number): BoxRect => {
    const col = si % 2;
    let y = MAST_H + PAD;
    for (let j = 0; j < si; j++) if (j % 2 === col) y += boxH(doc.sections[j].rows.length) + GAP;
    return { x: PAD + col * (colW + GAP), y, w: colW, h: boxH(doc.sections[si].rows.length) };
  };
  const defaultBill = (): BoxRect => ({ x: PAD + colW + GAP, y: PAGE_H - 148, w: colW, h: 132 });

  return (
    <div className="qcanvas-wrap" ref={wrapRef} style={{ height: PAGE_H * scale }}>
      <div className="qcanvas" style={{ width: PAGE_W, height: PAGE_H, transform: `scale(${scale})` }}>
        <div className="qc-mast" style={{ height: MAST_H }}>
          {header}
        </div>

        {doc.sections.map((sec, si) => {
          const b = sec.box || defaultBox(si);
          return (
            <Rnd
              key={si}
              className="qc-box"
              scale={scale}
              bounds="parent"
              dragHandleClassName="qc-drag"
              dragGrid={[8, 8]}
              resizeGrid={[8, 8]}
              enableResizing={{ right: true }}
              position={{ x: b.x, y: b.y }}
              size={{ width: b.w, height: "auto" }}
              minWidth={220}
              onDragStop={(_e, d) => onBox(si, { x: Math.round(d.x), y: Math.max(MAST_H, Math.round(d.y)), w: b.w, h: (d.node as HTMLElement).offsetHeight })}
              onResizeStop={(_e, _dir, ref, _delta, pos) =>
                onBox(si, { x: Math.round(pos.x), y: Math.max(MAST_H, Math.round(pos.y)), w: ref.offsetWidth, h: ref.offsetHeight })
              }
            >
              <div className="qc-drag no-print" title="Drag to move this box">
                <span>⠿</span>
              </div>
              <div className="qc-boxinner">{renderCard(si)}</div>
              {/* second handle at the bottom — a box dragged up under the masthead keeps a grabbable spot */}
              <div className="qc-drag qc-drag-b no-print" title="Drag to move this box">
                <span>⠿</span>
              </div>
            </Rnd>
          );
        })}

        {(() => {
          const b = doc.billBox || defaultBill();
          return (
            <Rnd
              className="qc-box qc-bill"
              scale={scale}
              bounds="parent"
              dragHandleClassName="qc-drag"
              dragGrid={[8, 8]}
              resizeGrid={[8, 8]}
              enableResizing={{ right: true }}
              position={{ x: b.x, y: b.y }}
              size={{ width: b.w, height: "auto" }}
              minWidth={240}
              onDragStop={(_e, d) => onBillBox({ x: Math.round(d.x), y: Math.max(MAST_H, Math.round(d.y)), w: b.w, h: (d.node as HTMLElement).offsetHeight })}
              onResizeStop={(_e, _dir, ref, _delta, pos) =>
                onBillBox({ x: Math.round(pos.x), y: Math.max(MAST_H, Math.round(pos.y)), w: ref.offsetWidth, h: ref.offsetHeight })
              }
            >
              <div className="qc-drag no-print" title="Drag the grand total">
                <span>⠿</span>
              </div>
              <div className="qc-boxinner">{renderBill()}</div>
              <div className="qc-drag qc-drag-b no-print" title="Drag the grand total">
                <span>⠿</span>
              </div>
            </Rnd>
          );
        })()}
      </div>
    </div>
  );
}
