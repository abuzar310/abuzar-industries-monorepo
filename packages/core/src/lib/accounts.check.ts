// Self-check for per-account payment rollup + daily collect.
// Run: npx tsx packages/core/src/lib/accounts.check.ts
import type { Doc, Expense } from "./types";
import {
  accountDayLedger,
  accountLedger,
  accountOverview,
  acctLedger,
  applyTransportDueCash,
  applyTransportDueOwnerUpi,
  extraReceiptsTransportSources,
  holderPassbookLines,
  holderPayBalance,
  isCsKumarPocketName,
  listTransportPaySources,
  patchTransportDue,
  pickTransportPaySource,
  receiptsTransportPaySources,
  selectedTransportDueTotal,
  settleFoldIndexes,
  settleFoldChildren,
  isAccountTransportPay,
  isPendingTransport,
  isTransportPocket,
  isTransportPocketName,
  passbookRunning,
  stmtFromTransport,
  transportDueLabel,
  transportNeedToCollect,
  dueOnTransportPocket,
  type AccountCollection,
  type AcctBalance,
  type AcctStmtLine,
  type PayHolder,
} from "./accounts";
import { inBooks, inDaybook, spendCatKey, spendDetailOf } from "./expenses";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

const Q = (id: string, cust: string, no: string): Doc =>
  ({ id, number: no, status: "Created", customerId: cust, customerName: cust, phone: "" } as unknown as Doc);

