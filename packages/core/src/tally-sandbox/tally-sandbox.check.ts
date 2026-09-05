// Isolated Tally-sandbox money math. Run: node --no-warnings packages/core/src/tally-sandbox/tally-sandbox.check.ts
import {
  addLedger,
  addVoucher,
  balanceSheet,
  fromCloudBooks,
  isErr,
  ledgerBalance,
  mapGroup,
  profitAndLoss,
  seedState,
  toIsoDate,
  trialBalance,
} from "./tally-sandbox.ts";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

const s = seedState();
ok(s.vouchers.length === 3, "seed has 3 vouchers");
ok(ledgerBalance(s, "party") === 0, "customer settled after receipt");
ok(ledgerBalance(s, "cash") === 111800, "cash 100000 + 11800 receipt");
ok(ledgerBalance(s, "sales") === -10000, "sales credit 10000");
ok(ledgerBalance(s, "purch") === 5000, "purchases debit 5000");
ok(ledgerBalance(s, "supplier") === -5900, "supplier credit 5900");

const tb = trialBalance(s);
ok(tb.balanced, `trial balance ${tb.totalDr} vs ${tb.totalCr}`);
ok(tb.totalDr === 367700, "TB totals 3,67,700");

const pnl = profitAndLoss(s);
ok(pnl.totalIncome === 10000 && pnl.totalExpense === 5000, "P&L 10000 − 5000");
ok(pnl.profit === 5000, "current-year profit 5000");

const bs = balanceSheet(s);
ok(bs.balanced, `balance sheet ${bs.totalAssets} vs ${bs.totalLiab}`);
ok(bs.totalAssets === 362700, "BS totals 3,62,700");

const bad = addVoucher(s, {
  type: "Journal",
  date: "2026-09-05",
  narration: "unbalanced",
  legs: [
    { ledgerId: "cash", dr: 100, cr: 0 },
    { ledgerId: "capital", dr: 0, cr: 40 },
  ],
});
ok(isErr(bad) && /Out of balance/.test(bad.error), "rejects unbalanced voucher");

const dup = addLedger(s, { name: "Cash", group: "Cash-in-Hand", opening: 0 });
ok(isErr(dup), "rejects duplicate ledger name");

const okv = addVoucher(s, {
  type: "Contra",
  date: "2026-09-05",
  narration: "cash to bank",
  legs: [
    { ledgerId: "bank", dr: 2000, cr: 0 },
    { ledgerId: "cash", dr: 0, cr: 2000 },
  ],
});
ok(!isErr(okv) && ledgerBalance(okv, "cash") === 109800, "contra posts");
ok(!isErr(okv) && trialBalance(okv).balanced, "TB still balances after contra");

ok(toIsoDate("11-07-26") === "2026-07-11", "dd-mm-yy → ISO");
ok(mapGroup("Cash-in-hand") === "Cash-in-Hand", "alias Cash-in-hand");
const snap = fromCloudBooks(
  [{ id: "L-1", name: "Cash", group: "Cash-in-hand", opening: 10 }],
  [{ id: "V-1", no: 3, type: "Receipt", date: "11-07-26", legs: [{ ledgerId: "L-1", dr: 10, cr: 0 }, { ledgerId: "L-1", dr: 0, cr: 10 }], narration: "x" }],
);
ok(snap.source === "july" && snap.ledgers[0].group === "Cash-in-Hand" && snap.nextNo.Receipt === 4, "july snapshot maps");

if (typeof process !== "undefined" && process.argv?.[1]?.includes("tally-sandbox.check")) {
  console.log("tally-sandbox.check: " + n + " assertions passed ✓");
}
