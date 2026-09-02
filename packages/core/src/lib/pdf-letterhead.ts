/** A4 letterhead drawn onto each captured page so Preview and the file match. */

const PAGE_W = 794;
const PAGE_H = 1123;
const SCALE = 2;
/** ~24mm — statements were flushing the A4 edge at 56px. */
const M = 90;

export function splitPdfTitle(title: string): { eyebrow: string; heading: string } {
  const t = (title || "").trim();
  const i = t.indexOf(" — ");
  if (i > 0) return { eyebrow: t.slice(0, i).trim(), heading: t.slice(i + 3).trim() };
  return { eyebrow: "", heading: t };
}

export function asOfLabel(d = new Date()): string {
  return "as of " + d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function letterheadFooter(
  brand: { name?: string; phone?: string; addr?: string },
  page: number,
  of: number,
): { left: string; right: string } {
  const left =
    [brand.addr, brand.phone]
      .map((s) => (s || "").trim())
      .filter(Boolean)
      .join("  ·  ") || (brand.name || "").trim();
  return { left, right: "Page " + page + " of " + of };
}

export function wrapLine(measure: (s: string) => number, text: string, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let cur = words[0];
  for (let i = 1; i < words.length; i++) {
    const next = cur + " " + words[i];
    if (measure(next) <= maxW) cur = next;
    else {
      lines.push(cur);
      cur = words[i];
    }
  }
  lines.push(cur);
  return lines;
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("pdf page image failed"));
    im.src = src;
  });
}

export async function frameLetterheadPage(
  src: string,
  opts: { title: string; date: string; left: string; right: string },
): Promise<string> {
  const img = await loadImg(src);
  const c = document.createElement("canvas");
  c.width = PAGE_W * SCALE;
  c.height = PAGE_H * SCALE;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("pdf letterhead canvas failed");
  ctx.fillStyle = "#FAF6EF";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.scale(SCALE, SCALE);

  const { eyebrow, heading } = splitPdfTitle(opts.title);
  const maxW = PAGE_W - 2 * M;
  ctx.textBaseline = "top";

  ctx.fillStyle = "#5c4e3c";
  ctx.font = "600 11px ui-monospace, Menlo, Consolas, monospace";
  if (eyebrow) ctx.fillText(eyebrow.toUpperCase(), M, M);
  const dateW = ctx.measureText(opts.date).width;
  ctx.fillText(opts.date, PAGE_W - M - dateW, M);

  ctx.fillStyle = "#2a2118";
  ctx.font = "600 20px Georgia, 'Times New Roman', serif";
  const lines = wrapLine((s) => ctx.measureText(s).width, heading || eyebrow, maxW).slice(0, 2);
  let y = M + (eyebrow ? 22 : 6);
  for (const line of lines) {
    ctx.fillText(line, M, y);
    y += 24;
  }

  const ruleY = y + 14;
  ctx.strokeStyle = "#b8956a";
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(M, ruleY);
  ctx.lineTo(PAGE_W - M, ruleY);
  ctx.stroke();
  ctx.strokeStyle = "#2a2118";
  ctx.lineWidth = 0.55;
  ctx.beginPath();
  ctx.moveTo(M, ruleY + 3.5);
  ctx.lineTo(PAGE_W - M, ruleY + 3.5);
  ctx.stroke();

  const boxX = M;
  const boxY = ruleY + 22;
  const boxW = maxW;
  const boxH = PAGE_H - boxY - 56 - M;
  // ponytail: never upscale a 700px capture — that was the "zoomed / flush" look
  const sc = Math.min(boxW / img.width, boxH / img.height, 0.92);
  ctx.drawImage(img, boxX, boxY, img.width * sc, img.height * sc);

  const footY = PAGE_H - M;
  ctx.strokeStyle = "#d4c4a8";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(M, footY - 20);
  ctx.lineTo(PAGE_W - M, footY - 20);
  ctx.stroke();

  ctx.fillStyle = "#5c4e3c";
  ctx.font = "10px ui-monospace, Menlo, Consolas, monospace";
  ctx.textBaseline = "alphabetic";
  if (opts.left) {
    const left = wrapLine((s) => ctx.measureText(s).width, opts.left, maxW - 90)[0] || opts.left;
    ctx.fillText(left, M, footY);
  }
  const rw = ctx.measureText(opts.right).width;
  ctx.fillText(opts.right, PAGE_W - M - rw, footY);

  return c.toDataURL("image/jpeg", 0.94);
}
