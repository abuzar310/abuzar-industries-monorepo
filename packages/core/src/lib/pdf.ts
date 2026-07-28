// Offline PDF export. Captures the printable sheet with html2canvas and slices it
// across A4 pages (jsPDF). The previous jsPDF.html() path produced blank pages;
// direct html2canvas + manual pagination renders exactly what you see/print.
// Loaded dynamically so it stays out of the server bundle.
import { toast } from "@/store/app-store";

export async function generatePdf(sheet: HTMLElement, fileBase: string) {
  const pdf = await renderPdf(sheet);
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
export async function generatePdfFile(sheet: HTMLElement, fileBase: string): Promise<File> {
  const pdf = await renderPdf(sheet);
  const blob = pdf.output("blob");
  return new File([blob], (fileBase || "document") + ".pdf", { type: "application/pdf" });
}

async function renderPdf(sheet: HTMLElement) {
  const [{ jsPDF }, h2c] = await Promise.all([import("jspdf"), import("html2canvas")]);
  const html2canvas = h2c.default;

  // Clone the sheet and make it match the PRINT output exactly: strip every element the print CSS
  // hides (all editing chrome), reveal the print-only bits, and freeze inputs/selects to plain text.
  const clone = sheet.cloneNode(true) as HTMLElement;
  // Strip ALL editor chrome — the tab bar, toolbar, buttons, inputs, selectors.
  // The clone is of #sheet, but in freeform mode the parent might capture extra content.
  clone
    .querySelectorAll(
      ".no-print,.doctool,.add-row,.add-sec,.x-row,.x-sec,.ic-row,.sec-tools,.mode-seg,.mode-btn,.mode-btn,.formula,.hint,.btn,.iconbtn,.editor-tabs-wrap,.editor-tabbar,.editor-tab,.editor-tab-new,.editor-tab-close,.editor-pane,.view",
    )
    .forEach((el) => el.remove());

  // Freeform mode (.free): the canvas has an on-screen CSS scale transform to fit the editor.
  // html2canvas does NOT trigger @media print, so the transform stays in the clone and
  // positions/shapes come out wrong. Remove it here: force the canvas to render at 1:1
  // (748×1077px = A4 printable area at 96dpi) so the absolute box positions map exactly.
  const isFree = clone.classList.contains("free");
  if (isFree) {
    const cvs = clone.querySelector<HTMLElement>(".qcanvas");
    if (cvs) {
      cvs.style.transform = "scale(1)";
      cvs.style.width = "748px";
      cvs.style.height = "1077px";
      cvs.style.transformOrigin = "0 0";
    }
    // The wrap has an inline height set to PAGE_H * scale — clamp it to fixed A4.
    const wrap = clone.querySelector<HTMLElement>(".qcanvas-wrap");
    if (wrap) {
      wrap.style.height = "1077px";
      wrap.style.overflow = "hidden";
    }
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

  // Determine capture width.
  // Freeform mode (.free): fixed A4 canvas (748×1077px) — we already set it above.
  // Auto-layout: use the sheet's natural scroll width (min 880px).
  let width: number;
  if (isFree) {
    width = 748;
  } else {
    width = Math.max(sheet.scrollWidth, 880);
  }
  clone.style.width = width + "px";
  clone.style.background = "#FAF6EF";
  // print-only nodes (.cd-print) are display:none on screen — the clone must lay out
  clone.style.display = "block";

  // Check for sub-pages (Kitchen, Bedroom, etc. — each a separate sheet in print)
  const subPages = Array.from(clone.querySelectorAll<HTMLElement>(".sub-page"));
  const hasSubPages = subPages.length > 1;
  // Extract everything before #sections as the header for each sub-page
  const sectionsEl = clone.querySelector<HTMLElement>("#sections");
  let headerHtml = "";
  if (sectionsEl) {
    let prev = sectionsEl.previousElementSibling;
    const parts: string[] = [];
    while (prev) {
      parts.unshift(prev.outerHTML);
      prev = prev.previousElementSibling;
    }
    headerHtml = parts.join("");
  }

  // off-screen but fully laid out so html2canvas can measure & render it
  const holder = document.createElement("div");
  holder.style.cssText = "position:fixed;left:-10000px;top:0;width:" + width + "px;background:#FAF6EF";
  document.body.appendChild(holder);

  try {
    const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
    const pageW = 210;
    const pageH = 297;

    if (hasSubPages) {
      // Render each sub-page individually with the masthead prepended
      for (let i = 0; i < subPages.length; i++) {
        const pageHtml = subPages[i].outerHTML;
        const wrap = document.createElement("div");
        wrap.id = "sheet";
        wrap.className = "sq";
        wrap.style.cssText = `width:${width}px;background:#FAF6EF;font-family:inherit`;
        wrap.innerHTML = headerHtml + pageHtml;

        // Stack each sub-page's sections in two columns
        const secs = wrap.querySelector<HTMLElement>(".sub-page-sections");
        if (secs) {
          secs.style.display = "grid";
          secs.style.gridTemplateColumns = "1fr 1fr";
          secs.style.gap = "10px";
        }

        // Lock height to fit one A4 page
        const a4h = (width * 297) / 210;
        wrap.style.height = a4h + "px";
        wrap.style.overflow = "hidden";

        holder.innerHTML = "";
        holder.appendChild(wrap);

        const canvas = await html2canvas(wrap, {
          scale: 2,
          backgroundColor: "#FAF6EF",
          useCORS: true,
          logging: false,
          windowWidth: width,
        });

        const img = canvas.toDataURL("image/jpeg", 0.92);
        const imgH = (canvas.height * pageW) / canvas.width;

        if (i > 0) pdf.addPage();
        pdf.addImage(img, "JPEG", 0, 0, pageW, Math.min(imgH, pageH));
      }
    } else {
      // No sub-pages: existing single-image capture + slice
      holder.appendChild(clone);

      // invoice: if it runs over one A4 page, compress the boxes
      if (clone.classList.contains("inv")) {
        const a4h = (width * 297) / 210;
        if (clone.scrollHeight > a4h + 4) clone.classList.add("inv-tight");
      }
      // quote: lock to one A4
      if (clone.classList.contains("sq")) {
        const a4h = (width * 297) / 210;
        if (clone.scrollHeight <= a4h + 4) {
          clone.classList.add("a4fill");
          clone.style.height = a4h + "px";
        }
      }

      const canvas = await html2canvas(clone, {
        scale: 2,
        backgroundColor: "#FAF6EF",
        useCORS: true,
        logging: false,
        windowWidth: width,
      });
      const img = canvas.toDataURL("image/jpeg", 0.92);
      const imgH = (canvas.height * pageW) / canvas.width;

      // Place the single tall image once per page, shifting it up by one page each time.
      let heightLeft = imgH;
      let position = 0;
      pdf.addImage(img, "JPEG", 0, position, pageW, imgH);
      heightLeft -= pageH;
      while (heightLeft > 0.5) {
        position -= pageH;
        pdf.addPage();
        pdf.addImage(img, "JPEG", 0, position, pageW, imgH);
        heightLeft -= pageH;
      }
    }

    return pdf;
  } finally {
    if (holder.parentNode) holder.parentNode.removeChild(holder);
  }
}
