// Core data model — mirrors the legacy IndexedDB record shapes exactly.

export type Kind = "quotation" | "invoice";

/** A single timber line. Dimensions are kept as raw strings while typing
 *  (the editor sanitises them) and coerced to numbers only when computing. */
export interface Row {
  l: string | number;
  w: string | number;
  t: string | number;
  pcs: string | number;
}

export interface Section {
  name: string;
  rate: string | number;
  rows: Row[];
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
  quotationId: string;
  paymentStatus: string;
  amountPaid: number;
  /** App B (stock): a selling invoice reduces stock, a buying invoice adds to it. Default = sell. */
  tradeType?: "sell" | "buy";
  /** invoice: customer GSTIN + payment type (shown on the tax invoice). */
  custGstin?: string;
  payType?: string;
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
  | "vendors"
  | "accounts"
  | "ledger"
  | "sessions";

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
  /** local user id who entered it */
  enteredBy: string;
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
  /** amount handed over = money in hand at close */
  given: number;
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

// ---- ledger (Tally-style debtors / creditors / bank) ----

/** Creditor master. Debtors reuse the existing Customer store. */
export interface Vendor {
  id: string;
  name: string;
  phone: string;
  address: string;
  gstin: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  synced: boolean;
}

/** A cash/bank account the user defines (Cash, UPI, HDFC, …). */
export interface Account {
  id: string;
  name: string;
  /** balance before they started recording — seeds the bank book */
  opening: number;
  createdAt: string;
  updatedAt: string;
  synced: boolean;
}

export type VoucherKind = "opening" | "sale" | "purchase" | "receipt" | "payment" | "contra";

export interface LedgerEntry {
  id: string;
  /** dd-mm-yy, same format as documents */
  date: string;
  kind: VoucherKind;
  /** "" for contra */
  partyKind: "debtor" | "creditor" | "";
  /** customer id (debtor) / vendor id (creditor) / "" (contra) */
  partyId: string;
  /** TOTAL incl GST — this is what moves the party balance */
  amount: number;
  /** sale/purchase pre-GST base; equals amount for other kinds */
  taxable: number;
  /** sale/purchase GST % (0/5/12/18/28); 0 for other kinds */
  gstRate: number;
  /** account money lands in / leaves; contra = destination account */
  account: string;
  /** contra only: source account */
  fromAccount: string;
  /** bill / cheque / UTR */
  ref: string;
  note: string;
  /** local user id who entered it */
  enteredBy: string;
  createdAt: string;
  updatedAt: string;
  synced: boolean;
}
