"use client";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useRouter } from "next/navigation";
import { todayStr } from "@/lib/calc";
import { pdfDataUrl, preparePaperPhoto, readPurchaseSource, type PaperSource } from "@/lib/paper-client";
import { generatePdf } from "@/lib/pdf";
import {
  buildCheck,
  guessNotation,
  parsePurchaseRead,
  purchaseNum,
  tallySheet,
  type Notation,
  type PurchaseRawLine,
  type PurchaseRead,
  type TotalCheck,
} from "@/lib/purchase-check";
import { IMPORT_ACCEPT, importKind, readPurchaseSheetBytes } from "@/lib/sheet-import";
import { xlsxBytes } from "@/lib/xlsx-write";
import { toast } from "@/store/app-store";
import { useApp } from "@/store/useApp";
import { TabIcon } from "../Icons";
import PaperScanner from "../PaperScanner";
import PdfButtons from "../PdfButtons";

type Kept = { read: PurchaseRead; ftIn: boolean; name: string; file: string };

/** The last check stays while the app is open, so leaving this screen and coming back keeps it. */
let kept: Kept | null = null;

/** A line being changed: an existing one by its place in their list, or a new one (at null) added in a width folder. */
type Editing = { at: number | null; folder: number; draft: PurchaseRawLine };
type TotalsDraft = { pcs: string; cft: string; cbm: string };

const WHY: Record<Notation["why"], string> = {
  cft: "Checked against the CFT printed on their list.",
  total: "Checked against their total CFT.",
  pattern: "Their lengths end in .3, .6 and .9.",
  none: "Pick how their lengths are written.",
};

// "|| 0" keeps a rounded -0 from printing as "-0"
const n3 = (v: number) => (Math.round(v * 1000) / 1000 || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 });
const whole = (v: number) => (Math.round(v) || 0).toLocaleString("en-IN");
const signed = (v: number, fmt: (n: number) => string) => (Math.round(v * 1000) > 0 ? "+" : "") + fmt(v);
const okClass = (c: TotalCheck) => (c.ok === true ? "pchk-ok" : c.ok === false ? "pchk-off" : "");
const numText = (n: number | null) => (n === null ? "" : String(Math.round(n * 1000) / 1000));
const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "list";
const tagOf = (name: string) => (/\.pdf$/i.test(name) ? "PDF" : /\.(xlsx|xlsm|xls|csv)$/i.test(name) ? "XLS" : "IMG");

/** A tap anywhere on a row does what its button does, without firing twice when the tap lands on the button. */
const rowTap = (act: () => void) => (e: ReactMouseEvent) => {
  if (!(e.target as Element).closest("button")) act();
};

function Total({ label, check, whole: isWhole }: { label: string; check: TotalCheck; whole?: boolean }) {
  const fmt = isWhole ? whole : n3;
  return (
    <div className="stat">
      <div className="k">{label}</div>
      <div className="v">{fmt(check.ours)}</div>
      <div className={"sub " + okClass(check)}>
        {check.theirs === null
          ? "no supplier total"
          : check.ok
            ? "✓ supplier " + fmt(check.theirs)
            : "✗ supplier " + fmt(check.theirs) + " (" + signed(check.diff, fmt) + ")"}
      </div>
    </div>
  );
}

