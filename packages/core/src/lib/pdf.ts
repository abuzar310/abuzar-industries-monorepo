// Offline PDF export. Captures the printable sheet with html2canvas and slices it
// across A4 pages (jsPDF). The previous jsPDF.html() path produced blank pages;
// direct html2canvas + manual pagination renders exactly what you see/print.
// Loaded dynamically so it stays out of the server bundle.
import { toast } from "@/store/app-store";

/** Optional capture tuning. Without these, generatePdf behaves exactly as before
 *  (blind fixed-height A4 slicing) — so invoices/quotes and the report sheets are
 *  unchanged. Pass `pageBreak` to slice pages only BETWEEN whole cards/rows so the
 *  premium card UI never gets cut mid-card. */
export interface PdfOpts {
  /** CSS selector for the atomic blocks (cards, table rows) that must not be split across a page break. */
  pageBreak?: string;
  /** Force the capture width in px — pins responsive grids to their desktop columns.
   *  Card/dashboard captures are capped (~700px) so type stays readable on A4. */
  width?: number;
  /** A dated header prepended to the PDF (e.g. the report title / supplier name). */
  title?: string;
  /** Printable inset on each A4 page in mm (0 = edge-to-edge, default). Suppliers PDFs use ~8. */
  marginMm?: number;
}

/** Card/dashboard captures wider than this make body text too small on A4. */
const CARD_CAPTURE_MAX = 700;
/** Absorb trailing padding stubs smaller than this (canvas px) instead of emitting a blank page. */
const TRAILING_STUB_PX = 48;

export async function generatePdf(sheet: HTMLElement, fileBase: string, opts?: PdfOpts) {
  const pdf = await renderPdf(sheet, opts);
  pdf.save((fileBase || "document") + ".pdf");
}

/** Print — or, on Android / installed-app mode where the browser print dialog doesn't
 *  exist (window.print() is silently ignored), build the PDF and hand it to the system
 *  share sheet so the user can open, print, save, or send it. A plain download is the
 *  fallback. Always gives visible feedback — rendering takes a few seconds, so a
 *  "Preparing…" toast shows immediately. Returns which path ran. */
export async function printOrSavePdf(
  el: HTMLElement | null,
  fileBase: string,
): Promise<"print" | "pdf" | "shared" | "cancelled"> {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  // ONLY phones/tablets take the PDF path. Desktop — Windows/Mac/Linux, browser tab
  // OR installed app — always gets the real system print dialog (printer select),
  // which works fine there; the share sheet on a Windows laptop was wrong.
  const isMobile = !!nav && /Android|iPhone|iPad|iPod/i.test(nav.userAgent);

  if (!(isMobile && el)) {
    window.print();
    return "print";
  }

  toast("Preparing PDF…");
  const file = await generatePdfFile(el, fileBase);

  // Android share sheet — the reliable path: open in a PDF viewer, print, save, or send
  if (nav?.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: file.name });
      return "shared";
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return "cancelled";
      // any other share failure → fall through to the download
    }
  }

  // fallback: direct download (anchor must be in the DOM for some Android browsers)
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return "pdf";
}

/** The document as a shareable File — used to attach the PDF straight into WhatsApp
 *  via the system share sheet (navigator.share), instead of download-then-attach. */
export async function generatePdfFile(sheet: HTMLElement, fileBase: string, opts?: PdfOpts): Promise<File> {
  const pdf = await renderPdf(sheet, opts);
  const blob = pdf.output("blob");
  return new File([blob], (fileBase || "document") + ".pdf", { type: "application/pdf" });
}

