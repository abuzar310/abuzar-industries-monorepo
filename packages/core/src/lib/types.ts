// Core data model — mirrors the legacy IndexedDB record shapes exactly.

export type Kind = "quotation" | "invoice";

/** A single timber line. Dimensions are kept as raw strings while typing
 *  (the editor sanitises them) and coerced to numbers only when computing. */
export interface Row {
  l: string | number;
  w: string | number;
  t: string | number;
  pcs: string | number;
  /** directly-entered CFT (used when the section's calcMode is "direct"). */
  cft?: string | number;
}

export interface Section {
  name: string;
  rate: string | number;
  rows: Row[];
  /** "cft" (L×W×T×Pcs÷144 × rate), "direct" (type CFT directly × rate),
   *  or "rft" (running feet Σ(L×Pcs) × rate). Default cft. */
  calcMode?: "cft" | "direct" | "rft" | "pcs";
}

export interface Doc {
  id: string;
  kind: Kind;
  number: string;
  status: string;
  customerId: string;
  customerName: string;
  phone: string;
  site: string;
  address: string;
  notes: string;
  date: string;
  sections: Section[];
  gst: string | number;
  /** "percent" (gst is a %) or "flat" (gst is a ₹ amount). Default percent. */
  gstMode?: "percent" | "flat";
  /** invoice tax split: "split" = SGST+CGST (intrastate), "igst" = single IGST (interstate). Default split. */
  gstKind?: "split" | "igst";
  /** accepted round-figure price override; falls back to the computed grand total. */
  finalPrice?: number;
  quotationId: string;
  paymentStatus: string;
  amountPaid: number;
  /** App B (stock): a selling invoice reduces stock, a buying invoice adds to it. Default = sell. */
  tradeType?: "sell" | "buy";
  /** invoice: customer GSTIN + payment type (shown on the tax invoice). */
  custGstin?: string;
  payType?: string;
  /** which brand bank to print on this invoice (index into brand.banks) — picker not printed */
  bankIdx?: number;
  /** App A (daybook): cash / UPI split accepted against this quotation. */
  payCash?: number;
  payUpi?: number;
  /** true once the accepted payment has been logged to the daybook (prevents double-posting). */
  paidLogged?: boolean;
  createdAt: string;
  updatedAt: string;
  synced: boolean;
  stockDeducted: boolean;
}

/** Per-app feature switches (each app sets these via its layout/app-config). */
export interface AppFeatures {
  /** invoices exist: show Convert-to-Invoice + Record-Payment (official). */
  invoices: boolean;
  /** quotations have only Draft/Created states (unofficial). */
  simpleQuote: boolean;
  /** show accept-payment (cash/UPI) on a created quote, posting to the daybook (unofficial). */
  acceptPayment: boolean;
  /** single-owner lock: no user picker, just the Owner password (official). */
  soloLogin?: boolean;
  /** Tally-style double-entry ledger section (official). */
  ledger?: boolean;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  site: string;
  address: string;
  notes: string;
  /** GSTIN — used when the customer is treated as a debtor in the Ledger. */
  gstin?: string;
  /** opening balance — money they owed before using the app (positive = they owe us). */
  opening?: number;
  createdAt: string;
  updatedAt?: string;
  synced: boolean;
}

export interface Stock {
  key: string;
  name: string;
  cft: number;
  updatedAt: string;
  synced: boolean;
}

export type DocStore = "quotations" | "invoices";
export type StoreName =
  | "customers"
  | "quotations"
  | "invoices"
  | "stock"
  | "expenses"
  | "meta"
  | "sessions"
  | "ledgers"
  | "vouchers";

// ---- app navigation (each app supplies its own tab set) ----
export interface Tab {
  label: string;
  href: string;
  badge?: boolean;
  owner?: boolean;
}

// ---- local users / roles ----
export type Role = "owner" | "manager";
export interface LocalUser {
  id: string;
  name: string;
  role: Role;
}

// ---- daybook / expenses ----
export type EntryType = "sale" | "salary" | "food" | "additional" | "custom";
export type PayMode = "cash" | "upi" | "";
export interface Expense {
  id: string;
  /** dd-mm-yy, same format as documents */
  date: string;
  type: EntryType;
  /** label for custom entries */
  label?: string;
  mode: PayMode;
  amount: number;
  note?: string;
  /** UPI recipient / account this money went to (only for mode "upi"); "" for cash. */
  account?: string;
  /** local user id who entered it */
  enteredBy: string;
  /** the quote/invoice id this entry was auto-created from (for cascade delete). */
  sourceId?: string;
  /** set once the entry is archived into a closed session; falsy = current open session */
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
  synced: boolean;
}

/** A closed daybook session (handed over to the owner). Entries keep their
 *  detail; this stores the summary for the history view. */
export interface DaybookSession {
  id: string;
  /** dd-mm-yy of close */
  date: string;
  closedAt: string;
  cashIn: number;
  upiIn: number;
  totalIn: number;
  spent: number;
  /** cash carried IN from the previous session (opening balance); absent/0 for older sessions. */
  opening?: number;
  /** amount actually handed over (may be less than in-hand). */
  given: number;
  /** cash kept back = in-hand − given, carried forward to the next session. */
  carried?: number;
  count: number;
  /** local user id who closed it */
  by: string;
  createdAt: string;
  updatedAt: string;
  synced: boolean;
}

export interface SupaConfig {
  url: string;
  key: string;
  secure?: boolean;
  openLock?: "never" | "daily" | "always";
  /** legacy flag, kept for migration */
  lockOnOpen?: boolean;
}

export interface AuthSession {
  token: string;
  refresh: string;
  email: string;
  exp: number;
}

export type SyncState = "local" | "queue" | "on" | "off";

// ---- ledger (Tally-style double-entry general ledger) ----

/** Tally primary groups covering the chart of accounts. */
export type LedgerGroup =
  | "Sundry Debtors"
  | "Sundry Creditors"
  | "Bank Accounts"
  | "Bank OD"
  | "Cash-in-hand"
  | "Duties & Taxes"
  | "Loans (Liability)"
  | "Loans & Advances (Asset)"
  | "Capital Account"
  | "Fixed Assets"
  | "Current Assets"
  | "Current Liabilities"
  | "Sales Accounts"
  | "Purchase Accounts"
  | "Direct Expenses"
  | "Indirect Expenses"
  | "Indirect Incomes";

/** A ledger account — party, bank, tax head, asset, income/expense, capital… */
export interface Ledger {
  id: string; // "L-" + uid
  name: string;
  group: LedgerGroup;
  /** opening balance, signed: +Dr / −Cr */
  opening: number;
  gstin: string;
  phone: string;
  address: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  synced: boolean;
}

export type VoucherType = "Receipt" | "Payment" | "Sales" | "Purchase" | "Journal" | "Contra";

/** One posting line of a voucher — exactly one of dr/cr is non-zero. */
export interface VLeg {
  ledgerId: string;
  dr: number;
  cr: number;
}

/** A double-entry voucher — balanced legs (Σdr === Σcr). */
export interface Voucher {
  id: string; // "V-" + uid
  no: number; // per-type running number
  date: string; // dd-mm-yy
  type: VoucherType;
  legs: VLeg[];
  narration: string;
  enteredBy: string;
  /** set when auto-posted from an invoice (the invoice id) — used to re-post / unpost */
  sourceId?: string;
  createdAt: string;
  updatedAt: string;
  synced: boolean;
}
