"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { todayStr } from "@/lib/calc";
import { pdfDataUrl, preparePaperPhoto, readPurchaseSource, type PaperSource } from "@/lib/paper-client";
import { generatePdf } from "@/lib/pdf";
import {
  buildCheck,
  guessNotation,
  tallySheet,
  type Notation,
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

const WHY: Record<Notation["why"], string> = {
  cft: "Checked against the CFT printed on their list.",
  total: "Checked against their total CFT.",
  pattern: "Their lengths end in .3, .6 and .9.",
  none: "Pick how their lengths are written.",
};

const n3 = (v: number) => (Math.round(v * 1000) / 1000).toLocaleString("en-IN", { maximumFractionDigits: 3 });
const whole = (v: number) => Math.round(v).toLocaleString("en-IN");
const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "list";
const tagOf = (name: string) => (/\.pdf$/i.test(name) ? "PDF" : /\.(xlsx|xlsm|xls|csv)$/i.test(name) ? "XLS" : "IMG");

function Total({ label, check, whole: isWhole }: { label: string; check: TotalCheck; whole?: boolean }) {
  const fmt = isWhole ? whole : n3;
  return (
    <div className="stat">
      <div className="k">{label}</div>
      <div className="v">{fmt(check.ours)}</div>
      <div className={"sub" + (check.ok === true ? " pc-ok" : check.ok === false ? " pc-off" : "")}>
        {check.theirs === null
          ? "no supplier total"
          : check.ok
            ? "✓ supplier " + fmt(check.theirs)
            : "✗ supplier " + fmt(check.theirs) + " (" + (check.diff > 0 ? "+" : "") + fmt(check.diff) + ")"}
      </div>
    </div>
  );
}

/** A supplier's list in our L / W / T / Pcs, with our totals against theirs. Nothing is saved; the PDF and Excel are the record. */
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

  function show(got: PurchaseRead, from: string) {
    setRead(got);
    setFtIn(guessNotation(got).ftIn);
    setName(got.title || from.replace(/\.[^.]+$/, ""));
    setFile(from);
    setError("");
    setRetry(null);
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

  const check = read ? buildCheck({ ...read, title: name }, ftIn) : null;
  const note = read ? guessNotation(read) : null;
  const fractional = !!read && read.lines.some((x) => /\.\d/.test(x.l));
  const items = !!check && check.lines.some((x) => x.item);
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
        pageBreak: ".pc-row,.pc-group-head,.pc-totals,.pc-warn,.pc-note",
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
      <div className="rowbtns pc-open">
        <button type="button" className="btn primary" onClick={() => fileRef.current?.click()}>
          Open supplier file
        </button>
        <button type="button" className="btn" onClick={() => setScan("camera")}>
          Scan list
        </button>
      </div>
      <p className="note">Excel, CSV, PDF or a photo. Nothing is saved: download the PDF or Excel to keep it.</p>
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
          <div className="pc-head">
            <label className="pc-name">
              <span>Name on the PDF and Excel</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Container or supplier" />
            </label>
            <span className="pc-acts">
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
            <div className="pc-notation">
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

          <div ref={printRef} className="pc-print">
            <div className="dash-grid pc-totals">
              <Total label="Pieces" check={check.pcs} whole />
              <Total label="CFT" check={check.cft} />
              <Total label="CBM" check={check.cbm} />
            </div>
            {check.perPieceTotal ? (
              <p className="pc-warn">Their CFT total adds one piece per line instead of every piece. Ours counts every piece.</p>
            ) : null}
            {check.ftIn ? <p className="note pc-note">Lengths read as feet and inches: 6.3 is 6 ft 3 in, so 6.25 ft.</p> : null}
            {check.groups.map((g) => (
              <div className="pc-group" key={g.width}>
                <div className="pc-group-head">
                  Width {n3(g.width)}&quot;{" "}
                  <span>
                    · {g.lines.length} {g.lines.length === 1 ? "line" : "lines"} · {whole(g.pcs)} pcs · {n3(g.cft)} CFT · {n3(g.cbm)} CBM
                  </span>
                </div>
                <div className="pc-table-wrap">
                  <table className="pc-table">
                    <thead>
                      <tr>
                        {items ? <th>Item</th> : null}
                        <th>L (ft)</th>
                        <th>W (in)</th>
                        <th>T (in)</th>
                        <th>Pcs</th>
                        <th>CFT</th>
                        <th>CBM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.lines.map((x, i) => (
                        <tr className="pc-row" key={i}>
                          {items ? <td>{x.item}</td> : null}
                          <td>{n3(x.l)}</td>
                          <td>{n3(x.w)}</td>
                          <td>{n3(x.t)}</td>
                          <td>{whole(x.pcs)}</td>
                          <td>{n3(x.cft)}</td>
                          <td>{n3(x.cbm)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {scan ? (
        <PaperScanner file={scan === "camera" ? undefined : scan} onPhoto={(f) => void fromPhoto(f)} onClose={() => setScan(null)} />
      ) : null}
    </div>
  );
}
