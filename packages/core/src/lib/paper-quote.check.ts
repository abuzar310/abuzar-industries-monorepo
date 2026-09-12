// Run: node --no-warnings packages/core/src/lib/paper-quote.check.ts
import assert from "node:assert/strict";
import {
  blankPaperLine,
  paperLineHasSize,
  paperQuoteSeed,
  parsePaperAiJson,
  parsePaperRead,
  sectionsFromPaperLines,
} from "./paper-quote.ts";

const fenced = parsePaperAiJson(`here
\`\`\`json
{"customerName":" Raju ","lines":[{"name":"Teak","l":12,"w":"6","t":1,"pcs":4,"rate":""}]}
\`\`\`
`);
assert.equal(fenced.customerName, "Raju");
assert.equal(fenced.lines.length, 1);
assert.equal(fenced.lines[0].l, "12");
assert.equal(fenced.lines[0].keep, true);

const junkSkipped = parsePaperRead({
  lines: [null, "x", { name: "", l: "", w: "", t: "", pcs: "", rate: "" }, { name: "Honne", l: "8", w: "4", t: "2", pcs: "1" }],
});
assert.equal(junkSkipped.lines.length, 1);
assert.equal(junkSkipped.lines[0].name, "Honne");

const keptOff = parsePaperRead({ lines: [{ name: "Teak", l: "10", w: "5", t: "1", pcs: "2", keep: false }] });
assert.equal(keptOff.lines[0].keep, false);

const grouped = sectionsFromPaperLines([
  { keep: true, name: "Teak", l: "12", w: "6", t: "1", pcs: "4", rate: "" },
  { keep: true, name: "teak", l: "10", w: "5", t: "2", pcs: "2", rate: "4200" },
  { keep: true, name: "Honne", l: "8", w: "4", t: "1", pcs: "1", rate: "" },
  { keep: false, name: "Teak", l: "9", w: "9", t: "1", pcs: "9", rate: "1" },
  { keep: true, name: "Skip", l: "", w: "", t: "", pcs: "", rate: "" },
]);
assert.equal(grouped.length, 2);
assert.equal(grouped[0].name, "Teak");
assert.equal(grouped[0].rate, "4200");
assert.equal(grouped[0].rows.length, 2);
assert.equal(grouped[1].name, "Honne");
assert.equal(grouped[1].rate, 4000);

const empty = sectionsFromPaperLines([]);
assert.equal(empty.length, 1);
assert.equal(empty[0].name, "Teak");
assert.equal(paperLineHasSize(blankPaperLine()), false);
assert.equal(paperLineHasSize({ ...blankPaperLine(), pcs: "2" }), true);

const seed = paperQuoteSeed({
  lines: [{ keep: true, name: "Teak", l: "12", w: "6", t: "1", pcs: "4", rate: "4000" }],
  customerName: "  Ismail  ",
  paperPhoto: "data:image/jpeg;base64,xx",
});
assert.equal(seed.customerName, "Ismail");
assert.equal(seed.status, "Draft");
assert.equal(seed.notes, "From paper");
assert.equal(seed.paperPhoto, "data:image/jpeg;base64,xx");
assert.equal(seed.sections?.[0].rows[0].l, "12");

assert.throws(() => parsePaperAiJson("no json here"), /not JSON/);

console.log("paper-quote.check OK (11 checks)");
