"use client";
import { memo, useLayoutEffect, useRef, type RefObject } from "react";
import { printOrSavePdf } from "@/lib/pdf";
import { permitBodyHtml, permitHeadHtml, type PermitFields } from "@/lib/permit-letter-html";
import { REAL_BRAND } from "@/lib/brand";

export type { PermitFields };

/** Never re-renders after mount — Editor's 8s poll must not reset typed edits. */
const PermitSheet = memo(function PermitSheet({
  headHtml,
  bodyHtml,
  sheetRef,
}: {
  headHtml: string;
  bodyHtml: string;
  sheetRef: RefObject<HTMLDivElement | null>;
}) {
  const headRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (headRef.current) headRef.current.innerHTML = headHtml;
    if (bodyRef.current) bodyRef.current.innerHTML = bodyHtml;
    // Fill once. Parent re-renders are ignored (memo compare always true).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="inv3a permit-sheet" ref={sheetRef}>
      <div className="i3-mast">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt={REAL_BRAND.name} contentEditable={false} draggable={false} />
        <div className="i3-id" ref={headRef} contentEditable suppressContentEditableWarning />
      </div>
      <div className="i3-dbl" />
      <div className="permit-body" ref={bodyRef} contentEditable suppressContentEditableWarning />
    </div>
  );
}, () => true);

export default function PermitLetter({
  customerName,
  cft,
  pcs,
  date,
  fields,
  onClose,
}: {
  customerName: string;
  cft: number;
  pcs: number;
  date: string;
  fields: PermitFields;
  onClose: () => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const headHtml = permitHeadHtml();
  const bodyHtml = permitBodyHtml({ customerName, cft, pcs, date, fields });

  return (
    <div className="permit-overlay" role="dialog" aria-label="Permit letter" onClick={onClose}>
      <div className="permit-panel" onClick={(e) => e.stopPropagation()}>
        <div className="permit-actions no-print">
          <span className="permit-hint">Click any text to edit</span>
          <button type="button" className="btn go" onClick={() => void printOrSavePdf(sheetRef.current, "permit")}>
            Print
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <PermitSheet headHtml={headHtml} bodyHtml={bodyHtml} sheetRef={sheetRef} />
      </div>
    </div>
  );
}
