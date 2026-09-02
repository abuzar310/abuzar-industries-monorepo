import assert from "node:assert/strict";
import { asOfLabel, letterheadFooter, splitPdfTitle, wrapLine } from "./pdf-letterhead.ts";

assert.deepEqual(splitPdfTitle("Cut Size — VINAY & RAJANNA CONTRACTORES"), {
  eyebrow: "Cut Size",
  heading: "VINAY & RAJANNA CONTRACTORES",
});
assert.deepEqual(splitPdfTitle("Statement"), { eyebrow: "", heading: "Statement" });
assert.deepEqual(splitPdfTitle(""), { eyebrow: "", heading: "" });

assert.match(asOfLabel(new Date("2026-09-02T12:00:00+05:30")), /^as of 02 Sep/);

assert.deepEqual(letterheadFooter({ name: "Cut Size", phone: "", addr: "" }, 1, 1), {
  left: "Cut Size",
  right: "Page 1 of 1",
});
assert.deepEqual(
  letterheadFooter(
    { name: "Abuzar Industries", phone: "9845378626", addr: "KSSIDC Industrial Area" },
    2,
    3,
  ),
  { left: "KSSIDC Industrial Area  ·  9845378626", right: "Page 2 of 3" },
);

assert.deepEqual(wrapLine((s) => s.length, "VINAY & RAJANNA CONTRACTORES", 12), [
  "VINAY &",
  "RAJANNA",
  "CONTRACTORES",
]);

console.log("pdf-letterhead.check: 7 assertions ok");
