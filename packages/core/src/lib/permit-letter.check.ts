import assert from "node:assert/strict";
import { permitBodyHtml, permitHeadHtml, esc } from "./permit-letter-html.ts";

assert.equal(esc("A <b> & C"), "A &lt;b&gt; &amp; C");

const head = permitHeadHtml();
assert.match(head, /Abuzar Industries/);
assert.doesNotMatch(head, /Cut Size/);
assert.match(head, /GSTIN 29AROPA1101B1ZK/);

const body = permitBodyHtml({
  customerName: "SANTHOSH L",
  cft: 27.72,
  pcs: 44,
  date: "25-08-26",
  fields: { leaf: "1412448", book: "28249", form: "29", oldDate: "29/06/25" },
});
assert.match(body, /The Range Forest Officer/);
assert.match(body, /Kindly issue the permit/);
assert.match(body, /SANTHOSH L/);
assert.match(body, /1412448/);
assert.match(body, /28249/);
assert.match(body, /form no\. <b>29<\/b>/);
assert.match(body, /dated <b>29\/06\/25<\/b>/);
assert.match(body, /Place- Chitradurga/);
assert.match(body, /Yours Faithfully/);
assert.doesNotMatch(body, /Cut Size/);

const xss = permitBodyHtml({
  customerName: "<img>",
  cft: 1,
  pcs: 1,
  date: "1",
  fields: { leaf: "<x>", book: "b", form: "f", oldDate: "d" },
});
assert.match(xss, /&lt;img&gt;/);
assert.match(xss, /&lt;x&gt;/);
assert.doesNotMatch(xss, /<img>/);

console.log("permit-letter.check: all assertions passed ✓");
