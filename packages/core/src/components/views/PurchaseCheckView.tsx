"use client";
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import {
  addFolder,
  deleteSheet,
  folderRows,
  loadFolders,
  loadSheets,
  newSheet,
  removeFolder,
  renameFolder,
  saveFolders,
  saveSheet,
  sheetTotals,
  sheetsIn,
  sortSheets,
  type PurchaseFolder,
  type PurchaseSheet,
} from "@/lib/purchase-sheets";
import { IMPORT_ACCEPT, importKind, readPurchaseSheetBytes } from "@/lib/sheet-import";
import { xlsxBytes } from "@/lib/xlsx-write";
import { bumpData, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import { useApp } from "@/store/useApp";
import { TabIcon } from "../Icons";
import PaperScanner from "../PaperScanner";
import PdfButtons from "../PdfButtons";

/** Sheets whose folder was deleted live here, so none of them ever disappears. */
const UNFILED = "unfiled";

/** A line being changed: an existing one by its place in their list, or a new one (at null) added under a width. */
type Editing = { at: number | null; width: number; draft: PurchaseRawLine };
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
const dayText = (iso: string) => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "";
};

/** A tap anywhere on a row does what its button does, without firing twice when the tap lands on the button. */
const rowTap = (act: () => void) => (e: ReactMouseEvent) => {
  if (!(e.target as Element).closest("button")) act();
};

