/**
 * Bake the review-funnel URL into apps/official|unofficial/public/review-qr.png
 * (source art may be mislabeled JPEG). Replaces the art's QR plate.
 *
 *   node scripts/bake-review-flyer-qr.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import jsQR from "jsqr";
import QRCode from "qrcode";
import sharp from "sharp";

const FUNNEL = "https://abuzar-review.vercel.app/?go=1";
const DARK = "#3d2418";
const LIGHT = "#f7f2e8";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcCandidates = [
  path.join(root, "apps/official/public/review-qr.png"),
  path.join(root, "apps/official/public/review-qr.jpg"),
];

const srcPath = srcCandidates.find((p) => fs.existsSync(p));
if (!srcPath) {
  console.error("No review-qr asset found");
  process.exit(1);
}

const rawBuf = fs.readFileSync(srcPath);
const isJpeg = rawBuf[0] === 0xff && rawBuf[1] === 0xd8;

let width;
let height;
let rgba;
if (isJpeg) {
  const decoded = jpeg.decode(rawBuf, { useTArray: true, maxMemoryUsageInMB: 256 });
  width = decoded.width;
  height = decoded.height;
  rgba = decoded.data;
} else {
  const { data, info } = await sharp(rawBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  width = info.width;
  height = info.height;
  rgba = data;
}

const code = jsQR(new Uint8ClampedArray(rgba), width, height);
if (!code?.location) {
  console.error("Could not locate existing QR in flyer art");
  process.exit(1);
}

const corners = [
  code.location.topLeftCorner,
  code.location.topRightCorner,
  code.location.bottomLeftCorner,
  code.location.bottomRightCorner,
];
const xs = corners.map((c) => c.x);
const ys = corners.map((c) => c.y);
const pad = Math.round(Math.min(width, height) * 0.012);
let left = Math.max(0, Math.floor(Math.min(...xs) - pad));
let top = Math.max(0, Math.floor(Math.min(...ys) - pad));
let right = Math.min(width, Math.ceil(Math.max(...xs) + pad));
let bottom = Math.min(height, Math.ceil(Math.max(...ys) + pad));
// keep square plate
const side = Math.max(right - left, bottom - top);
const cx = Math.round((left + right) / 2);
const cy = Math.round((top + bottom) / 2);
left = Math.max(0, Math.round(cx - side / 2));
top = Math.max(0, Math.round(cy - side / 2));
if (left + side > width) left = width - side;
if (top + side > height) top = height - side;

console.log("art", width + "x" + height, isJpeg ? "jpeg" : "png");
console.log("old QR:", code.data);
console.log("plate", { left, top, side });

const qrPng = await QRCode.toBuffer(FUNNEL, {
  type: "png",
  width: side * 2,
  margin: 1,
  color: { dark: DARK, light: LIGHT },
  errorCorrectionLevel: "M",
});

const qrFitted = await sharp(qrPng).resize(side, side, { kernel: "nearest" }).png().toBuffer();

const base = await sharp(rawBuf).ensureAlpha().png().toBuffer();
const out = await sharp(base)
  .composite([{ input: qrFitted, left, top }])
  .png()
  .toBuffer();

// verify
const checkRaw = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const verify = jsQR(
  new Uint8ClampedArray(checkRaw.data),
  checkRaw.info.width,
  checkRaw.info.height,
);
if (!verify || verify.data !== FUNNEL) {
  console.error("Verify failed. Decoded:", verify?.data);
  process.exit(1);
}
console.log("new QR:", verify.data);

for (const app of ["official", "unofficial"]) {
  const destPng = path.join(root, "apps", app, "public", "review-qr.png");
  const destJpg = path.join(root, "apps", app, "public", "review-qr.jpg");
  fs.writeFileSync(destPng, out);
  // keep jpg as real jpeg copy for any old references
  const jpg = await sharp(out).jpeg({ quality: 92 }).toBuffer();
  fs.writeFileSync(destJpg, jpg);
  console.log("wrote", destPng, out.length, "bytes");
}

console.log("done");
