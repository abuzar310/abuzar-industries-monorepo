import { formDialog } from "@/store/dialog-store";
import { saveLedger } from "./ledger";
import type { Ledger, LedgerGroup } from "./types";

const GROUPS: LedgerGroup[] = [
  "Sundry Debtors",
  "Sundry Creditors",
  "Bank Accounts",
  "Bank OD",
  "Cash-in-hand",
  "Duties & Taxes",
  "Loans (Liability)",
  "Loans & Advances (Asset)",
  "Capital Account",
  "Fixed Assets",
  "Current Assets",
  "Current Liabilities",
  "Sales Accounts",
  "Purchase Accounts",
  "Direct Expenses",
  "Indirect Expenses",
  "Indirect Incomes",
];

/** Add/edit a ledger account. Opening is entered as Dr(+) or Cr(−) via a sign toggle. */
export async function editLedgerDialog(existing?: Ledger, defaultGroup?: LedgerGroup): Promise<Ledger | null> {
  const open = existing?.opening ?? 0;
  const res = await formDialog({
    title: existing ? "Edit ledger" : "New ledger",
    fields: [
      { name: "name", label: "Ledger name", value: existing?.name, placeholder: "Party / bank / head", required: true },
      {
        name: "group",
        label: "Under group",
        type: "select",
        value: existing?.group || defaultGroup || "Sundry Debtors",
        options: GROUPS.map((g) => ({ value: g, label: g })),
      },
      { name: "opening", label: "Opening balance", type: "number", value: open ? String(Math.abs(open)) : "", placeholder: "0" },
      { name: "openSide", label: "Opening side", type: "select", value: open < 0 ? "Cr" : "Dr", options: [{ value: "Dr", label: "Dr (they owe us / asset)" }, { value: "Cr", label: "Cr (we owe / liability)" }] },
      { name: "gstin", label: "GSTIN", value: existing?.gstin, placeholder: "GST number (optional)" },
      { name: "phone", label: "Phone", type: "tel", inputMode: "numeric", value: existing?.phone, placeholder: "optional" },
      { name: "address", label: "Address", value: existing?.address, placeholder: "optional" },
    ],
    submitLabel: existing ? "Save" : "Create ledger",
  });
  if (!res) return null;
  const mag = Math.abs(+res.opening || 0);
  const opening = res.openSide === "Cr" ? -mag : mag;
  return saveLedger({
    id: existing?.id,
    name: res.name,
    group: res.group as LedgerGroup,
    opening,
    gstin: res.gstin,
    phone: res.phone,
    address: res.address,
  });
}
