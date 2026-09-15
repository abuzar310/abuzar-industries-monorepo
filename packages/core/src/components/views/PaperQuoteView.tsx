"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { TabIcon } from "../Icons";
import { useRouter } from "next/navigation";
import { createQuotation } from "@/lib/create";
import { getRec, prefGet, put } from "@/lib/data";
import { docStore } from "@/lib/doc";
import { openTab } from "@/lib/editor-tabs";
import {
  applyPaperToDoc,
  blankPaperLine,
  paperLineHasSize,
  paperQuoteSeed,
  parsePaperRead,
  type PaperLine,
} from "@/lib/paper-quote";
import { compressPhoto, PAPER_READ } from "@/lib/photo";
import type { Doc } from "@/lib/types";
import { WOOD_TYPES } from "@/lib/woods";
import { bumpData, toast } from "@/store/app-store";

export type PaperApply = {
  lines: PaperLine[];
  customerName: string;
  paperPhoto: string;
};

type CropBox = { x: number; y: number; w: number; h: number };

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

function clampBox(b: CropBox): CropBox {
  const x = Math.min(Math.max(0, b.x), 0.88);
  const y = Math.min(Math.max(0, b.y), 0.88);
  const w = Math.min(Math.max(0.12, b.w), 1 - x);
  const h = Math.min(Math.max(0.12, b.h), 1 - y);
  return { x, y, w, h };
}

