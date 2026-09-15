// Run: node --no-warnings packages/core/src/lib/paper-quote.check.ts
import assert from "node:assert/strict";
import {
  blankPaperLine,
  expandCrossSize,
  normalizePaperDim,
  paperLineHasSize,
  paperQuoteSeed,
  parsePaperAiJson,
  parsePaperRead,
  sectionsFromPaperLines,
  applyPaperToDoc,
  mergePaperSections,
  readPaperSteps,
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

assert.equal(normalizePaperDim("1-5"), "1.5");
assert.equal(normalizePaperDim("1,5"), "1.5");
assert.deepEqual(expandCrossSize("8 × 5 × 3 × 4"), { l: "8", w: "5", t: "3", pcs: "4" });
assert.deepEqual(expandCrossSize("8x5x3x4"), { l: "8", w: "5", t: "3", pcs: "4" });

// IMG_2705-style: Teak heading + L×B×H×pcs
const p2705 = parsePaperRead({
  lines: [
    { name: "Teak" },
    { name: "Teak", l: "8", w: "5", t: "3", pcs: "4" },
    { size: "9 × 6 × 2 × 10" },
    { name: "L B H Pices" },
  ],
});
assert.equal(p2705.lines.length, 2);
assert.equal(p2705.lines[0].name, "Teak");
assert.equal(p2705.lines[0].pcs, "4");
assert.equal(p2705.lines[1].l, "9");
assert.equal(p2705.lines[1].pcs, "10");

// IMG_2704-style: L B H Pices columns, 1-5 decimals
const p2704 = parsePaperRead({
  lines: [
    { name: "L", l: "B", w: "H", t: "Pices" },
    { name: "Teak", l: "5", w: "2", t: "3", pcs: "10" },
    { name: "Teak", l: "8", w: "9", t: "2", pcs: "5" },
    { name: "Teak", l: "7", w: "6", t: "2", pcs: "2" },
    { name: "Teak", l: "2", w: "1-5", t: "1-5", pcs: "6" },
  ],
});
assert.equal(p2704.lines.length, 4);
assert.equal(p2704.lines[3].w, "1.5");
assert.equal(p2704.lines[3].t, "1.5");
assert.equal(p2704.lines[3].pcs, "6");

const mergedEmpty = mergePaperSections(
  [{ name: "Teak", rate: 4000, rows: [{ l: "", w: "", t: "", pcs: "" }] }],
  [{ name: "Teak", rate: 4000, rows: [{ l: "8", w: "5", t: "3", pcs: "4" }] }],
);
assert.equal(mergedEmpty.length, 1);
assert.equal(mergedEmpty[0].rows.length, 1);
assert.equal(mergedEmpty[0].rows[0].l, "8");

const mergedKeep = mergePaperSections(
  [{ name: "Teak", rate: 4100, rows: [{ l: "12", w: "6", t: "1", pcs: "2" }] }],
  [{ name: "Honne", rate: 4000, rows: [{ l: "9", w: "4", t: "2", pcs: "1" }] }],
);
assert.equal(mergedKeep.length, 2);
assert.equal(mergedKeep[0].rate, 4100);
assert.equal(mergedKeep[1].name, "Honne");

const onto = applyPaperToDoc(
  {
    id: "inv_keep",
    customerName: "Ismail",
    notes: "keep me",
    sections: [{ name: "Teak", rate: 4000, rows: [{ l: "", w: "", t: "", pcs: "" }] }],
  } as never,
  {
    lines: [{ keep: true, name: "Teak", l: "8", w: "5", t: "3", pcs: "4", rate: "" }],
    customerName: "Other",
    paperPhoto: "data:image/jpeg;base64,xx",
  },
);
assert.equal(onto.id, "inv_keep");
assert.equal(onto.customerName, "Ismail");
assert.equal(onto.notes, "keep me");
assert.equal(onto.sections[0].rows[0].pcs, "4");

// Reading loop: Google busy or out of quota moves on; a good answer stops; the time budget holds.
async function readStepsChecks() {
  const good8 = '{"lines":[{"name":"Teak","l":"8","w":"5","t":"3","pcs":"4"}]}';

  const calls: string[] = [];
  const moved = await readPaperSteps(
    [{ model: "a", key: "1" }, { model: "b", key: "2" }, { model: "a", key: "2" }],
    async (step) => {
      calls.push(step.model + step.key);
      return step.model === "a" ? { status: 503, message: "high demand" } : { status: 200, text: good8 };
    },
    { budgetMs: 50_000 },
  );
  assert.deepEqual(calls, ["a1", "b2"]);
  assert.ok("read" in moved && moved.read.lines.length === 1 && moved.step.model === "b");

  const busy = await readPaperSteps(
    [{ model: "a", key: "1" }, { model: "b", key: "1" }],
    async () => ({ status: 429, message: "You exceeded your current quota" }),
    { budgetMs: 50_000 },
  );
  assert.ok("error" in busy && busy.busy === true);

  const cut = await readPaperSteps(
    [{ model: "a", key: "1" }, { model: "b", key: "1" }],
    async (step) =>
      step.model === "a"
        ? { status: 200, text: '{"lines":[{"name":"Teak","l":"8"' }
        : { status: 200, text: '{"lines":[{"name":"Teak","l":"9","w":"6","t":"2","pcs":"10"}]}' },
    { budgetMs: 50_000 },
  );
  assert.ok("read" in cut && cut.read.lines[0].pcs === "10");

  let asked = 0;
  const none = await readPaperSteps(
    [{ model: "a", key: "1" }, { model: "b", key: "1" }],
    async () => {
      asked++;
      return { status: 200, text: '{"customerName":"","lines":[]}' };
    },
    { budgetMs: 50_000 },
  );
  assert.ok("error" in none && none.busy === false && /No sizes/.test(none.error));
  assert.equal(asked, 1);

  const badKey = await readPaperSteps(
    [{ model: "a", key: "bad" }, { model: "a", key: "good" }],
    async (step) => (step.key === "bad" ? { status: 403, message: "API key not valid" } : { status: 200, text: good8 }),
    { budgetMs: 50_000 },
  );
  assert.ok("read" in badKey);

  const allBad = await readPaperSteps(
    [{ model: "a", key: "x" }],
    async () => ({ status: 403, message: "API key not valid" }),
    { budgetMs: 50_000 },
  );
  assert.ok("error" in allBad && allBad.busy === false && /API key/.test(allBad.error));

  // each attempt eats 30s: attempt 1 at 0s, attempt 2 at 30s (20s left), attempt 3 would start past the budget
  let clock = 0;
  const slow = await readPaperSteps(
    [{ model: "a", key: "1" }, { model: "b", key: "1" }, { model: "c", key: "1" }],
    async () => {
      clock += 30_000;
      throw new Error("The operation was aborted due to timeout");
    },
    { budgetMs: 50_000, now: () => clock },
  );
  assert.ok("error" in slow && slow.busy === true);
  assert.equal(clock, 60_000);
}

readStepsChecks()
  .then(() => console.log("paper-quote.check OK"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
