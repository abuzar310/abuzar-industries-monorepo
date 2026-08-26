/** Two-letter fallback when a carpenter has no photo yet. */
export function photoInitials(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  const first = Array.from(parts[0]);
  if (parts.length === 1) return (first[0] + (first[1] || "")).toUpperCase();
  const last = Array.from(parts[parts.length - 1]);
  return ((first[0] || "") + (last[0] || "")).toUpperCase();
}

/** Shrink a phone photo so it fits on the carpenter record (JSON PUT is ~1MB). */
export const PHOTO_MAX_CHARS = 80_000;
const MAX_SIDE = 360;

function drawToJpeg(img: CanvasImageSource, w: number, h: number, quality: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Cannot draw photo");
  ctx.fillStyle = "#efe9dd";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that photo"));
    };
    img.src = url;
  });
}

export async function compressPhoto(file: File): Promise<string> {
  if (file.type && !file.type.startsWith("image/")) throw new Error("Pick a photo");
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
  const h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
  let q = 0.74;
  let url = drawToJpeg(img, w, h, q);
  while (url.length > PHOTO_MAX_CHARS && q > 0.38) {
    q -= 0.08;
    url = drawToJpeg(img, w, h, q);
  }
  if (url.length > PHOTO_MAX_CHARS) throw new Error("Photo is still too large · try another shot");
  return url;
}