/** A supplier's list as our own sheet: L / W / T / Pcs in width folders, every line editable, our totals against theirs. Nothing is saved; the Excel is the saved copy and opens here again. */
export default function PurchaseCheckView() {
  const { user } = useApp();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const [read, setRead] = useState<PurchaseRead | null>(kept?.read ?? null);
  const [ftIn, setFtIn] = useState(kept?.ftIn ?? false);
  const [name, setName] = useState(kept?.name ?? "");
  const [file, setFile] = useState(kept?.file ?? "");
  const [reading, setReading] = useState<{ file: string; startedAt: number } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState<{ source: PaperSource; file: string } | null>(null);
  const [scan, setScan] = useState<File | "camera" | null>(null);
  const [now, setNow] = useState(0);
  const [folders, setFolders] = useState<Set<number>>(() => new Set());
  const [editing, setEditing] = useState<Editing | null>(null);
  const [totalsDraft, setTotalsDraft] = useState<TotalsDraft | null>(null);
  const [editError, setEditError] = useState("");

  useEffect(() => {
    if (user && user.role !== "owner") router.replace("/");
  }, [user, router]);

  useEffect(() => {
    kept = read ? { read, ftIn, name, file } : null;
  }, [read, ftIn, name, file]);

  useEffect(() => {
    if (!reading) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [reading]);

  function stopEditing() {
    setEditing(null);
    setTotalsDraft(null);
    setEditError("");
  }

  function show(got: PurchaseRead, from: string) {
    setRead(got);
    setFtIn(guessNotation(got).ftIn);
    setName(got.title || from.replace(/\.[^.]+$/, ""));
    setFile(from);
    setError("");
    setRetry(null);
    setFolders(new Set());
    stopEditing();
  }

  async function ask(source: PaperSource, from: string) {
    setReading({ file: from, startedAt: Date.now() });
    setError("");
    setRetry(null);
    try {
      show(await readPurchaseSource(source), from);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that list. Tap Try again.");
      setRetry({ source, file: from });
    } finally {
      setReading(null);
    }
  }

  /** Excel or CSV with clear columns reads here at once; a PDF, a photo or an odd sheet goes to the reader. */
  async function open(picked: File) {
    setError("");
    setRetry(null);
    const kind = importKind(picked);
    try {
      if (kind === "image") setScan(picked);
      else if (kind === "pdf") await ask({ pdf: await pdfDataUrl(picked) }, picked.name);
      else if (kind === "sheet") {
        const got = await readPurchaseSheetBytes(picked.name, new Uint8Array(await picked.arrayBuffer()));
        if ("read" in got) show(got.read, picked.name);
        else await ask({ text: got.text }, picked.name);
      } else setError("Send an Excel, CSV or PDF file, or a photo of the list");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open that file");
    }
  }

  async function fromPhoto(photo: File) {
    setScan(null);
    try {
      const { image } = await preparePaperPhoto(photo);
      await ask({ image }, photo.name || "photo.jpg");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open that photo");
    }
  }

  function toggle(width: number) {
    setFolders((was) => {
      const next = new Set(was);
      if (!next.delete(width)) next.add(width);
      return next;
    });
  }

  function startLine(at: number | null, folder: number) {
    if (!read) return;
    stopEditing();
    setEditing({ at, folder, draft: at === null ? { item: "", l: "", w: String(folder), t: "", pcs: "", cft: "" } : { ...read.lines[at] } });
  }

  function setDraft(key: keyof PurchaseRawLine, value: string) {
    setEditing((e) => (e ? { ...e, draft: { ...e.draft, [key]: value } } : e));
  }

  /** Done needs a length, width, thickness and piece count. Their printed CFT stays with a line only while its sizes are unchanged. */
  function saveLine() {
    if (!read || !editing) return;
    const clean = parsePurchaseRead({ lines: [editing.draft] }).lines[0];
    if (!clean) {
      setEditError("Fill in length, width, thickness and pieces.");
      return;
    }
    const lines = [...read.lines];
    const was = editing.at === null ? null : lines[editing.at];
    const sameSize = !!was && was.l === clean.l && was.w === clean.w && was.t === clean.t && was.pcs === clean.pcs;
    const line = { ...clean, cft: was && sameSize ? was.cft : "" };
    if (editing.at === null) lines.push(line);
    else lines[editing.at] = line;
    setRead({ ...read, lines });
    setFolders((o) => new Set(o).add(purchaseNum(clean.w) ?? 0));
    stopEditing();
  }

  function deleteLine() {
    if (!read || !editing || editing.at === null) return;
    const at = editing.at;
    setRead({ ...read, lines: read.lines.filter((_, i) => i !== at) });
    stopEditing();
  }

  function startTotals() {
    if (!read) return;
    stopEditing();
    setTotalsDraft({ pcs: numText(read.totals.pcs), cft: numText(read.totals.cft), cbm: numText(read.totals.cbm) });
  }

  function saveTotals() {
    if (!read || !totalsDraft) return;
    setRead({ ...read, totals: { pcs: purchaseNum(totalsDraft.pcs), cft: purchaseNum(totalsDraft.cft), cbm: purchaseNum(totalsDraft.cbm) } });
    stopEditing();
  }

  const check = read ? buildCheck({ ...read, title: name }, ftIn) : null;
  const note = read ? guessNotation(read) : null;
  const fractional = !!read && read.lines.some((x) => /\.\d/.test(x.l));
  const items = !!check && check.lines.some((x) => x.item);
  const cols = items ? 7 : 6;
  const labelCols = cols - 3;
  const base = "purchase-check-" + slug(name || file);

  function saveExcel() {
    if (!check) return;
    const blob = new Blob([xlsxBytes([tallySheet(check)]) as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = base + "-" + todayStr() + ".xlsx";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
    toast("Excel downloaded ✓");
  }

  async function savePdf(preview: boolean) {
    if (!printRef.current || !check) return;
    if (!preview) toast("Preparing PDF…");
    try {
      await generatePdf(printRef.current, base, {
        pageBreak: ".pchk-totals,.pchk-warn,.pchk-note,.pchk-sheet tr",
        width: 700,
        title: "Purchase check — " + (name || file),
        marginMm: 8,
        preview,
      });
      if (!preview) toast("PDF downloaded ✓");
    } catch {
      toast("Could not create the PDF");
    }
  }

  function clear() {
    setRead(null);
    setName("");
    setFile("");
    setError("");
    setRetry(null);
    setFolders(new Set());
    stopEditing();
  }

  function lineForm(key: string) {
    if (!editing) return null;
    const field = (k: keyof PurchaseRawLine, label: string, mode: "decimal" | "numeric" | "text") => (
      <label>
        {label}
        <input value={editing.draft[k]} inputMode={mode} onChange={(e) => setDraft(k, e.target.value)} />
      </label>
    );
    return (
      <tr className="pchk-edit no-print" key={key}>
        <td colSpan={cols}>
          <form
            className="pchk-form"
            onSubmit={(e) => {
              e.preventDefault();
              saveLine();
            }}
          >
            {field("item", "Item", "text")}
            {field("l", "Length (ft)", "decimal")}
            {field("w", "Width (in)", "decimal")}
            {field("t", "Thick (in)", "decimal")}
            {field("pcs", "Pcs", "numeric")}
            <span className="pchk-form-acts">
              <button type="submit" className="btn sm primary">
                Done
              </button>
              <button type="button" className="btn sm" onClick={stopEditing}>
                Cancel
              </button>
              {editing.at === null ? null : (
                <button type="button" className="btn sm warn" onClick={deleteLine}>
                  Delete line
                </button>
              )}
            </span>
          </form>
          {ftIn ? <p className="pchk-hint">Type lengths the way their list writes them: 6.3 is 6 ft 3 in.</p> : null}
          {editError ? (
            <p className="pchk-error" role="alert">
              {editError}
            </p>
          ) : null}
        </td>
      </tr>
    );
  }

  function totalsForm() {
    if (!totalsDraft) return null;
    const field = (k: keyof TotalsDraft, label: string) => (
      <label>
        {label}
        <input
          value={totalsDraft[k]}
          inputMode="decimal"
          onChange={(e) => {
            const v = e.target.value;
            setTotalsDraft((t) => (t ? { ...t, [k]: v } : t));
          }}
        />
      </label>
    );
    return (
      <tr className="pchk-edit no-print">
        <td colSpan={cols}>
          <form
            className="pchk-form"
            onSubmit={(e) => {
              e.preventDefault();
              saveTotals();
            }}
          >
            {field("pcs", "Their pcs")}
            {field("cft", "Their CFT")}
            {field("cbm", "Their CBM")}
            <span className="pchk-form-acts">
              <button type="submit" className="btn sm primary">
                Done
              </button>
              <button type="button" className="btn sm" onClick={stopEditing}>
                Cancel
              </button>
            </span>
          </form>
          <p className="pchk-hint">Leave a box empty when their list has no total.</p>
        </td>
      </tr>
    );
  }

  return (
    <div className="ph-kit">
      <button className="btn sm" style={{ marginBottom: 14 }} onClick={() => router.push("/buys")}>
        ← Suppliers
      </button>
      <div className="sectitle">
        <span className="phone-ico ph-only"><TabIcon icon="scale" size={18} /></span>
        Purchase check <small><span className="desk-only">— </span>a supplier&apos;s list in your L / W / T / Pcs, with totals</small>
      </div>
      <div className="rowbtns pchk-open">
        <button type="button" className="btn primary" onClick={() => fileRef.current?.click()}>
          Open supplier file
        </button>
        <button type="button" className="btn" onClick={() => setScan("camera")}>
          Scan list
        </button>
      </div>
      <p className="note">Excel, CSV, PDF or a photo. Nothing is saved here: download the Excel to keep your changes, and open it again later.</p>
      <input
        ref={fileRef}
        type="file"
        accept={IMPORT_ACCEPT}
        hidden
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = "";
          if (picked) void open(picked);
        }}
      />

      {reading ? (
        <div className="paper-job" role="status">
          <span className="paper-job-pic paper-job-tag" aria-hidden="true">
            {tagOf(reading.file)}
          </span>
          <span className="paper-job-text">
            <span className="paper-spin" aria-hidden="true" />
            Reading {reading.file}…
            {now > reading.startedAt ? <span aria-hidden="true">{Math.round((now - reading.startedAt) / 1000)}s</span> : null}
          </span>
        </div>
      ) : null}
      {error ? (
        <div className="paper-job is-error" role="alert">
          <span className="paper-job-text">{error}</span>
          <span className="paper-job-acts">
            {retry ? (
              <button className="btn primary sm" type="button" onClick={() => void ask(retry.source, retry.file)}>
                Try again
              </button>
            ) : null}
            <button className="btn sm" type="button" onClick={() => setError("")}>
              Close
            </button>
          </span>
        </div>
      ) : null}

      {check && note ? (
        <>
          <div className="pchk-head">
            <label className="pchk-name">
              <span>Name on the PDF and Excel</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Container or supplier" />
            </label>
            <span className="pchk-acts">
              <PdfButtons onPreview={() => void savePdf(true)} onDownload={() => void savePdf(false)} />
              <button type="button" className="btn sm" onClick={saveExcel}>
                Excel
              </button>
              <button type="button" className="btn sm" onClick={clear}>
                Clear
              </button>
            </span>
          </div>
          {fractional ? (
            <div className="pchk-notation">
              <span>In their list 6.3 means</span>
              <span className="rep-seg">
                <button type="button" className={ftIn ? "on" : ""} aria-pressed={ftIn} onClick={() => setFtIn(true)}>
                  6 ft 3 in
                </button>
                <button type="button" className={ftIn ? "" : "on"} aria-pressed={!ftIn} onClick={() => setFtIn(false)}>
                  6.3 ft
                </button>
              </span>
              <small>{WHY[note.why]}</small>
            </div>
          ) : null}

          <div ref={printRef} className="pchk-print">
            <div className="dash-grid pchk-totals">
              <Total label="Pieces" check={check.pcs} whole />
              <Total label="CFT" check={check.cft} />
              <Total label="CBM" check={check.cbm} />
            </div>
            {check.perPieceTotal ? (
              <p className="pchk-warn">Their CFT total adds one piece per line instead of every piece. Ours counts every piece.</p>
            ) : null}
            {check.ftIn ? <p className="note pchk-note">Lengths read as feet and inches: 6.3 is 6 ft 3 in, so 6.25 ft.</p> : null}
            <p className="note no-print">Tap a width to open it. Tap a line or the supplier total to change it.</p>
            <div className="pchk-sheet-wrap">
              <table className="pchk-sheet">
                <thead>
                  <tr>
                    {items ? <th scope="col">Item</th> : null}
                    <th scope="col">
                      Length
                      <br />
                      (ft)
                    </th>
                    <th scope="col">
                      Width
                      <br />
                      (in)
                    </th>
                    <th scope="col">
                      Thick
                      <br />
                      (in)
                    </th>
                    <th scope="col">Pcs</th>
                    <th scope="col">CFT</th>
                    <th scope="col">CBM</th>
                  </tr>
                </thead>
                {check.groups.map((g) => {
                  const isOpen = folders.has(g.width);
                  const adding = !!editing && editing.at === null && editing.folder === g.width;
                  return (
                    <tbody key={g.width} className={"pchk-fold" + (isOpen ? " open" : "")}>
                      <tr className="pchk-fold-row" onClick={rowTap(() => toggle(g.width))}>
                        <th scope="rowgroup" colSpan={labelCols}>
                          <button type="button" className="pchk-fold-btn" aria-expanded={isOpen} onClick={() => toggle(g.width)}>
                            <span className="pchk-caret" aria-hidden="true">
                              ▸
                            </span>
                            Width {n3(g.width)}&quot;
                            <small>
                              {g.lines.length} {g.lines.length === 1 ? "line" : "lines"}
                            </small>
                          </button>
                        </th>
                        <td>{whole(g.pcs)}</td>
                        <td>{n3(g.cft)}</td>
                        <td>{n3(g.cbm)}</td>
                      </tr>
                      {g.lines.flatMap((x) => {
                        const on = !!editing && editing.at === x.at;
                        const row = (
                          <tr key={x.at} className={"pchk-line" + (on ? " editing" : "")} onClick={rowTap(() => startLine(x.at, g.width))}>
                            {items ? <td>{x.item}</td> : null}
                            <td>
                              <button
                                type="button"
                                className="pchk-cell-btn"
                                aria-label={"Change line " + n3(x.l) + " × " + n3(x.w) + " × " + n3(x.t) + ", " + whole(x.pcs) + " pcs"}
                                onClick={() => startLine(x.at, g.width)}
                              >
                                {n3(x.l)}
                              </button>
                            </td>
                            <td>{n3(x.w)}</td>
                            <td>{n3(x.t)}</td>
                            <td>{whole(x.pcs)}</td>
                            <td>{n3(x.cft)}</td>
                            <td>{n3(x.cbm)}</td>
                          </tr>
                        );
                        return on ? [row, lineForm("edit-" + x.at)] : [row];
                      })}
                      {adding ? lineForm("new") : null}
                      {isOpen && !adding ? (
                        <tr className="pchk-add no-print">
                          <td colSpan={cols}>
                            <button type="button" className="btn sm" onClick={() => startLine(null, g.width)}>
                              + Add line
                            </button>
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  );
                })}
                <tfoot>
                  <tr className="pchk-total">
                    <th scope="row" colSpan={labelCols}>
                      TOTAL
                    </th>
                    <td>{whole(check.pcs.ours)}</td>
                    <td>{n3(check.cft.ours)}</td>
                    <td>{n3(check.cbm.ours)}</td>
                  </tr>
                  <tr className="pchk-supplier" onClick={rowTap(startTotals)}>
                    <th scope="row" colSpan={labelCols}>
                      <button type="button" className="pchk-cell-btn" onClick={startTotals}>
                        Supplier total
                      </button>
                    </th>
                    <td>{check.pcs.theirs === null ? "" : whole(check.pcs.theirs)}</td>
                    <td>{check.cft.theirs === null ? "" : n3(check.cft.theirs)}</td>
                    <td>{check.cbm.theirs === null ? "" : n3(check.cbm.theirs)}</td>
                  </tr>
                  {totalsForm()}
                  <tr className="pchk-diff">
                    <th scope="row" colSpan={labelCols}>
                      Difference
                    </th>
                    <td className={okClass(check.pcs)}>{check.pcs.theirs === null ? "" : signed(check.pcs.diff, whole)}</td>
                    <td className={okClass(check.cft)}>{check.cft.theirs === null ? "" : signed(check.cft.diff, n3)}</td>
                    <td className={okClass(check.cbm)}>{check.cbm.theirs === null ? "" : signed(check.cbm.diff, n3)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      ) : null}

      {scan ? (
        <PaperScanner file={scan === "camera" ? undefined : scan} onPhoto={(f) => void fromPhoto(f)} onClose={() => setScan(null)} />
      ) : null}
    </div>
  );
}