async function renderPdf(sheet: HTMLElement, opts?: PdfOpts) {
  const [{ jsPDF }, h2c] = await Promise.all([import("jspdf"), import("html2canvas")]);
  const html2canvas = h2c.default;

  // Clone the sheet and make it match the PRINT output exactly: strip every element the print CSS
  // hides (all editing chrome), reveal the print-only bits, and freeze inputs/selects to plain text.
  const clone = sheet.cloneNode(true) as HTMLElement;
  // same set hidden by `@media print` in globals.css, plus the on-screen-only editing controls
  clone
    .querySelectorAll(
      ".no-print,.doctool,.add-row,.add-sec,.x-row,.x-sec,.ic-row,.sec-tools,.mode-seg,.mode-btn,.formula,.hint,.btn,.iconbtn,.sec-name-caret,.sec-name-menu",
    )
    .forEach((el) => el.remove());
  // "Hide prices" on quotations — drop rates, section totals, and the bill box from PDF too
  if (clone.classList.contains("hide-prices")) {
    clone.querySelectorAll(".print-money,.totals,.words,.pay-sheet").forEach((el) => el.remove());
  }
  // print-only elements (e.g. the solid Total-Price value) are display:none on screen — show them
  clone.querySelectorAll<HTMLElement>(".amt-print").forEach((el) => (el.style.display = "inline"));
  // drop the screen-only selection highlight classes so nothing is tinted in the PDF
  clone.querySelectorAll(".selrow").forEach((el) => el.classList.remove("selrow"));
  clone.querySelectorAll(".sel").forEach((el) => el.classList.remove("sel"));
  const freeze = (el: HTMLInputElement | HTMLSelectElement, text: string) => {
    const sp = document.createElement("span");
    sp.textContent = text;
    sp.style.cssText = "font:inherit;color:inherit;white-space:pre-wrap";
    el.parentNode?.replaceChild(sp, el);
  };
  clone.querySelectorAll("input").forEach((inp) => freeze(inp as HTMLInputElement, (inp as HTMLInputElement).value || ""));
  clone.querySelectorAll("select").forEach((sel) => {
    const s = sel as HTMLSelectElement;
    freeze(s, s.options[s.selectedIndex]?.text || "");
  });

  // Card/dashboard captures: keep width modest so body text lands ~10–12pt on A4.
  // Invoice/quote sheets (no pageBreak) keep the wider natural layout.
  let width = opts?.width || Math.max(sheet.scrollWidth, 880);
  if (opts?.pageBreak) width = Math.min(width, CARD_CAPTURE_MAX);

  clone.style.width = width + "px";
  clone.style.background = "#FAF6EF";
  // print-only nodes (.cd-print) are display:none on screen — the clone must lay out
  clone.style.display = "block";
  // Card UI (Suppliers Register/Payments, Books…): medium type — large enough after A4
  // downscale, not the oversized 18px bump. Also darken muted inks so labels on cream /
  // brown washes (KPI cards, table headers) stay readable in the JPEG capture.
  if (opts?.pageBreak) {
    clone.style.fontSize = "14px";
    clone.style.lineHeight = "1.4";
    clone.style.setProperty("--ink-faint", "#5c4e3c");
    clone.style.setProperty("--ink-soft", "#3f3428");
  }
  // Dated header so the PDF carries a title/branding (the on-screen topnav is never captured).
  // Hex colours only — html2canvas does not reliably resolve CSS variables.
  if (opts?.title) {
    const brand = document.createElement("div");
    brand.style.cssText = "padding:0 0 12px;margin:0 0 14px;border-bottom:2px solid #e2d6c2";
    const bt = document.createElement("div");
    bt.textContent = opts.title;
    bt.style.cssText =
      "font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:600;color:#2a2118;letter-spacing:-.015em";
    const bs = document.createElement("div");
    bs.textContent =
      "as of " + new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    bs.style.cssText =
      "font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:#5c4e3c;margin-top:4px";
    brand.appendChild(bt);
    brand.appendChild(bs);
    clone.insertBefore(brand, clone.firstChild);
  }
  // off-screen but fully laid out so html2canvas can measure & render it
  const holder = document.createElement("div");
  holder.style.cssText = "position:fixed;left:-10000px;top:0;width:" + width + "px;background:#FAF6EF";
  holder.appendChild(clone);
  document.body.appendChild(holder);
  // invoice: if it runs over one A4 page, compress the boxes (same as print) so it stays one page
  if (clone.classList.contains("inv")) {
    const a4h = (width * 297) / 210;
    if (clone.scrollHeight > a4h + 4) clone.classList.add("inv-tight");
  }
  // quote: lock to one A4 with the .a4fill layout — rows stay compact (see #sheet.sq.a4fill).
  // Use ~272mm worth of height (not full 297) so float rounding + QR/footer never tip a
  // one-page capture into a blank second PDF page.
  if (clone.classList.contains("sq")) {
    const a4h = (width * 272) / 210;
    if (clone.scrollHeight <= a4h + 4) {
      clone.classList.add("a4fill");
      clone.style.height = a4h + "px";
    }
  }

  try {
    const canvas = await html2canvas(clone, {
      scale: 2,
      backgroundColor: "#FAF6EF",
      useCORS: true,
      logging: false,
      windowWidth: width,
    });
    // Slightly higher quality on card PDFs so muted labels on brown washes stay sharp.
    const img = canvas.toDataURL("image/jpeg", opts?.pageBreak ? 0.96 : 0.92);
    const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
    const pageW = 210;
    const pageH = 297;
    // Optional printable inset (Suppliers PDFs). Default 0 keeps invoices/quotes edge-to-edge.
    const margin = Math.max(0, Math.min(40, opts?.marginMm ?? 0));
    const contentW = pageW - 2 * margin;
    const contentH = pageH - 2 * margin;
    const imgH = (canvas.height * contentW) / canvas.width; // full image height in mm

    // Short captures (one supplier card, a thin books tab) — one page, no trailing blank.
    if (imgH <= contentH + 0.8) {
      pdf.addImage(img, "JPEG", margin, margin, contentW, imgH);
      return pdf;
    }

    // Card-aware pagination: slice ONLY between whole cards/rows so nothing is cut
    // mid-card. html2canvas ignores CSS break-inside, so we compute the safe cut
    // lines ourselves from the laid-out clone. Falls back to blind slicing when no
    // page-break selector is given (invoices, quotes, the report sheets).
    // Usable page height accounts for margin so cards don’t get clipped by the inset.
    const pagePx = canvas.width * (contentH / contentW); // one content area in canvas pixels
    let cuts: number[] = [];
    if (opts?.pageBreak) {
      const cr = clone.getBoundingClientRect();
      const ratio = cr.height > 0 ? canvas.height / cr.height : 1;
      cuts = Array.from(clone.querySelectorAll(opts.pageBreak))
        .map((u) => (u.getBoundingClientRect().bottom - cr.top) * ratio)
        .filter((y) => y > 0.5 && y < canvas.height - 0.5)
        .sort((a, b) => a - b);
    }

    if (cuts.length) {
      // variable-fill pages, each ending on a card/row boundary
      const pageCanvas = document.createElement("canvas");
      const pctx = pageCanvas.getContext("2d")!;
      let start = 0;
      let first = true;
      let guard = 0;
      while (start < canvas.height - 0.5 && guard++ < 500) {
        const limit = start + pagePx;
        let cut = 0;
        for (const y of cuts) if (y > start + 1 && y <= limit) cut = y;
        // Content still fits on this page → take everything (avoids empty page 2).
        if (canvas.height <= limit + 0.5) {
          cut = canvas.height;
        } else if (cut <= start) {
          cut = Math.min(canvas.height, limit); // a single block taller than a page
        } else if (canvas.height - cut < TRAILING_STUB_PX) {
          // leftover is just padding under the last card — absorb it
          cut = canvas.height;
        }
        const sliceH = Math.max(1, Math.round(cut - start));
        // Skip near-empty trailing slices (blank page guard)
        if (sliceH < TRAILING_STUB_PX && start > 0) break;
        pageCanvas.width = canvas.width;
        pageCanvas.height = sliceH;
        pctx.fillStyle = "#FAF6EF";
        pctx.fillRect(0, 0, canvas.width, sliceH);
        pctx.drawImage(canvas, 0, Math.round(start), canvas.width, sliceH, 0, 0, canvas.width, sliceH);
        const pageImg = pageCanvas.toDataURL("image/jpeg", 0.92);
        const hmm = (sliceH * contentW) / canvas.width;
        if (!first) pdf.addPage();
        pdf.addImage(pageImg, "JPEG", margin, margin, contentW, hmm);
        start = cut;
        first = false;
      }
    } else {
      // Place the single tall image once per page, shifting it up by one content area each time.
      // Ignore a trailing stub (< ~2mm) — that was producing an empty page 2 on quotes/PDFs.
      const STUB_MM = 2;
      let heightLeft = imgH;
      let position = margin;
      pdf.addImage(img, "JPEG", margin, position, contentW, imgH);
      heightLeft -= contentH;
      while (heightLeft > STUB_MM) {
        position -= contentH;
        pdf.addPage();
        pdf.addImage(img, "JPEG", margin, position, contentW, imgH);
        heightLeft -= contentH;
      }
    }
    return pdf;
  } finally {
    if (holder.parentNode) holder.parentNode.removeChild(holder);
  }
}
