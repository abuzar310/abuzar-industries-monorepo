import assert from "node:assert/strict";
import { frameDetail, frameMotion, lumaFrame, scanStep, type ScanState } from "./paper-scan.ts";

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
