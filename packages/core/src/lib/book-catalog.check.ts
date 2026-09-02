import { bookLabel, spendLocked, splitCustomIncome } from "./book-catalog";
import { spendCatKey, spendCategoryOf } from "./expenses";
import type { Expense } from "./types";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

const e = (partial: Partial<Expense>): Expense =>
  ({
    id: "e",
    date: "01-08-26",
    type: "custom",
    label: "Truck rent",
    mode: "",
    amount: 10,
    note: "",
    enteredBy: "ajju",
    createdAt: "",
    updatedAt: "",
    ...partial,
  }) as Expense;

ok(spendLocked("carpenter") && spendLocked("food") && spendLocked("other"), "core names stay");
ok(!spendLocked("truck"), "truck can be removed");
ok(bookLabel("inc.cash") === "Cash received", "default income name");
ok(bookLabel("bal.cash") === "Cash in hand", "default cash-in-hand name");
ok(spendCatKey(e({ label: "Truck rent" })) === "truck", "old truck rent name still maps");
ok(spendCatKey(e({ label: "Transport" })) === "transport", "pocket transport maps to Transport");
ok(spendCategoryOf(e({ label: "Truck rent" })) === "Heavy truck", "truck rent shows as heavy truck");
ok(spendCatKey(e({ type: "food", label: "" })) === "food", "food is type not label");
ok(spendCategoryOf(e({ label: "Pigmy" })) === "Pignee", "old Pigmy name still maps");
const split = splitCustomIncome(
  [
    { label: "", amount: 100, mode: "cash" },
    { label: "Scrap", amount: 40, mode: "cash" },
    { label: "", amount: 50, mode: "upi", toOwner: true },
  ],
  [{ id: "inc-1", label: "Scrap" }],
);
ok(split.cash === 100 && split.extra[0]?.amount === 40 && split.total === 190, "custom income not double-counted");

console.log("book-catalog.check OK (" + n + " assertions)");
