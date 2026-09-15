import assert from "node:assert/strict";
import {
  CROP_FULL,
  CROP_MIN,
  cropPixels,
  dragCrop,
  frameDetail,
  frameMotion,
  isFullCrop,
  lumaFrame,
  scanStep,
  type CropBox,
  type ScanState,
} from "./paper-scan.ts";

// crop: a corner drag resizes without crossing over, a move stays inside, pixels stay inside the photo
const near = (a: CropBox, b: CropBox) => (["x", "y", "w", "h"] as const).every((k) => Math.abs(a[k] - b[k]) < 1e-9);
assert.ok(near(dragCrop(CROP_FULL, "nw", 0.25, 0.1), { x: 0.25, y: 0.1, w: 0.75, h: 0.9 }));
assert.ok(near(dragCrop(CROP_FULL, "se", -2, -2), { x: 0, y: 0, w: CROP_MIN, h: CROP_MIN }));
assert.ok(near(dragCrop({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, "move", 0.9, -0.9), { x: 0.5, y: 0, w: 0.5, h: 0.5 }));
assert.ok(near(dragCrop({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, "ne", 0.1, 5), { x: 0.2, y: 0.58, w: 0.6, h: 0.12 }));
assert.ok(near(dragCrop({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, "sw", -1, -0.1), { x: 0, y: 0.2, w: 0.7, h: 0.4 }));
assert.deepEqual(cropPixels({ x: 0.25, y: 0.5, w: 0.5, h: 0.5 }, 1000, 800), { sx: 250, sy: 400, sw: 500, sh: 400 });
assert.deepEqual(cropPixels({ x: 0.999, y: 0.999, w: 0.5, h: 0.5 }, 100, 100), { sx: 99, sy: 99, sw: 1, sh: 1 });
assert.ok(isFullCrop(CROP_FULL) && !isFullCrop(dragCrop(CROP_FULL, "se", -0.1, 0)));

const px = (r: number, g: number, b: number) => lumaFrame([r, g, b, 255], 1, 1)[0];
assert.ok(Math.abs(px(255, 255, 255) - 255) < 1.5);
assert.equal(px(0, 0, 0), 0);

// a page of fine writing (stripes) has detail; a blank page has none
const W = 40;
const H = 30;
const blank = new Float32Array(W * H).fill(200);
const lines = new Float32Array(W * H);
for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) lines[r * W + c] = c % 4 < 2 ? 40 : 220;
assert.equal(frameDetail(blank, W, H).edges, 0);
assert.equal(frameDetail(blank, W, H).sharp, 0);
assert.ok(frameDetail(lines, W, H).edges > 0.5);
assert.ok(frameDetail(lines, W, H).sharp > 10);

// motion: the same frame is still, a shifted frame moved, a different size counts as moved
assert.equal(frameMotion(lines, lines), 0);
const shifted = new Float32Array(W * H);
for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) shifted[r * W + c] = lines[r * W + ((c + 2) % W)];
assert.ok(frameMotion(lines, shifted) > 5);
assert.equal(frameMotion(lines, new Float32Array(10)), 255);

// decisions, with numbers measured on the yard's list photos (sharp 18.7 to 19.7, edges 0.17 to 0.19)
const start: ScanState = { steady: 0, best: 0 };
assert.equal(scanStep(start, { motion: 1, sharp: 7, edges: 0 }).hint, "aim");
assert.equal(scanStep(start, { motion: 9, sharp: 19, edges: 0.18 }).hint, "hold");
assert.equal(scanStep(start, { motion: 2, sharp: 8, edges: 0.13 }).hint, "focus");

let st = start;
let capturedAt = 0;
for (let i = 1; i <= 6 && !capturedAt; i++) {
  const r = scanStep(st, { motion: 2.4, sharp: 19, edges: 0.18 });
  st = r.state;
  if (r.capture) capturedAt = i;
}
assert.equal(capturedAt, 4);

const sharpSeen = scanStep(start, { motion: 2, sharp: 30, edges: 0.18 }).state;
assert.equal(scanStep(sharpSeen, { motion: 2, sharp: 16, edges: 0.18 }).hint, "focus");

let s2 = scanStep(start, { motion: 2, sharp: 19, edges: 0.18 }).state;
s2 = scanStep(s2, { motion: 2, sharp: 19, edges: 0.18 }).state;
assert.equal(s2.steady, 2);
assert.equal(scanStep(s2, { motion: 8, sharp: 19, edges: 0.18 }).state.steady, 0);

console.log("paper-scan.check OK");
