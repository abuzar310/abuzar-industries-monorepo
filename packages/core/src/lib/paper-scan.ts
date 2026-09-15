/**
 * Auto-scan for Scan paper: decide from small camera frames when the list is steady and sharp enough to photograph.
 * Numbers come from the yard's own list photos measured at 192px wide.
 */
export const SCAN_W = 192;
export const SCAN_SAMPLE_MS = 250;
const MIN_EDGES = 0.04; // blank paper measured 0.000, handwritten lists 0.17 to 0.19
const MAX_STEADY_MOTION = 5; // sensor noise 2.4, a 1px shake 3.5, a 4px move 8
const MIN_SHARP = 10; // noise-only frames measured 7.1, heavy blur 7.3, the sharp lists 18.7 to 19.7
const SHARP_OF_BEST = 0.8; // wait for focus: at least 80% of the sharpest frame seen lately
const STEADY_SAMPLES = 4; // about one second of holding still

export type ScanSample = { motion: number; sharp: number; edges: number };
export type ScanState = { steady: number; best: number };
export type ScanHint = "aim" | "hold" | "focus" | "capture";

/** RGBA pixels to brightness (0 to 255). */
export function lumaFrame(rgba: ArrayLike<number>, w: number, h: number): Float32Array {
  const y = new Float32Array(w * h);
  for (let i = 0, p = 0; i < y.length; i++, p += 4) y[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) / 256;
  return y;
}

/** Sharpness (mean absolute Laplacian) and writing density (share of strong edges) in the middle 80% of the frame. */
export function frameDetail(y: ArrayLike<number>, w: number, h: number): { sharp: number; edges: number } {
  const x0 = Math.floor(w / 10);
  const x1 = w - Math.floor(w / 10);
  const y0 = Math.floor(h / 10);
  const y1 = h - Math.floor(h / 10);
  let lap = 0;
  let strong = 0;
  let n = 0;
  for (let r = y0 + 1; r < y1 - 1; r++) {
    for (let c = x0 + 1; c < x1 - 1; c++) {
      const i = r * w + c;
      lap += Math.abs(4 * y[i] - y[i - w] - y[i + w] - y[i - 1] - y[i + 1]);
      if (Math.abs(y[i + 1] - y[i - 1]) + Math.abs(y[i + w] - y[i - w]) > 40) strong++;
      n++;
    }
  }
  return n ? { sharp: lap / n, edges: strong / n } : { sharp: 0, edges: 0 };
}

/** Mean brightness change between two frames. A different frame size counts as a big move. */
export function frameMotion(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) return 255;
  if (!a.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/** One camera sample in, the next hint out. Captures after about a second of a steady, sharp list. */
export function scanStep(
  state: ScanState,
  s: ScanSample,
): { state: ScanState; hint: ScanHint; progress: number; capture: boolean } {
  const best = Math.max(s.sharp, state.best * 0.97);
  const reset = (hint: ScanHint) => ({ state: { steady: 0, best }, hint, progress: 0, capture: false });
  if (s.edges < MIN_EDGES) return reset("aim");
  if (s.motion > MAX_STEADY_MOTION) return reset("hold");
  if (s.sharp < MIN_SHARP || s.sharp < best * SHARP_OF_BEST) return reset("focus");
  const steady = state.steady + 1;
  if (steady >= STEADY_SAMPLES) return { state: { steady: 0, best }, hint: "capture", progress: 1, capture: true };
  return { state: { steady, best }, hint: "hold", progress: steady / STEADY_SAMPLES, capture: false };
}
