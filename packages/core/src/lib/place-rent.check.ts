// Run: npx tsx packages/core/src/lib/place-rent.check.ts
import type { Carpenter, Doc, Expense } from "./types";
import { inDaybook, isPlaceRentSetoff } from "./expenses";
import {
  belongsToTenant,
  isSeedStub,
  matchPlaceRentTenant,
  monthCharged,
  monthKey,
  nameHitsSeed,
  phonesMatch,
  pickPlaceRentForSeed,
  placeRentDue,
  placeRentStatement,
  rentOpeningOf,
} from "./place-rent";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

const carp = (id: string, name: string, phone = ""): Carpenter =>
  ({ id, name, phone, placeRent: true, createdAt: "" }) as Carpenter;

const exp = (partial: Partial<Expense> & Pick<Expense, "id" | "amount" | "placeRentKind">): Expense =>
  ({
    date: "01-08-26",
    type:
      partial.placeRentKind === "charge" ||
      partial.placeRentKind === "opening" ||
      partial.placeRentKind === "received"
        ? "sale"
        : "custom",
    label: partial.placeRentKind === "setoff" ? "Carpenter commission" : "Place rent",
    mode: partial.placeRentKind === "received" ? "cash" : "",
    charge: partial.placeRentKind === "charge" || partial.placeRentKind === "opening",
    note: "",
    enteredBy: "afsar",
    createdAt: "2026-08-01",
    updatedAt: "2026-08-01",
    ...partial,
  }) as Expense;

ok(nameHitsSeed("SURESHA", "Suresha"), "SURESHA hits Suresha");
ok(nameHitsSeed("Suresha achari", "Suresha"), "suresha achari hits seed");
ok(!nameHitsSeed("IRFAN CARP", "Ismail"), "unrelated name does not hit");
ok(phonesMatch("9845012345", "09845012345"), "phone last-10 match");
ok(!phonesMatch("123", "456"), "short phones do not match");

const ismail = carp("CARP-1", "Ismail", "9845011111");
ok(belongsToTenant(exp({ id: "a", amount: 8000, placeRentKind: "charge", carpenterId: "CARP-1" }), ismail), "id links tenant");
ok(belongsToTenant(exp({ id: "b", amount: 8000, placeRentKind: "charge", carpenter: "Ismail" }), ismail), "name links tenant");

const ledger = [
  exp({ id: "c1", amount: 8000, placeRentKind: "charge", carpenterId: "CARP-1" }),
  exp({ id: "r1", amount: 3000, placeRentKind: "received", carpenterId: "CARP-1" }),
  exp({ id: "s1", amount: 2000, placeRentKind: "setoff", carpenterId: "CARP-1", carpenter: "Ismail" }),
];
ok(placeRentDue(ismail, ledger) === 3000, "due = charged − received − setoff");
ok(monthCharged(ismail, ledger, "15-08-26"), "August charge counts for the month");
ok(!monthCharged(ismail, ledger, "01-09-26"), "September not charged");
ok(monthKey("15-08-26") === "08-26", "month key");

const stmt = placeRentStatement(ismail, ledger);
ok(stmt.length === 3 && stmt[2].bal === 3000, "statement ends at due");

const setoff = ledger[2];
ok(isPlaceRentSetoff(setoff), "setoff helper");
ok(!inDaybook(setoff), "setoff is not till cash");
ok(inDaybook(ledger[1]), "cash received is till money");
ok(!inDaybook(ledger[0]), "charge is not till money");
ok(
  inDaybook({
    id: "cc1",
    date: "01-08-26",
    type: "custom",
    amount: 2000,
    label: "Carpenter commission",
    carpenter: "Ismail",
    refQuoteId: "Q1",
    mode: "cash",
    note: "Commission (cash)",
    enteredBy: "afsar",
    createdAt: "2026-08-01",
    updatedAt: "2026-08-01",
  } as Expense),
  "cash commission is till money",
);

const doc = {
  site: "Ismail",
  sitePhone: "9845011111",
  commLock: { amount: 5000, carpenter: "Ismail", lockedBy: "afsar", lockedAt: "" },
} as Doc;
ok(matchPlaceRentTenant(doc, [ismail, carp("CARP-2", "Suresha")])?.id === "CARP-1", "quote name/phone finds tenant");
ok(!matchPlaceRentTenant({ site: "Ravi", sitePhone: "" } as Doc, [ismail]), "other carpenter is hidden");

const debt = exp({ id: "o1", amount: 12000, placeRentKind: "opening", carpenterId: "CARP-1", date: "15-08-26" });
ok(placeRentDue(ismail, [debt]) === 12000, "old debt is rent due");
ok(!monthCharged(ismail, [debt], "15-08-26"), "old debt does not mark the month charged");
ok(!inDaybook(debt), "old debt is not till money");
ok(placeRentStatement(ismail, [debt])[0].label === "Old balance", "statement names old balance");

const stub = carp("CARP-STUB", "Suresha");
const real = carp("CARP-REAL", "SURESHA CARPENTER PLYNING WORK", "9880919422");
ok(isSeedStub(stub, "Suresha"), "empty Suresha is a stub");
ok(!isSeedStub(real, "Suresha"), "plyning-work Suresha is not a stub");
ok(pickPlaceRentForSeed([stub, real], "Suresha")?.id === "CARP-REAL", "picks plyning-work Suresha over empty stub");

const profiled = { ...ismail, rentOpening: 5000 };
ok(rentOpeningOf(profiled, [debt]) === 5000, "saved profile opening wins over recorded old debt");
ok(placeRentDue(profiled, [debt]) === 5000, "due uses profile opening, not the old one-time row");

const ismailLive = carp("CARP-IS", "ISMAIL Planning Work", "9591152679");
const ismailRows = [
  exp({ id: "i1", amount: 100000, placeRentKind: "opening", carpenterId: "CARP-IS" }),
  exp({ id: "i2", amount: 82612, placeRentKind: "opening", carpenterId: "CARP-IS" }),
];
ok(rentOpeningOf(ismailLive, ismailRows) === 182612, "Ismail two old-debt rows sum to 182612");
ok(placeRentDue(ismailLive, ismailRows) === 182612, "due is 182612 until a profile figure is saved");
ok(rentOpeningOf({ ...ismailLive, rentOpening: 90000 }, ismailRows) === 90000, "typed old balance replaces 182612");
ok(placeRentDue({ ...ismailLive, rentOpening: 90000 }, ismailRows) === 90000, "due follows the typed figure, not the old rows");
ok(rentOpeningOf({ ...ismailLive, rentOpening: 0 }, ismailRows) === 0, "zero old balance is a saved figure, not a missing one");
ok(placeRentDue({ ...ismailLive, rentOpening: 0 }, ismailRows) === 0, "due is settled when old balance is saved as 0");

const afterSave = { ...ismailLive, rentOpening: 182000 };
const leftoverPlusNew = [
  ...ismailRows,
  exp({ id: "i3", amount: 182000, placeRentKind: "opening", carpenterId: "CARP-IS" }),
];
ok(rentOpeningOf(afterSave, leftoverPlusNew) === 182000, "saved 182000 wins even if the old 182612 rows are still there");
ok(placeRentDue(afterSave, leftoverPlusNew) === 182000, "due does not add leftover old-debt on top of the saved figure");
ok(placeRentStatement(afterSave, leftoverPlusNew).filter((r) => r.kind === "opening").length === 1, "history shows one old-balance line, not every leftover row");
ok(placeRentStatement(afterSave, leftoverPlusNew)[0].signed === 182000, "history old-balance line is the saved figure");

console.log("place-rent.check: " + n + " ok");