function cropFile(img: HTMLImageElement, box: CropBox): Promise<File> {
  const sx = Math.round(box.x * img.naturalWidth);
  const sy = Math.round(box.y * img.naturalHeight);
  const sw = Math.max(1, Math.round(box.w * img.naturalWidth));
  const sh = Math.max(1, Math.round(box.h * img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Could not crop"));
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("Could not crop"));
        else resolve(new File([blob], "paper.jpg", { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.88,
    );
  });
}

function PaperCrop({
  src,
  onUse,
  onRetake,
}: {
  src: string;
  onUse: (file: File) => void;
  onRetake: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [box, setBox] = useState<CropBox>({ x: 0.06, y: 0.06, w: 0.88, h: 0.88 });
  const drag = useRef<{ kind: string; x: number; y: number; box: CropBox } | null>(null);

  function onPointerDown(kind: string, e: PointerEvent<HTMLElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind, x: e.clientX, y: e.clientY, box };
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    const wrap = wrapRef.current;
    if (!d || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    const dx = (e.clientX - d.x) / rect.width;
    const dy = (e.clientY - d.y) / rect.height;
    const b = d.box;
    if (d.kind === "move") setBox(clampBox({ ...b, x: b.x + dx, y: b.y + dy }));
    else if (d.kind === "nw") setBox(clampBox({ x: b.x + dx, y: b.y + dy, w: b.w - dx, h: b.h - dy }));
    else if (d.kind === "ne") setBox(clampBox({ x: b.x, y: b.y + dy, w: b.w + dx, h: b.h - dy }));
    else if (d.kind === "sw") setBox(clampBox({ x: b.x + dx, y: b.y, w: b.w - dx, h: b.h + dy }));
    else if (d.kind === "se") setBox(clampBox({ x: b.x, y: b.y, w: b.w + dx, h: b.h + dy }));
  }

  function onPointerUp() {
    drag.current = null;
  }

  async function useThis() {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return;
    onUse(await cropFile(img, box));
  }

  return (
    <div className="paper-crop-wrap">
      <p className="hint">Drag the box onto the list. Leave the rest out — faster read.</p>
      <div
        ref={wrapRef}
        className="paper-crop"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={imgRef} src={src} alt="Crop the list" draggable={false} />
        <div
          className="paper-crop-box"
          style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}
          onPointerDown={(e) => onPointerDown("move", e)}
        >
          {(["nw", "ne", "sw", "se"] as const).map((k) => (
            <i key={k} className={"paper-crop-h " + k} onPointerDown={(e) => onPointerDown(k, e)} />
          ))}
        </div>
      </div>
      <div className="rowbtns">
        <button className="btn primary sm" type="button" onClick={() => void useThis()}>
          Use this
        </button>
        <button className="btn sm" type="button" onClick={onRetake}>
          Retake
        </button>
      </div>
    </div>
  );
}

export default function PaperQuoteView({
  onApply,
  onCancel,
  initialFile,
}: {
  onApply?: (got: PaperApply) => void | Promise<void>;
  onCancel?: () => void;
  initialFile?: File | null;
}) {
  const router = useRouter();
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);
  const [cropSrc, setCropSrc] = useState("");
  const [storePhoto, setStorePhoto] = useState("");
  const [preview, setPreview] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [lines, setLines] = useState<PaperLine[]>([]);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const tookFile = useRef<File | null>(null);
  const [lastQuoteId, setLastQuoteId] = useState("");

  const kept = lines.filter((l) => l.keep && paperLineHasSize(l));
  const intoOpen = !!onApply || !!lastQuoteId;

  useEffect(() => {
    if (onApply) return;
    const last = prefGet<{ store: string; id: string } | null>("lastOpen", null);
    if (last?.store === "quotations" && last.id) setLastQuoteId(last.id);
  }, [onApply]);

  function dropCrop() {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc("");
  }

  function pickFile(file: File | undefined) {
    if (!file || reading || saving) return;
    dropCrop();
    setCropSrc(URL.createObjectURL(file));
  }

  useEffect(() => {
    if (!initialFile || tookFile.current === initialFile) return;
    tookFile.current = initialFile;
    pickFile(initialFile);
    // pickFile only needs the new file
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  async function fromCrop(file: File) {
    dropCrop();
    setReading(true);
    try {
      const [readUrl, keepUrl] = await Promise.all([compressPhoto(file, PAPER_READ), compressPhoto(file)]);
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

  function cancel() {
    dropCrop();
    if (onCancel) onCancel();
    else if (lastQuoteId) router.push("/editor/" + lastQuoteId);
    else router.push("/quotations");
  }

  async function confirm() {
    if (saving || !kept.length) return;
    setSaving(true);
    try {
      const payload = { lines, customerName, paperPhoto: storePhoto };
      if (onApply) {
        await onApply(payload);
        return;
      }
      if (lastQuoteId) {
        const doc = await getRec<Doc>("quotations", lastQuoteId);
        if (!doc) throw new Error("That quotation is gone — open it again");
        const next = applyPaperToDoc(doc, payload);
        await put(docStore(next), next);
        bumpData();
        openTab(next.id, next.number, next.displayNumber);
        toast("Lines added to this quotation — check them");
        router.push("/editor/" + next.id);
        return;
      }
      const d = await createQuotation(paperQuoteSeed(payload));
      openTab(d.id, d.number, d.displayNumber);
      toast("Draft " + d.number + " — check the lines");
      router.push("/editor/" + d.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not add those lines");
      setSaving(false);
    }
  }

  return (
    <div className="paper-quote ph-kit">
      <div className="sectitle">
        <span className="phone-ico ph-only"><TabIcon icon="file-text" size={18} /></span>
        {intoOpen ? "Add paper to this quotation" : "New quote from paper"}
        <small><span className="desk-only"> — </span>photo, crop, then check</small>
      </div>
      <p className="hint">Crop the list, then check the lines. Nothing is saved until you confirm.</p>

      <input
        ref={camRef}
        type="file"
        accept="image/*,.heic,.heif"
        capture="environment"
        hidden
        onChange={(e) => pickFile(e.target.files?.[0])}
      />
      <input
        ref={libRef}
        type="file"
        accept="image/*,.heic,.heif"
        hidden
        onChange={(e) => pickFile(e.target.files?.[0])}
      />

      {!cropSrc && (
        <div className="rowbtns">
          <button className="btn primary sm" type="button" disabled={reading || saving} onClick={() => camRef.current?.click()}>
            Take photo
          </button>
          <button className="btn sm" type="button" disabled={reading || saving} onClick={() => libRef.current?.click()}>
            Add image
          </button>
          <button className="btn sm" type="button" disabled={reading || saving} onClick={cancel}>
            Cancel
          </button>
        </div>
      )}

      {cropSrc ? <PaperCrop src={cropSrc} onUse={(file) => void fromCrop(file)} onRetake={dropCrop} /> : null}

      {reading && <p className="hint">Reading the list…</p>}

      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="paper-quote-pic" src={preview} alt="Handwritten list" />
      ) : null}

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
              {saving ? "Adding…" : intoOpen ? "Add to this quotation" : "Confirm — make quotation"}
            </button>
          </div>
          <p className="hint">Check H and Pcs — their handwritten 2 often looks like 11.</p>
          {!kept.length && <p className="hint">Tick at least one line with a size.</p>}
        </>
      )}
    </div>
  );
}
