"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createQuotation } from "@/lib/create";
import { openTab } from "@/lib/editor-tabs";
import {
  blankPaperLine,
  paperLineHasSize,
  paperQuoteSeed,
  parsePaperRead,
  type PaperLine,
} from "@/lib/paper-quote";
import { compressPhoto, PAPER_READ } from "@/lib/photo";
import { WOOD_TYPES } from "@/lib/woods";
import { toast } from "@/store/app-store";

async function readPaper(image: string) {
  const r = await fetch("/api/ai/paper", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image }),
  });
  const data = (await r.json().catch(() => null)) as { error?: string } | null;
  if (!r.ok) throw new Error((data && data.error) || "Could not read that photo");
  const parsed = parsePaperRead(data);
  if (!parsed.lines.length) throw new Error("No sizes found on that photo");
  return parsed;
}

export default function PaperQuoteView() {
  const router = useRouter();
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);
  const [storePhoto, setStorePhoto] = useState("");
  const [preview, setPreview] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [lines, setLines] = useState<PaperLine[]>([]);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);

  const kept = lines.filter((l) => l.keep && paperLineHasSize(l));

  async function fromFile(file: File | undefined) {
    if (!file || reading || saving) return;
    setReading(true);
    try {
      const [readUrl, keepUrl] = await Promise.all([
        compressPhoto(file, PAPER_READ),
        compressPhoto(file),
      ]);
      setPreview(readUrl);
      setStorePhoto(keepUrl);
      const got = await readPaper(readUrl);
      setCustomerName(got.customerName);
      setLines(got.lines.length ? got.lines : [blankPaperLine()]);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not read that photo");
    } finally {
      setReading(false);
      if (camRef.current) camRef.current.value = "";
      if (libRef.current) libRef.current.value = "";
    }
  }

  function patch(i: number, part: Partial<PaperLine>) {
    setLines((rows) => rows.map((row, n) => (n === i ? { ...row, ...part } : row)));
  }

  async function confirm() {
    if (saving || !kept.length) return;
    setSaving(true);
    try {
      const d = await createQuotation(paperQuoteSeed({ lines, customerName, paperPhoto: storePhoto }));
      openTab(d.id, d.number, d.displayNumber);
      toast("Draft " + d.number + " — check the lines");
      router.push("/editor/" + d.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not create quotation");
      setSaving(false);
    }
  }

  return (
    <div className="paper-quote">
      <div className="sectitle">
        New quote from paper <small>— photo the list, then check it</small>
      </div>
      <p className="hint">
        Nothing is saved until you tap <b>Confirm</b>. Tick, fix, or delete lines. The photo stays on the draft.
      </p>

      <input
        ref={camRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => void fromFile(e.target.files?.[0])}
      />
      <input
        ref={libRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => void fromFile(e.target.files?.[0])}
      />

      <div className="rowbtns">
        <button className="btn primary sm" type="button" disabled={reading || saving} onClick={() => camRef.current?.click()}>
          Take photo
        </button>
        <button className="btn sm" type="button" disabled={reading || saving} onClick={() => libRef.current?.click()}>
          Choose photo
        </button>
        <button className="btn sm" type="button" disabled={reading || saving} onClick={() => router.push("/quotations")}>
          Cancel
        </button>
      </div>

      {reading && <p className="hint">Reading the list…</p>}

      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="paper-quote-pic" src={preview} alt="Handwritten list" />
      ) : null}

      {lines.length > 0 && (
        <>
          <label className="modal-field">
            <span>Customer name</span>
            <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Optional — fill later in the editor" />
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
                  <input list="paper-woods" value={line.name} onChange={(e) => patch(i, { name: e.target.value })} />
                </label>
                <div className="paper-dims">
                  {(["l", "w", "t", "pcs"] as const).map((k) => (
                    <label key={k} className="modal-field">
                      <span>{k === "pcs" ? "Pcs" : k.toUpperCase()}</span>
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
          <datalist id="paper-woods">
            {WOOD_TYPES.map((w) => (
              <option key={w} value={w} />
            ))}
          </datalist>

          <div className="rowbtns">
            <button className="btn sm" type="button" onClick={() => setLines((rows) => [...rows, blankPaperLine()])}>
              + Add line
            </button>
            <button className="btn primary sm" type="button" disabled={saving || !kept.length} onClick={() => void confirm()}>
              {saving ? "Making quotation…" : "Confirm — make quotation"}
            </button>
          </div>
          {!kept.length && <p className="hint">Tick at least one line with a size.</p>}
        </>
      )}
    </div>
  );
}
