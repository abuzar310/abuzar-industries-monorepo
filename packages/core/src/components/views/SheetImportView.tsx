"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createQuotation } from "@/lib/create";
import { getRec, prefGet, put } from "@/lib/data";
import { docStore } from "@/lib/doc";
import { openTab } from "@/lib/editor-tabs";
import { blankPaperLine, paperLineHasSize, type PaperLine } from "@/lib/paper-quote";
import { applySheetToDoc, parseSheetFile, sheetQuoteSeed } from "@/lib/sheet-import";
import type { Doc } from "@/lib/types";
import { WOOD_TYPES } from "@/lib/woods";
import { bumpData, toast } from "@/store/app-store";

export type SheetApply = { lines: PaperLine[]; customerName: string };

export default function SheetImportView({
  onApply,
  onCancel,
  initialFile,
}: {
  onApply?: (got: SheetApply) => void | Promise<void>;
  onCancel?: () => void;
  initialFile?: File | null;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const tookFile = useRef<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [lines, setLines] = useState<PaperLine[]>([]);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastQuoteId, setLastQuoteId] = useState("");

  const kept = lines.filter((l) => l.keep && paperLineHasSize(l));
  const intoOpen = !!onApply || !!lastQuoteId;

  useEffect(() => {
    if (onApply) return;
    const last = prefGet<{ store: string; id: string } | null>("lastOpen", null);
    if (last?.store === "quotations" && last.id) setLastQuoteId(last.id);
  }, [onApply]);

  async function loadFile(file: File | undefined) {
    if (!file || reading || saving) return;
    setReading(true);
    setFileName(file.name);
    try {
      const got = await parseSheetFile(file);
      setCustomerName(got.customerName);
      setLines(got.lines.length ? got.lines : [blankPaperLine()]);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not read that file");
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  useEffect(() => {
    if (!initialFile || tookFile.current === initialFile) return;
    tookFile.current = initialFile;
    void loadFile(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  function patch(i: number, part: Partial<PaperLine>) {
    setLines((rows) => rows.map((row, n) => (n === i ? { ...row, ...part } : row)));
  }

  function cancel() {
    if (onCancel) onCancel();
    else if (lastQuoteId) router.push("/editor/" + lastQuoteId);
    else router.push("/quotations");
  }

  async function confirm() {
    if (saving || !kept.length) return;
    setSaving(true);
    try {
      const payload = { lines, customerName };
      if (onApply) {
        await onApply(payload);
        return;
      }
      if (lastQuoteId) {
        const doc = await getRec<Doc>("quotations", lastQuoteId);
        if (!doc) throw new Error("That quotation is gone — open it again");
        const next = applySheetToDoc(doc, payload);
        await put(docStore(next), next);
        bumpData();
        openTab(next.id, next.number, next.displayNumber);
        toast("Lines added — print uses Long list");
        router.push("/editor/" + next.id);
        return;
      }
      const d = await createQuotation(sheetQuoteSeed(payload));
      openTab(d.id, d.number, d.displayNumber);
      toast("Draft " + d.number + " — Long list print");
      router.push("/editor/" + d.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not add those lines");
      setSaving(false);
    }
  }

  return (
    <div className="paper-quote">
      <div className="sectitle">
        {intoOpen ? "Add Excel to this quotation" : "New quote from Excel"}
        <small> — .xlsx or CSV, then check</small>
      </div>
      <p className="hint">
        Columns L B H Pices (or 8x5x3x4). Print switches to Long list so more lines fit on two pages.
      </p>

      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xlsm,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        hidden
        onChange={(e) => void loadFile(e.target.files?.[0])}
      />

      <div className="rowbtns">
        <button className="btn primary sm" type="button" disabled={reading || saving} onClick={() => fileRef.current?.click()}>
          {fileName ? "Pick another file" : "Pick Excel / CSV"}
        </button>
        <button className="btn sm" type="button" disabled={reading || saving} onClick={cancel}>
          Cancel
        </button>
      </div>

      {reading && <p className="hint">Reading the sheet…</p>}
      {fileName && !reading ? <p className="hint">{fileName} — {kept.length} line{kept.length === 1 ? "" : "s"}</p> : null}

      {lines.length > 0 && (
        <>
          <label className="modal-field">
            <span>Customer name</span>
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Optional — fill later in the editor"
            />
          </label>

          <div className="paper-lines">
            {lines.map((line, i) => (
              <div key={i} className={"paper-line" + (line.keep ? "" : " off")}>
                <label className="paper-keep">
                  <input type="checkbox" checked={line.keep} onChange={(e) => patch(i, { keep: e.target.checked })} />
                  Keep
                </label>
                <label className="modal-field">
                  <span>Wood</span>
                  <input list="sheet-woods" value={line.name} onChange={(e) => patch(i, { name: e.target.value })} />
                </label>
                <div className="paper-dims">
                  {(["l", "w", "t", "pcs"] as const).map((k) => (
                    <label key={k} className="modal-field">
                      <span>{k === "pcs" ? "Pcs" : k === "w" ? "B" : k === "t" ? "H" : "L"}</span>
                      <input inputMode="decimal" value={line[k]} onChange={(e) => patch(i, { [k]: e.target.value })} />
                    </label>
                  ))}
                  <label className="modal-field">
                    <span>Rate</span>
                    <input inputMode="decimal" value={line.rate} onChange={(e) => patch(i, { rate: e.target.value })} />
                  </label>
                  <button className="btn warn sm" type="button" onClick={() => setLines((rows) => rows.filter((_, n) => n !== i))}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
          <datalist id="sheet-woods">
            {WOOD_TYPES.map((w) => (
              <option key={w} value={w} />
            ))}
          </datalist>

          <div className="rowbtns">
            <button className="btn sm" type="button" onClick={() => setLines((rows) => [...rows, blankPaperLine()])}>
              + Add line
            </button>
            <button className="btn primary sm" type="button" disabled={saving || !kept.length} onClick={() => void confirm()}>
              {saving ? "Adding…" : intoOpen ? "Add to this quotation" : "Confirm — make quotation"}
            </button>
          </div>
          {!kept.length && <p className="hint">Tick at least one line with a size.</p>}
        </>
      )}
    </div>
  );
}
