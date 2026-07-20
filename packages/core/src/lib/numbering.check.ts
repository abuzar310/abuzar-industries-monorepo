// Self-check for collision-proof numbering. Run: npx tsx packages/core/src/lib/numbering.check.ts
import assert from "node:assert/strict";
import { nextSeq } from "./numbering.ts";

const P = "2026-27-";

// fresh device
assert.equal(nextSeq([], 0, P), 1);

// normal: counter tracks the ids
assert.equal(nextSeq([P + "001", P + "002"], 2, P), 3);

// THE jagadish BUG: the counter fell behind (7) while ids already go up to 014.
// It must NOT hand out 008 (which would overwrite the existing 008) — it jumps past the real max.
assert.equal(nextSeq([P + "001", P + "002", P + "008", P + "013", P + "014"], 7, P), 15);

// never lands on a taken id, even if the max-based candidate is somehow already present
assert.equal(nextSeq([P + "015"], 14, P), 16);

// other financial-years' ids are ignored by the prefix
assert.equal(nextSeq(["2025-26-050", P + "003"], 0, P), 4);

console.log("numbering.check: all assertions passed ✓");
