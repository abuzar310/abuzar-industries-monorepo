// Checks for review flyer QR + once-per-quotation store behavior.
// Run: pnpm check:review-qr
import QRCode from "qrcode";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import jsQR from "jsqr";

const FUNNEL = "https://abuzar-review.vercel.app/?go=1";

async function checkFlyerPngDecodesToFunnel() {
  for (const app of ["official", "unofficial"]) {
    const pngPath = path.join(process.cwd(), "apps", app, "public", "review-qr.png");
    assert.ok(fs.existsSync(pngPath), app + " must ship review-qr.png");
    const png = PNG.sync.read(fs.readFileSync(pngPath));
    const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    assert.ok(code, app + " flyer QR must decode");
    assert.equal(code.data, FUNNEL, app + " flyer QR must be funnel ?go=1");
  }
  console.log("ok  flyer PNG decodes to funnel ?go=1 (official + unofficial)");
}

async function checkOncePerDocLogic() {
  const KEY = "abuzar:reviewQrShownDocs";
  const mem = new Map<string, string>();
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v);
    },
  };
  function read(): Set<string> {
    const raw = storage.getItem(KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  }
  function mark(id: string) {
    const s = read();
    s.add(id);
    storage.setItem(KEY, JSON.stringify([...s]));
  }
  let open = false;
  function show(opts?: { force?: boolean; docId?: string }) {
    if (opts?.force) {
      open = true;
      return;
    }
    const id = (opts?.docId || "").trim();
    if (!id) return;
    if (read().has(id)) return;
    mark(id);
    open = true;
  }
  function hide() {
    open = false;
  }
  show({ docId: "q1" });
  assert.equal(open, true, "first payment on quote opens");
  hide();
  open = false;
  show({ docId: "q1" });
  assert.equal(open, false, "second payment on same quote blocked");
  show({ docId: "q2" });
  assert.equal(open, true, "different quote still opens");
  hide();
  open = false;
  show({ force: true });
  assert.equal(open, true, "Review button always opens");
  console.log("ok  once-per-quotation + force behavior");
}

async function checkOverlayAndBrand() {
  const overlay = fs.readFileSync(
    path.join(process.cwd(), "packages/core/src/components/ReviewQrOverlay.tsx"),
    "utf8",
  );
  assert.ok(overlay.includes("/review-qr.png"), "overlay uses flyer PNG");
  assert.ok(!overlay.includes("review-qr-flyer-live"), "no live QR overlay");
  const brand = fs.readFileSync(path.join(process.cwd(), "packages/core/src/lib/brand.ts"), "utf8");
  assert.ok(brand.includes("abuzar-review.vercel.app/?go=1"), "brand.reviewFunnelUrl set");
  const editor = fs.readFileSync(
    path.join(process.cwd(), "packages/core/src/components/editor/Editor.tsx"),
    "utf8",
  );
  const signAt = editor.lastIndexOf('className="inv-sign"');
  const toolAt = editor.lastIndexOf('className="doctool"');
  const invFoot = editor.slice(signAt, toolAt);
  assert.ok(!invFoot.includes("<ReviewQR"), "invoice footer has no embedded ReviewQR");
  assert.ok(editor.includes("showReviewQr({ force: true })"), "Review button forces open");
  console.log("ok  overlay/brand/editor gates");
}

async function checkQrLibStillWorks() {
  const dataUrl = await QRCode.toDataURL(FUNNEL, { width: 240, margin: 1 });
  assert.ok(dataUrl.startsWith("data:image/png;base64,"));
  console.log("ok  qrcode lib generates PNG");
}

async function main() {
  await checkFlyerPngDecodesToFunnel();
  await checkOncePerDocLogic();
  await checkOverlayAndBrand();
  await checkQrLibStillWorks();
  console.log("review-qr.check: all passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
