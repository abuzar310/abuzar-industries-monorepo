// Offline PDF export. Captures the printable sheet with html2canvas and slices it
// across A4 pages (jsPDF). The previous jsPDF.html() path produced blank pages;
// direct html2canvas + manual pagination renders exactly what you see/print.
// Loaded dynamically so it stays out of the server bundle.

export async function generatePdf(sheet: HTMLElement, fileBase: string) {
  const [{ jsPDF }, h2c] = await Promise.all([import("jspdf"), import("html2canvas")]);
  const html2canvas = h2c.default;

  // Clone the sheet, strip editing chrome, freeze inputs/selects to plain text.
  const clone = sheet.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".x-row,.x-sec,.add-row,.add-sec,.btn,.iconbtn").forEach((el) => el.remove());
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

  const width = Math.max(sheet.scrollWidth, 880);
  clone.style.width = width + "px";
  clone.style.background = "#FAF6EF";
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
  // quote: grow the row heights to fill a single A4 when the content is short
  if (clone.classList.contains("sq")) {
    const a4h = (width * 297) / 210;
    let pad = 0;
    while (pad < 22 && clone.scrollHeight < a4h - 4) {
      pad += 1;
      clone.style.setProperty("--rowpad", pad + "px");
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
    const img = canvas.toDataURL("image/jpeg", 0.92);
    const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
    const pageW = 210;
    const pageH = 297;
    const imgH = (canvas.height * pageW) / canvas.width; // full image height in mm

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
    pdf.save((fileBase || "document") + ".pdf");
  } finally {
    if (holder.parentNode) holder.parentNode.removeChild(holder);
  }
}