function FolderList({ folders, sheets, onOpen, onNew }: {
  folders: PurchaseFolder[];
  sheets: PurchaseSheet[];
  onOpen: (id: string) => void;
  onNew: (name: string) => Promise<string>;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const rows = folderRows(folders, sheets);

  async function add() {
    const id = await onNew(name);
    if (!id) return;
    setName("");
    setAdding(false);
    onOpen(id);
  }

  return (
    <>
      <div className="rowbtns pchk-open">
        <button type="button" className="btn primary" onClick={() => setAdding(true)}>
          + New folder
        </button>
      </div>
      {adding ? (
        <form
          className="pchk-form"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <label>
            Folder name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="September lot" />
          </label>
          <span className="pchk-form-acts">
            <button type="submit" className="btn sm primary">
              Make folder
            </button>
            <button type="button" className="btn sm" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </span>
        </form>
      ) : null}
      {rows.length ? (
        <ul className="pchk-list">
          {rows.map(({ folder, count }) => (
            <li key={folder.id || UNFILED}>
              <button type="button" className="pchk-row" onClick={() => onOpen(folder.id || UNFILED)}>
                <span className="pchk-row-name">
                  <strong>{folder.name}</strong>
                  <em>
                    {count} {count === 1 ? "sheet" : "sheets"}
                  </em>
                </span>
                <span className="pchk-row-end">
                  <i className="pchk-chev" aria-hidden="true">
                    ›
                  </i>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pchk-empty">No folders yet. Make one, then open the supplier&apos;s file inside it.</p>
      )}
    </>
  );
}

function SheetList({ sheets, onOpen }: { sheets: PurchaseSheet[]; onOpen: (id: string) => void }) {
  if (!sheets.length) return <p className="pchk-empty">No sheets in this folder yet. Open a supplier file or scan a list.</p>;
  return (
    <ul className="pchk-list">
      {sheets.map((s) => {
        const t = sheetTotals(s);
        return (
          <li key={s.id}>
            <button type="button" className="pchk-row" onClick={() => onOpen(s.id)}>
              <span className="pchk-row-name">
                <strong>{s.name}</strong>
                <em>
                  {dayText(s.savedAt || s.createdAt)} · {whole(t.pcs)} pcs · {n3(t.cft)} CFT
                </em>
              </span>
              <span className="pchk-row-end">
                <span className={t.ok === true ? "pchk-ok" : t.ok === false ? "pchk-off" : ""}>
                  {t.ok === true ? "✓" : t.ok === false ? "✗" : ""}
                </span>
                <i className="pchk-chev" aria-hidden="true">
                  ›
                </i>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** One saved sheet: their list in our L / W / T / Pcs, every line on the page, every change saved. */
function SheetScreen({ sheet, onPatch, onDelete }: {
  sheet: PurchaseSheet;
  onPatch: (next: PurchaseSheet) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const printRef = useRef<HTMLDivElement>(null);
  const [nameDraft, setNameDraft] = useState(sheet.name);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [totalsDraft, setTotalsDraft] = useState<TotalsDraft | null>(null);
  const [editError, setEditError] = useState("");

  const read = sheet.read;
  const check = buildCheck({ ...read, title: nameDraft.trim() || sheet.name }, sheet.ftIn);
  const note = guessNotation(read);
  const fractional = read.lines.some((x) => /\.\d/.test(x.l));
  const items = check.lines.some((x) => x.item);
  const cols = items ? 7 : 6;
  const labelCols = cols - 3;
  const base = "purchase-check-" + slug(sheet.name || sheet.file);

  function stopEditing() {
    setEditing(null);
    setTotalsDraft(null);
    setEditError("");
  }

  function startLine(at: number | null, width: number) {
    stopEditing();
    setEditing({ at, width, draft: at === null ? { item: "", l: "", w: String(width), t: "", pcs: "", cft: "" } : { ...read.lines[at] } });
  }

  function setDraft(key: keyof PurchaseRawLine, value: string) {
    setEditing((e) => (e ? { ...e, draft: { ...e.draft, [key]: value } } : e));
  }

  /** Done needs a length, width, thickness and piece count. Their printed CFT stays with a line only while its sizes are unchanged. */
  function saveLine() {
    if (!editing) return;
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
    stopEditing();
    void onPatch({ ...sheet, read: { ...read, lines } });
  }

  function dropLine() {
    if (!editing || editing.at === null) return;
    const at = editing.at;
    stopEditing();
    void onPatch({ ...sheet, read: { ...read, lines: read.lines.filter((_, i) => i !== at) } });
  }

  function startTotals() {
    stopEditing();
    setTotalsDraft({ pcs: numText(read.totals.pcs), cft: numText(read.totals.cft), cbm: numText(read.totals.cbm) });
  }

  function saveTotals() {
    if (!totalsDraft) return;
    const totals = { pcs: purchaseNum(totalsDraft.pcs), cft: purchaseNum(totalsDraft.cft), cbm: purchaseNum(totalsDraft.cbm) };
    stopEditing();
    void onPatch({ ...sheet, read: { ...read, totals } });
  }

  function saveExcel() {
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
    if (!printRef.current) return;
    if (!preview) toast("Preparing PDF…");
    try {
      await generatePdf(printRef.current, base, {
        pageBreak: ".pchk-strip,.pchk-warn,.pchk-note,.pchk-sheet tr",
        width: 700,
        title: "Purchase check — " + (nameDraft.trim() || sheet.name),
        marginMm: 8,
        preview,
      });
      if (!preview) toast("PDF downloaded ✓");
    } catch {
      toast("Could not create the PDF");
    }
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
                <button type="button" className="btn sm warn" onClick={dropLine}>
                  Delete line
                </button>
              )}
            </span>
          </form>
          {sheet.ftIn ? <p className="pchk-hint">Type lengths the way their list writes them: 6.3 is 6 ft 3 in.</p> : null}
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

  const strip = (label: string, c: TotalCheck, fmt: (n: number) => string) => (
    <span>
      {label} <b>{fmt(c.ours)}</b>{" "}
      <span className={okClass(c)}>
        {c.theirs === null ? "" : c.ok ? "✓ " + fmt(c.theirs) : "✗ " + fmt(c.theirs) + " (" + signed(c.diff, fmt) + ")"}
      </span>
    </span>
  );

  return (
    <>
      <div className="pchk-head">
        <label className="pchk-name">
          <span>Name on the PDF and Excel</span>
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              const clean = nameDraft.trim();
              if (clean && clean !== sheet.name) void onPatch({ ...sheet, name: clean });
              else setNameDraft(sheet.name);
            }}
            placeholder="Container or supplier"
          />
        </label>
        <span className="pchk-acts">
          <PdfButtons onPreview={() => void savePdf(true)} onDownload={() => void savePdf(false)} />
          <button type="button" className="btn sm" onClick={saveExcel}>
            Excel
          </button>
          <button type="button" className="btn sm warn" onClick={() => void onDelete()}>
            Delete sheet
          </button>
        </span>
      </div>
      {fractional ? (
        <div className="pchk-notation">
          <span>In their list 6.3 means</span>
          <span className="rep-seg">
            <button type="button" className={sheet.ftIn ? "on" : ""} aria-pressed={sheet.ftIn} onClick={() => void onPatch({ ...sheet, ftIn: true })}>
              6 ft 3 in
            </button>
            <button type="button" className={sheet.ftIn ? "" : "on"} aria-pressed={!sheet.ftIn} onClick={() => void onPatch({ ...sheet, ftIn: false })}>
              6.3 ft
            </button>
          </span>
          <small>{WHY[note.why]}</small>
        </div>
      ) : null}

      <div ref={printRef} className="pchk-print">
        <div className="pchk-strip">
          {strip("Pieces", check.pcs, whole)}
          {strip("CFT", check.cft, n3)}
          {strip("CBM", check.cbm, n3)}
        </div>
        {check.perPieceTotal ? (
          <p className="pchk-warn">Their CFT total adds one piece per line instead of every piece. Ours counts every piece.</p>
        ) : null}
        {check.ftIn ? <p className="note pchk-note">Lengths read as feet and inches: 6.3 is 6 ft 3 in, so 6.25 ft.</p> : null}
        <p className="note no-print">Tap a line or the supplier total to change it.</p>
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
              const adding = !!editing && editing.at === null && editing.width === g.width;
              return (
                <tbody key={g.width}>
                  <tr className="pchk-group">
                    <th scope="rowgroup" colSpan={cols}>
                      Width {n3(g.width)}&quot; group
                      <small>
                        {g.lines.length} {g.lines.length === 1 ? "line" : "lines"}
                      </small>
                    </th>
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
                  {adding ? lineForm("new-" + g.width) : null}
                  <tr className="pchk-sub">
                    <th scope="row" colSpan={labelCols}>
                      Subtotal
                    </th>
                    <td>{whole(g.pcs)}</td>
                    <td>{n3(g.cft)}</td>
                    <td>{n3(g.cbm)}</td>
                  </tr>
                  {adding ? null : (
                    <tr className="pchk-add no-print">
                      <td colSpan={cols}>
                        <button type="button" className="btn sm" onClick={() => startLine(null, g.width)}>
                          + Add line
                        </button>
                      </td>
                    </tr>
                  )}
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
  );
}

/** Purchase check: supplier lists saved as our own sheets, kept in folders you name. */
export default function PurchaseCheckView() {
  const { ready, dataVersion, user } = useApp();
  const router = useRouter();
  const sp = useSearchParams();
  const folderId = sp.get("f") || "";
  const sheetId = sp.get("s") || "";
  const fileRef = useRef<HTMLInputElement>(null);
  const [folders, setFolders] = useState<PurchaseFolder[]>([]);
  const [sheets, setSheets] = useState<PurchaseSheet[]>([]);
  const [reading, setReading] = useState<{ file: string; startedAt: number } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState<{ source: PaperSource; file: string } | null>(null);
  const [scan, setScan] = useState<File | "camera" | null>(null);
  const [now, setNow] = useState(0);

  const load = useCallback(() => {
    void loadSheets().then((all) => {
      setFolders(loadFolders());
      setSheets(all);
    });
  }, []);

  useEffect(() => {
    if (user && user.role !== "owner") router.replace("/");
  }, [user, router]);

  useEffect(() => {
    if (ready && user?.role === "owner") load();
  }, [ready, dataVersion, load, user?.role]);

  useEffect(() => {
    if (!reading) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [reading]);

  const go = (q: string) => router.push("/buys/check" + q);
  const folder =
    folders.find((f) => f.id === folderId) || (folderId === UNFILED ? { id: UNFILED, name: "Unfiled", createdAt: "" } : null);
  const sheet = sheets.find((s) => s.id === sheetId) || null;
  const inFolder = folder
    ? folder.id === UNFILED
      ? sortSheets(sheets.filter((s) => !folders.some((f) => f.id === s.folderId)))
      : sheetsIn(sheets, folder.id)
    : [];

  /** A list is saved the moment it is read, in the folder that is open. */
  async function keep(got: PurchaseRead, from: string) {
    const where = folder && folder.id !== UNFILED ? folder.id : "";
    const saved = await saveSheet(newSheet(where, got, guessNotation(got).ftIn, "", from));
    setSheets((all) => [saved, ...all.filter((s) => s.id !== saved.id)]);
    bumpData();
    setError("");
    setRetry(null);
    go("?f=" + encodeURIComponent(folder ? folder.id : UNFILED) + "&s=" + encodeURIComponent(saved.id));
    toast("Saved in " + (folder ? folder.name : "Unfiled"));
  }

  async function patch(next: PurchaseSheet) {
    const saved = await saveSheet(next);
    setSheets((all) => all.map((s) => (s.id === saved.id ? saved : s)));
    bumpData();
  }

  async function dropSheet(s: PurchaseSheet) {
    const yes = await confirmDialog({
      title: "Delete “" + s.name + "”?",
      message: "It leaves the folder. Download its Excel first if you still need it.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!yes) return;
    await deleteSheet(s.id);
    setSheets((all) => all.filter((x) => x.id !== s.id));
    bumpData();
    go("?f=" + encodeURIComponent(folder ? folder.id : UNFILED));
    toast("Sheet deleted");
  }

  async function makeFolder(name: string): Promise<string> {
    const made = addFolder(folders, name);
    if ("error" in made) {
      setError(made.error);
      return "";
    }
    setFolders(made.list);
    setError("");
    await saveFolders(made.list);
    bumpData();
    return made.folder.id;
  }

  async function rename(id: string, name: string) {
    if (!name.trim() || name.trim() === folder?.name) return;
    const done = renameFolder(folders, id, name);
    if ("error" in done) {
      setError(done.error);
      return;
    }
    setFolders(done.list);
    setError("");
    await saveFolders(done.list);
    bumpData();
  }

  async function dropFolder(f: PurchaseFolder) {
    if (inFolder.length) {
      setError("Empty the folder first: open each sheet and delete it.");
      return;
    }
    const yes = await confirmDialog({ title: "Delete folder “" + f.name + "”?", confirmLabel: "Delete", danger: true });
    if (!yes) return;
    const list = removeFolder(folders, f.id);
    setFolders(list);
    await saveFolders(list);
    bumpData();
    go("");
    toast("Folder deleted");
  }

  async function ask(source: PaperSource, from: string) {
    setReading({ file: from, startedAt: Date.now() });
    setError("");
    setRetry(null);
    try {
      await keep(await readPurchaseSource(source), from);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that list. Tap Try again.");
      setRetry({ source, file: from });
    } finally {
      setReading(null);
    }
  }

  /** Excel or CSV with clear columns reads here at once; a PDF, a photo or an odd sheet goes to the reader. */
  async function openFile(picked: File) {
    setError("");
    setRetry(null);
    const kind = importKind(picked);
    try {
      if (kind === "image") setScan(picked);
      else if (kind === "pdf") await ask({ pdf: await pdfDataUrl(picked) }, picked.name);
      else if (kind === "sheet") {
        const got = await readPurchaseSheetBytes(picked.name, new Uint8Array(await picked.arrayBuffer()));
        if ("read" in got) await keep(got.read, picked.name);
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

  return (
    <div className="ph-kit">
      <button
        className="btn sm"
        style={{ marginBottom: 14 }}
        onClick={() => (sheet ? go("?f=" + encodeURIComponent(folder ? folder.id : UNFILED)) : folder ? go("") : router.push("/buys"))}
      >
        ← {sheet && folder ? folder.name : folder ? "Folders" : "Suppliers"}
      </button>
      <div className="sectitle">
        <span className="phone-ico ph-only">
          <TabIcon icon="scale" size={18} />
        </span>
        {sheet ? sheet.name : folder ? folder.name : "Purchase check"}{" "}
        <small>
          <span className="desk-only">— </span>
          {sheet ? "their list in your L / W / T / Pcs" : folder ? "sheets in this folder" : "supplier lists saved as your own sheets"}
        </small>
      </div>

      {folder && !sheet ? (
        <>
          <div className="rowbtns pchk-open">
            <button type="button" className="btn primary" onClick={() => fileRef.current?.click()}>
              Open supplier file
            </button>
            <button type="button" className="btn" onClick={() => setScan("camera")}>
              Scan list
            </button>
          </div>
          <p className="note">Excel, CSV, PDF or a photo. It is saved in this folder as soon as it is read.</p>
          <input
            ref={fileRef}
            type="file"
            accept={IMPORT_ACCEPT}
            hidden
            onChange={(e) => {
              const picked = e.target.files?.[0];
              e.target.value = "";
              if (picked) void openFile(picked);
            }}
          />
        </>
      ) : null}

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

      {!folder ? (
        <FolderList folders={folders} sheets={sheets} onOpen={(id) => go("?f=" + encodeURIComponent(id))} onNew={makeFolder} />
      ) : !sheet ? (
        <>
          <SheetList sheets={inFolder} onOpen={(id) => go("?f=" + encodeURIComponent(folder.id) + "&s=" + encodeURIComponent(id))} />
          {folder.id === UNFILED ? null : (
            <div className="pchk-head">
              <label className="pchk-name">
                <span>Folder name</span>
                <input
                  defaultValue={folder.name}
                  key={folder.id + folder.name}
                  onBlur={(e) => void rename(folder.id, e.target.value)}
                />
              </label>
              <span className="pchk-acts">
                <button type="button" className="btn sm warn" onClick={() => void dropFolder(folder)}>
                  Delete folder
                </button>
              </span>
            </div>
          )}
        </>
      ) : (
        <SheetScreen key={sheet.id} sheet={sheet} onPatch={patch} onDelete={() => dropSheet(sheet)} />
      )}

      {scan ? (
        <PaperScanner file={scan === "camera" ? undefined : scan} onPhoto={(f) => void fromPhoto(f)} onClose={() => setScan(null)} />
      ) : null}
    </div>
  );
}
