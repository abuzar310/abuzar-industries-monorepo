// Run: npx tsx packages/core/src/lib/dup-guard.check.ts
import { agoLabel, findRecentDuplicate } from "./dup-guard";
import type { Expense } from "./types";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

const T0 = Date.parse("2026-09-14T10:00:00.000Z");
const at = (secAgo: number) => new Date(T0 - secAgo * 1000).toISOString();
const E = (p: Partial<Expense>): Expense =>
  ({
    id: "e",
    date: "14-09-26",
    type: "sale",
    mode: "cash",
    amount: 0,
    enteredBy: "afsar",
    createdAt: at(0),
    updatedAt: at(0),
    ...p,
  }) as Expense;

const rows: Expense[] = [
  // the real pattern: ₹50,000 UPI on quote 037, second press 7 s later
  E({ id: "a1", amount: 50000, mode: "upi", sourceId: "Q37", createdAt: at(7) }),
  // one ₹50,000 cash handover split ₹30,000 on quote 095 + ₹20,000 on the account
  E({ id: "b1", amount: 30000, mode: "cash", sourceId: "Q95", rcptId: "R1", createdAt: at(100) }),
  E({ id: "b2", amount: 20000, mode: "cash", custId: "C1", rcptId: "R1", createdAt: at(100) }),
  // Ismail's rent ₹20,000 entered 96 s earlier by someone else
  E({ id: "c1", amount: 20000, mode: "cash", carpenterId: "CARP1", placeRentKind: "received", enteredBy: "ajju", createdAt: at(96) }),
  // money back from a name
  E({ id: "d1", amount: 5000, mode: "cash", party: "Ravi", createdAt: at(30) }),
  // an hour ago — outside the window
  E({ id: "old", amount: 50000, mode: "upi", sourceId: "Q37", createdAt: at(3600) }),
  // a due (charge) is not money in
  E({ id: "chg", amount: 50000, mode: "cash", custId: "C1", charge: true, createdAt: at(10) }),
  // a Cash → Owner row is still cash
  E({ id: "own", amount: 7000, mode: "cash", toOwner: true, sourceId: "Q99", createdAt: at(12) }),
  // an advance moved onto a quotation is a transfer, not cash handed over
  E({ id: "adv", amount: 10000, mode: "cash", sourceId: "Q40", custId: "C9", fromAdvanceId: "ADV1", createdAt: at(120) }),
  // the other phone's clock is 90 s ahead — its row sits "in the future"
  E({ id: "fut", amount: 20000, mode: "cash", carpenterId: "CARP3", placeRentKind: "received", enteredBy: "ajju", createdAt: at(-90) }),
];

const hit = findRecentDuplicate(rows, { amount: 50000, mode: "upi", sourceId: "Q37", now: T0 });
ok(hit?.expense.id === "a1" && hit.amount === 50000 && hit.agoMs === 7000, "same quote, same UPI amount, 7 s ago");
ok(!findRecentDuplicate(rows, { amount: 50000, mode: "cash", sourceId: "Q37", now: T0 }), "a different mode is not a duplicate");
ok(!findRecentDuplicate(rows, { amount: 50000, mode: "upi", sourceId: "Q37", now: T0, withinMs: 5000 }), "outside the window");
ok(!findRecentDuplicate(rows, { amount: 40000, mode: "upi", sourceId: "Q37", now: T0 }), "a different amount is not a duplicate");
ok(!findRecentDuplicate(rows, { amount: 50000, mode: "upi", sourceId: "Q38", now: T0 }), "another quotation is not a duplicate");

const split = findRecentDuplicate(rows, { amount: 50000, mode: "cash", custId: "C1", quoteIds: ["Q95"], now: T0 });
ok(split?.amount === 50000 && split.expense.rcptId === "R1", "a split receipt is compared as ONE handover");
ok(!findRecentDuplicate(rows, { amount: 30000, mode: "cash", custId: "C1", quoteIds: ["Q95"], now: T0 }), "one piece alone is not the handover");

ok(findRecentDuplicate(rows, { amount: 20000, mode: "cash", carpenterId: "CARP1", now: T0 })?.expense.id === "c1", "rent received for the same tenant");
ok(!findRecentDuplicate(rows, { amount: 20000, mode: "cash", carpenterId: "CARP2", now: T0 }), "another tenant is not a duplicate");
ok(findRecentDuplicate(rows, { amount: 5000, mode: "cash", party: " RAVI ", now: T0 })?.expense.id === "d1", "name receipt matches case/space-insensitively");
ok(!findRecentDuplicate(rows, { amount: 50000, mode: "cash", custId: "C1", now: T0, withinMs: 60_000 }), "a due (charge) never counts as money in");
ok(findRecentDuplicate(rows, { amount: 7000, mode: "cash", sourceId: "Q99", now: T0 })?.expense.id === "own", "Cash → Owner is still cash");
ok(!findRecentDuplicate(rows, { amount: 10000, mode: "cash", sourceId: "Q40", now: T0 }), "an applied advance is a transfer, not a handover");
ok(!findRecentDuplicate(rows, { amount: 10000, mode: "cash", custId: "C9", now: T0 }), "…and not on the account side either");
ok(findRecentDuplicate(rows, { amount: 20000, mode: "cash", carpenterId: "CARP3", now: T0 })?.expense.id === "fut", "a row from a phone whose clock is ahead still counts");
ok(!findRecentDuplicate(rows, { amount: 0, mode: "cash", sourceId: "Q37", now: T0 }), "zero amount asks nothing");
ok(!findRecentDuplicate([], { amount: 50000, mode: "upi", sourceId: "Q37", now: T0 }), "empty books");

ok(agoLabel(7000) === "7 seconds ago", "seconds label");
ok(agoLabel(1000) === "1 second ago", "one second");
ok(agoLabel(96_000) === "2 minutes ago", "minutes label");
ok(agoLabel(60_000) === "1 minute ago", "one minute");

console.log(`dup-guard.check OK (${n} assertions)`);
