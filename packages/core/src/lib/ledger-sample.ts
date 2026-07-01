// One-click sample data so the Ledger is easy to understand. Self-contained:
// creates an HDFC account, two vendors, one debtor customer, and a realistic
// set of vouchers across June 2026. Parties are de-duped by name so re-seeding
// won't pile up masters; the UI only offers this while the ledger is empty.
import { allRec } from "./db";
import { saveCustomer } from "./customers";
import { addEntry, listAccounts, saveAccount, saveVendor } from "./ledger";
import type { Customer } from "./types";

export async function loadSampleLedger(enteredBy: string): Promise<void> {
  // account: ensure an HDFC bank with an opening balance (Cash/UPI are seeded on boot)
  const accts = await listAccounts();
  const hdfc = accts.find((a) => a.name.toLowerCase() === "hdfc") || (await saveAccount({ name: "HDFC", opening: 50000 }));
  const cash = accts.find((a) => a.name.toLowerCase() === "cash") || (await saveAccount({ name: "Cash" }));

  // creditors (vendors we buy timber from)
  const v1 = await saveVendor({ name: "Karnataka Timber Depot", phone: "9845011111", address: "Timber Yard, Chitradurga", gstin: "29ABCDE1234F1Z5" });
  const v2 = await saveVendor({ name: "Shree Sawmill", phone: "9845022222", address: "DVG Road, Davangere" });

  // debtor (reuse Customers — create one if not present)
  const custs = await allRec<Customer>("customers");
  const c1: Customer =
    custs.find((c) => c.name === "Ravi Furniture Works") ||
    (await saveCustomer({ name: "Ravi Furniture Works", phone: "9845033333", site: "Bapuji Nagar", gstin: "29RAVIF1234A1Z2" }));

  const e = enteredBy;
  // creditor: buy teak (with GST), pay part from bank; buy neem on credit
  await addEntry({ kind: "purchase", partyKind: "creditor", partyId: v1.id, amount: 80000, gstRate: 18, date: "05-06-26", ref: "BILL-204", note: "Teak logs", enteredBy: e });
  await addEntry({ kind: "payment", partyKind: "creditor", partyId: v1.id, amount: 50000, account: hdfc.id, date: "20-06-26", ref: "NEFT", note: "Part payment", enteredBy: e });
  await addEntry({ kind: "purchase", partyKind: "creditor", partyId: v2.id, amount: 25000, gstRate: 18, date: "12-06-26", ref: "BILL-77", note: "Neem sawing", enteredBy: e });

  // debtor: opening due, a GST sale, then a part receipt into the bank
  await addEntry({ kind: "opening", partyKind: "debtor", partyId: c1.id, amount: 10000, date: "01-06-26", note: "Opening balance", enteredBy: e });
  await addEntry({ kind: "sale", partyKind: "debtor", partyId: c1.id, amount: 60000, gstRate: 18, date: "08-06-26", ref: "Trade sale", note: "Teak planks", enteredBy: e });
  await addEntry({ kind: "receipt", partyKind: "debtor", partyId: c1.id, amount: 40000, account: hdfc.id, date: "22-06-26", ref: "UPI", note: "Against bill", enteredBy: e });

  // bank: own-account transfer (contra) — cash deposited into HDFC
  await addEntry({ kind: "contra", amount: 20000, account: hdfc.id, fromAccount: cash.id, date: "25-06-26", note: "Cash deposited to bank", enteredBy: e });
}