export function demo() {
  const quotes = [Q("q1", "Ramesh", "SF-1")];
  const expenses = [
    { id: "u1", type: "sale", sourceId: "q1", amount: 5000, mode: "upi", account: "Tabrez", date: "06-07-26", createdAt: "u1", enteredBy: "ajju" },
    { id: "u2", type: "sale", sourceId: "q1", amount: 3000, mode: "upi", account: "Current A", date: "06-07-26", createdAt: "u2", enteredBy: "ajju" },
    { id: "c1", type: "sale", custId: "c1", amount: 2000, mode: "cash", account: "Tabrez", date: "06-07-26", createdAt: "c1", enteredBy: "ajju" },
    { id: "d1", type: "sale", custId: "c1", amount: 1000, mode: "cash", date: "06-07-26", createdAt: "d1", enteredBy: "ajju" },
    { id: "old", type: "sale", custId: "c1", amount: 500, mode: "cash", account: "Tabrez", date: "05-07-26", createdAt: "old", enteredBy: "ajju" },
  ] as unknown as Expense[];

  const day = accountDayLedger(expenses, "06-07-26", quotes);
  ok(day.accounts.length === 2, "two accounts on 06-07-26");
  const tabrez = day.accounts.find((a) => a.name === "Tabrez")!;
  ok(tabrez.pending === 7000 && tabrez.total === 7000, "Tabrez pending = UPI + cash on that day");
  ok(day.pendingTotal === 10000, "day pending = Tabrez 7000 + Current A 3000");

  (expenses[0] as Expense).collectedAt = "2026-07-06T10:00:00Z";
  const after = accountDayLedger(expenses, "06-07-26", quotes);
  ok(after.accounts.find((a) => a.name === "Tabrez")!.pending === 2000, "after UPI collected, Tabrez cash still pending");
  ok(after.collectedTotal === 5000, "5000 marked collected");

  const ov = accountOverview(expenses);
  ok(ov.pendingTotal === 5500, "overall pending = 3000+2000 on 06-07 + 500 on 05-07");
  ok(ov.dates.length === 2, "two dates in navigator");
  ok(ov.byAccount.find((a) => a.name === "Tabrez")!.pending === 2500, "Tabrez overall pending");

  const { accounts, grandTotal } = accountLedger(expenses, quotes);
  ok(accounts.length === 2 && grandTotal === 10500, "lifetime total incl. older day");

  // Passbook: collect sits in the same stream; later UPI continues from the reduced balance.
  const sub: AcctBalance = {
    name: "TABREZ GT TRADER",
    received: 276200,
    ownerReceived: 0,
    collected: 0,
    spent: 0,
    balance: 276200,
    lines: [
      { id: "u-naik", kind: "in", amount: 6000, date: "19-08-26", at: "2026-08-19T10:00:00.000Z", by: "ajju", customer: "Naik" },
      { id: "u-manju", kind: "in", amount: 50000, date: "19-08-26", at: "2026-08-19T13:21:00.000Z", by: "ajju", customer: "MANJUNATH" },
    ],
  };
  const cols: AccountCollection[] = [
    {
      id: "COL-gafoor",
      account: "TABREZ",
      holderId: "h1",
      amount: 100000,
      date: "19-08-26",
      by: "ajju",
      note: "Cash From Gafoor",
      createdAt: "2026-08-19T11:21:00.000Z",
      updatedAt: "2026-08-19T11:21:00.000Z",
    },
    {
      id: "COL-tabrez",
      account: "TABREZ",
      holderId: "h1",
      amount: 150000,
      date: "20-08-26",
      by: "ajju",
      note: "from Tabrez",
      createdAt: "2026-08-20T06:36:00.000Z",
      updatedAt: "2026-08-20T06:36:00.000Z",
    },
  ];
  const book = holderPassbookLines([sub], cols);
  ok(book.length === 4, "UPI + holder collects share one passbook");
  ok(book.filter((l: AcctStmtLine) => l.kind === "collect").length === 2, "two collect lines in the same book");
  const run = passbookRunning(book, 220200); // already 2,20,200 before the 6k Naik line
  ok(run.after[0].id === "u-naik" && run.after[0].balance === 226200, "Naik 6k → 2,26,200");
  ok(run.after[1].id === "COL-gafoor" && run.after[1].balance === 126200, "same-day collect 1,00,000 drops the book to 1,26,200");
  ok(run.after[2].id === "u-manju" && run.after[2].balance === 176200, "Manjunath 50k continues from the new balance → 1,76,200");
  ok(run.after[3].id === "COL-tabrez" && run.after[3].balance === 26200, "next-day collect 1,50,000 → 26,200");
  ok(run.closing === 26200, "closing follows the last collect, not the old 2,76,200");

  // Pay transport from a UPI pocket: balance drops, Collected stays a hand-over, Books gets Transport, till does not.
  const pocket = {
    id: "tr1",
    type: "custom",
    label: "Transport",
    mode: "",
    amount: 2500,
    account: "CS Kumar",
    party: "Raju lorry",
    pocketSpend: "transport",
    date: "21-08-26",
    createdAt: "2026-08-21T09:00:00.000Z",
    enteredBy: "ajju",
  } as unknown as Expense;
  const due = { ...pocket, account: "", holderId: undefined } as unknown as Expense;
  ok(isPendingTransport(due) && !isAccountTransportPay(due), "due is locked, not paid");
  ok(!inBooks(due) && !inDaybook(due), "due stays off Books and the till until paid");
  ok(isAccountTransportPay(pocket), "flagged UPI-pocket transport");
  ok(!isPendingTransport(pocket), "paid row is not still due");
  ok(!inDaybook(pocket), "transport from a UPI pocket stays out of the cash till");
  ok(inBooks(pocket), "transport from a UPI pocket lands in Books");
  ok(spendCatKey(pocket) === "transport", "Books bucket is Transport");

  const tillTransport = { ...pocket, pocketSpend: undefined, account: "" } as unknown as Expense;
  ok(!isAccountTransportPay(tillTransport), "Daybook Transport without the pocket flag is not a pocket pay");
  ok(inDaybook(tillTransport), "ordinary Transport spend still hits the till");

  const led = acctLedger(
    [
      {
        id: "u-cs",
        type: "sale",
        mode: "upi",
        amount: 10000,
        account: "CS Kumar",
        date: "20-08-26",
        createdAt: "2026-08-20T10:00:00.000Z",
        enteredBy: "ajju",
      } as unknown as Expense,
      pocket,
    ],
    [],
  );
  const cs = led.accounts.find((a) => a.name === "CS Kumar")!;
  ok(cs.received === 10000 && cs.collected === 0 && cs.spent === 2500, "transport is spent, not collected");
  ok(cs.balance === 7500, "pocket balance drops by the lorry pay");
  ok(cs.lines.some((l) => l.kind === "transport" && l.customer === "Raju lorry"), "passbook names the transporter");

  const holderPay = { ...pocket, id: "tr-h", holderId: "h-cs", account: "CS Kumar" } as unknown as Expense;
  const holderLed = acctLedger(
    [
      {
        id: "u-cs2",
        type: "sale",
        mode: "upi",
        amount: 10000,
        account: "CS Kumar",
        date: "20-08-26",
        createdAt: "2026-08-20T10:00:00.000Z",
        enteredBy: "ajju",
      } as unknown as Expense,
      holderPay,
    ],
    [],
  );
  ok(holderLed.accounts.find((a) => a.name === "CS Kumar")!.spent === 0, "holder-level transport is not a sub-account debit");
  const hBook = holderPassbookLines(holderLed.accounts, [], [holderPay]);
  ok(hBook.some((l) => l.kind === "transport"), "holder passbook includes holder-level transport");
  const hRun = passbookRunning(hBook, 0);
  ok(hRun.closing === 7500, "holder running balance drops after transport");
  ok(stmtFromTransport(pocket).kind === "transport", "transport statement line");
  const detailed = { ...pocket, vehicleNo: "KA01AB1234", placeOfSupply: "Dhannaram" } as unknown as Expense;
  ok(transportDueLabel(detailed) === "Raju lorry · KA01AB1234 · Dhannaram", "due label has vehicle and place");
  ok((stmtFromTransport(detailed).note || "").includes("KA01AB1234"), "passbook note has vehicle");
  ok(spendDetailOf(detailed).includes("from Dhannaram"), "Books detail has place of supply");
  ok(isTransportPocketName("CS KUMAR(SVT TRANSPORT CHENNAI)"), "name with Transport is a transport pocket");
  ok(!isTransportPocketName("Tabrez GT Trader"), "ordinary UPI is not a transport pocket");
  ok(isTransportPocket({ kind: "transport", name: "CS Kumar", accounts: [] }), "kind=transport wins");
  ok(!isTransportPocket({ kind: "collect", name: "SVT Transport", accounts: [] }), "kind=collect overrides the name");
  const folds = settleFoldIndexes([
    { kind: "in" },
    { debit: 100000, kind: "collect" },
    { kind: "in" },
    { debit: 150000, kind: "collect" },
    { kind: "in" },
    { debit: 97200, kind: "collect" },
    { kind: "in" },
  ]);
  ok(folds.join(",") === "1,3,5", "every To is a fold");
  ok(settleFoldChildren(folds, 5).join(",") === "4", "28-08 To only opens after the 20-08 To");
  ok(settleFoldChildren(folds, 3).join(",") === "2", "20-08 To only opens after the previous To");
  ok(settleFoldIndexes([{ kind: "in" }, { kind: "in" }]).length === 0, "UPI-only book has no To fold");

  ok(transportNeedToCollect(100000, 0) === 100000, "100k due on empty CS Kumar → need 100k");
  ok(transportNeedToCollect(100000, 50000) === 50000, "50k already on CS Kumar → still need 50k");
  ok(transportNeedToCollect(100000, 100000) === 0, "pocket covers the due → need 0");
  ok(transportNeedToCollect(100000, 120000) === 0, "extra in pocket is not a negative need");
  ok(dueOnTransportPocket({ transportPocket: "h-cs" }, { id: "h-cs", name: "CS Kumar" }, true), "due pinned to CS Kumar id");
  ok(!dueOnTransportPocket({ transportPocket: "h-cs" }, { id: "h-tab", name: "Tabrez" }, false), "other holder is not that due");
  ok(dueOnTransportPocket({ transportPocket: "" }, { id: "h-cs", name: "CS Kumar" }, true), "old unassigned due falls on the transport pocket");

  const locked = {
    ...due,
    id: "due-1",
    party: "Raju lorry",
    amount: 2500,
    vehicleNo: "KA01",
    placeOfSupply: "Chennai",
  } as unknown as Expense;
  const edited = patchTransportDue(locked, { party: "Raju", amount: 3000, vehicleNo: "KA02" });
  ok(!!edited && edited.party === "Raju" && edited.amount === 3000 && edited.vehicleNo === "KA02", "locked due can change name and amount");
  ok(!!edited && isPendingTransport(edited), "edit keeps the due locked (not paid)");
  ok(patchTransportDue(pocket, { amount: 1 }) === null, "paid transport cannot be patched");
  ok(patchTransportDue(locked, { party: "", amount: 3000 }) === null, "edit still needs a transporter name");
  const three = [
    { amount: 1000 },
    { amount: 2000 },
    { amount: 4000 },
  ];
  ok(selectedTransportDueTotal(three) === 7000, "pay-all is the sum of the locked dues");
  ok(selectedTransportDueTotal([three[0], three[2]]) === 5000, "pay 1 and 3 skips the middle due");

  const hCs = { id: "h-cs", name: "CS Kumar", accounts: ["CS Kumar"], kind: "transport", opening: 0, createdAt: "", updatedAt: "" } as PayHolder;
  const hTab = { id: "h-tab", name: "Tabrez", accounts: ["Tabrez"], opening: 0, createdAt: "", updatedAt: "" } as PayHolder;
  const bals: AcctBalance[] = [
    { name: "CS Kumar", received: 10000, ownerReceived: 0, collected: 0, spent: 0, balance: 10000, lines: [] },
    { name: "Tabrez", received: 2000, ownerReceived: 0, collected: 0, spent: 0, balance: 2000, lines: [] },
  ];
  ok(holderPayBalance(hCs, bals, [], []) === 10000, "CS Kumar pocket is UPI in");
  const srcs = listTransportPaySources([hTab, hCs], bals, [], []);
  ok(srcs[0].account === "CS Kumar" && srcs[0].transport, "transport pocket is first");
  ok(pickTransportPaySource(srcs, 3000)?.account === "CS Kumar", "3000 pay prefers CS Kumar");
  ok(pickTransportPaySource(srcs, 12000)?.account === "CS Kumar", "short pocket still offered so the form can warn");
  ok(isCsKumarPocketName("CS KUMAR(SVT TRANSPORT CHENNAI)"), "CS Kumar name with lorry tag");
  ok(!isCsKumarPocketName("Tabrez"), "Tabrez is not CS Kumar");
  const recSrcs = receiptsTransportPaySources(srcs);
  ok(!!(recSrcs[0].cash && recSrcs[1].ownerUpi && recSrcs.length === 3 && recSrcs[2].account === "CS Kumar"), "Receipts pay-from is Cash + UPI by owner + CS Kumar");
  ok(extraReceiptsTransportSources(srcs).every((s) => s.account === "Tabrez"), "Tabrez stays behind + from Accounts");
  ok(!!pickTransportPaySource(recSrcs, 12000)?.cash, "short CS Kumar → Cash");
  const fromTill = applyTransportDueCash(locked);
  ok(!!fromTill && !isPendingTransport(fromTill) && !isAccountTransportPay(fromTill), "cash pay unlocks the due without a UPI debit");
  ok(inDaybook(fromTill!) && inBooks(fromTill!), "cash transport hits Daybook and Books");
  const fromOwner = applyTransportDueOwnerUpi(locked);
  ok(!!(fromOwner && fromOwner.mode === "upi" && fromOwner.toOwner && !fromOwner.pocketSpend), "owner UPI is owner's UPI, not a pocket");
  ok(!isAccountTransportPay(fromOwner!) && !isPendingTransport(fromOwner!), "owner UPI does not debit CS Kumar");
  ok(!inDaybook(fromOwner!) && inBooks(fromOwner!), "owner UPI skips Daybook, still Books");

  console.log(`accounts.check OK (${n} assertions)`);
}

demo();
