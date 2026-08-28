// Core data model. Records live in the cloud database (the single source of
// truth) and are cached in memory on the client — see lib/data.ts.

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

/** Free-arrange placement on the A4 canvas (logical px in a 794×1123 = A4@96dpi page). */
export interface BoxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Section {
  name: string;
  rate: string | number;
  /** override this section's Total Price (₹) directly; unset = quantity × rate. */
  amtOverride?: number;
  rows: Row[];
  /** "cft" (L×W×T×Pcs÷144 × rate), "direct" (type CFT directly × rate),
   *  "cbm" (type CBM directly × ₹/CBM rate), or "rft" (running feet Σ(L×Pcs) × rate). Default cft. */
  calcMode?: "cft" | "direct" | "rft" | "pcs" | "cbm";
  /** free-arrange: where/how big this box sits on the A4 page (unset = auto-placed). */
  box?: BoxRect;
}

/** Decided carpenter commission. Not a payment — pending on Carpenters until given. */
export interface CommissionLock {
  amount: number;
  carpenter: string;
  party?: string;
  partyId?: string;
  lockedBy: string;
  lockedAt: string;
}

export interface Doc {
  id: string;
  kind: Kind;
  number: string;
  displayNumber?: string;
  status: string;
  customerId: string;
  customerName: string;
  phone: string;
  site: string;
  /** Carpenter's phone (Cut Size quotations). */
  sitePhone?: string;
  /** Cut Size quote: carpenter is the buyer (hide Customer; bill still uses customerName = carpenter). */
  buyer?: "party" | "carpenter";
  address: string;
  notes: string;
  date: string;
  sections: Section[];
  /** free-arrange mode: boxes are placed/sized by hand on the A4 canvas (see Section.box). */
  freeLayout?: boolean;
  /** free-arrange: placement of the grand-total (bill) box on the A4 page. */
  billBox?: BoxRect;
  gst: string | number;
  /** "percent" (gst is a %) or "flat" (gst is a ₹ amount). Default percent. */
  gstMode?: "percent" | "flat";
  /** invoice tax split: "split" = SGST+CGST (intrastate), "igst" = single IGST (interstate). Default split. */
  gstKind?: "split" | "igst";
  /** invoice: a rental invoice — always CGST+SGST, printed as "Rented Invoice" and grouped separately in Reports.
   *  A rented invoice has no wood line-items: just a single custom rent amount (rentAmount) + GST. */
  rented?: boolean;
  /** rented invoice: the custom rent amount (the taxable value; ignores sections). */
  rentAmount?: number;
  /** rented invoice: description of the rent line (default "Rent"). */
  rentDesc?: string;
  /** unofficial quote: optional permit fee charged to the customer. Unset / 0 = not on the bill or print. */
  permitFee?: number;
  /** accepted round-figure price override; falls back to the computed grand total. */
  finalPrice?: number;
  /** print the agreed final price on the sheet (default OFF — clean quote format). */
  showFinalOnPrint?: boolean;
  /** print sizes/quantities only — hide rates, prices, and bill totals (default OFF). */
  hidePricesOnPrint?: boolean;
  quotationId: string;
  paymentStatus: string;
  amountPaid: number;
  /** App B (stock): a selling invoice reduces stock, a buying invoice adds to it. Default = sell.
   *  Display `number` series is per trade type (purchases 1,2,3…; sales keep the high counter). */
  tradeType?: "sell" | "buy";
  /** invoice: customer GSTIN + payment type (shown on the tax invoice). */
  custGstin?: string;
  payType?: string;
  /** purchase invoice: supplier's own bill / invoice number (custom, not our serial). */
  supplierBillNo?: string;
  /** invoice: HSN/SAC code for the goods (short code shown on the tax invoice). */
  hsn?: string;
  /** selling invoice: consignee "Ship To" address + transport vehicle number (shown on the invoice). */
  shipTo?: string;
  vehicleNo?: string;
  /** customer / bill-to PIN (6 digits) — required for e-way bill JSON. */
  custPincode?: string;
  /** ship-to PIN when different from bill-to (defaults to custPincode). */
  shipToPincode?: string;
  /** transporter GSTIN / TRANSIN (optional on Part A). */
  transporterId?: string;
  /** approx. distance in km (portal may recalculate). */
  transDistance?: number;
  /** e-way bill number pasted back after NIC portal generate. */
  ewbNo?: string;
  /** e-way bill date from portal (dd-mm-yy display). */
  ewbDate?: string;
  /** which brand bank to print on this invoice (index into brand.banks) — picker not printed */
  bankIdx?: number;
  /** App A (daybook): cash / UPI split accepted against this quotation. */
  payCash?: number;
  payUpi?: number;
  /** Wood taken against carpenter commission (not cash / UPI). amountPaid includes this. */
  payCommission?: number;
  /** Decided carpenter commission, not given yet. Pending on Carpenters until paid. */
  commLock?: CommissionLock;
  /** true once the accepted payment has been logged to the daybook (prevents double-posting). */
  paidLogged?: boolean;
  createdAt: string;
  updatedAt: string;
  /** legacy sync flag from the old local-first records — ignored now. */
  synced?: boolean;
  stockDeducted: boolean;
  /** soft-delete: ISO time it was moved to the Recycle bin. Hidden from lists, restorable from Settings.
   *  Kept in the cloud too (not hard-deleted), so a delete is always recoverable on any device. */
  deletedAt?: string;
  /** "Delete forever" marker. Row stays in local + cloud forever (never hard-DELETEd) so a purge
   *  can still be undone from Settings → Archive. Hidden from lists and the Recycle bin. */
  purgedAt?: string;
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
  /** simple business vouchers: receipt/payment books + invoice payment acceptance (official). */
  vouchers?: boolean;
  /** Cut Size: standalone Carpenters tab (commission + parties). */
  carpenters?: boolean;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  site: string;
  /** Carpenter phone (optional). */
  sitePhone?: string;
  /** Carpenter village (optional). */
  siteVillage?: string;
  /** Carpenter city (optional). */
  siteCity?: string;
  address: string;
  notes: string;
  /** GSTIN — used when the customer is treated as a debtor in the Ledger. */
  gstin?: string;
  /** 6-digit PIN for e-way / shipping. */
  pincode?: string;
  /** opening balance — money they owed before using the app (positive = they owe us). */
  opening?: number;
  createdAt: string;
  updatedAt?: string;
  synced?: boolean;
}

/** Purchase-side party (Buys agent / buyer). Stored separately from sales customers. */
export interface Supplier extends Customer {
  /** From-accounts under this agent (e.g. Dhannaram → several timber yards). */
  fromAccounts?: string[];
}

export interface Stock {
  key: string;
  name: string;
  cft: number;
  updatedAt: string;
  synced?: boolean;
}

export type DocStore = "quotations" | "invoices";
export type StoreName =
  | "customers"
  | "suppliers"
  | "quotations"
  | "invoices"
  | "stock"
  | "expenses"
  | "sessions"
  | "ledgers"
  | "vouchers"
  | "collections"
  | "payHolders"
  | "workers"
  | "attendance"
  | "activity"
  | "purchases"
  | "carpenters"
  | "chat";

/** Standalone carpenter contact (Cut Size) — not a customer / ledger party. */
export interface Carpenter {
  id: string;
  name: string;
  phone: string;
  /** Second mobile — WhatsApp / missed-call number. */
  phoneAlt?: string;
  village?: string;
  city?: string;
  notes?: string;
  /** Compressed JPEG data URL from the phone camera or gallery. */
  photo?: string;
  /** Cut Size: they rent place in the yard — Rent tab + Against rent on quotations. */
  placeRent?: boolean;
  /** Default monthly place rent ₹ (Charge can still type a different figure). */
  monthlyRent?: number;
  /** Brought-forward place rent they already owe — a profile figure, like a bank opening. */
  rentOpening?: number;
  createdAt: string;
  updatedAt?: string;
}

/**
 * Unofficial Buys entry.
 * - kind "buy": timber-in purchase row (agent + from-account)
 * - kind "pay": payment register row (cash / bank against agent + from)
 */
export interface Purchase {
  id: string;
  kind?: "buy" | "pay";
  /** dd-mm-yy */
  date: string;
  /** Agent / buyer (suppliers store) — e.g. Dhannaram */
  supplierId: string;
  /** Denormalized agent name */
  buyerName?: string;
  /** From-account under the agent (yard / party name) */
  fromName: string;
  billNo: string;
  cft: number;
  rate: number;
  /** line = cft × rate (or override) */
  amount: number;
  /** optional GST ₹ — user typed, may be empty */
  gst: number;
  /** optional bill / credit portion — leave empty if none */
  billAmount: number;
  note: string;
  /** money paid in cash */
  cashPaid: number;
  /** money paid by bank transfer */
  bankPaid: number;
  /**
   * On kind "pay": optional purchase (buy) this payment is against.
   * Empty = apply FIFO across that supplier + from-account (legacy).
   */
  purchaseId?: string;
  /** dd-mm-yy of payment (optional) */
  payDate: string;
  /** dd-mm-yy — ping owner on/after this date (Buys reminder) */
  remindAt?: string;
  /** @deprecated legacy — migrated into cashPaid */
  topAmount?: number;
  topPaid?: number;
  billPaid?: number;
  billPayDate?: string;
  accountNote?: string;
  createdAt: string;
  updatedAt: string;
}

/** Owner audit trail — login/logout/create/update/delete (unofficial Logs tab). */
export interface Activity {
  id: string;
  /** ISO timestamp */
  at: string;
  by: string;
  byName: string;
  /** owner | manager */
  role?: string;
  action: "login" | "logout" | "create" | "update" | "delete";
  /** store name when the action is about a record */
  store?: string;
  targetId?: string;
  /** short one-line headline */
  summary: string;
  /** longer detail lines (amount, mode, party, note, field diffs…) */
  detail?: string;
  amount?: number;
  mode?: string;
  date?: string;
  party?: string;
  createdAt: string;
  updatedAt: string;
}

// ---- app navigation (each app supplies its own tab set) ----
export interface Tab {
  label: string;
  href: string;
  icon?: string;
  /** true = Daybook unseen; "buys" = due purchase reminders; "chat" = unread staff messages */
  badge?: boolean | "buys" | "chat";
  owner?: boolean;
}

// ---- local users / roles ----
export type Role = "owner" | "manager";
export interface LocalUser {
  id: string;
  name: string;
  role: Role;
}

/** One line in the owner-manager in-app chat (synced like other records). */
export interface ChatMsg {
  id: string;
  fromId: string;
  fromName: string;
  fromRole: Role;
  text: string;
  createdAt: string;
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
  /** Person / party name on a category spend (carpenter, truck, etc.) — display only, not a ledger link. */
  party?: string;
  /** Trip/round count (e.g. Mini truck). */
  rounds?: number;
  /** Carpenter name on a commission payout (from customer/quote). */
  carpenter?: string;
  /** Carpenter directory id when this row is place rent or a payout for a tenant. */
  carpenterId?: string;
  /** Place rent passbook: charge (this month) / opening (old debt) / cash received / commission set-off. */
  placeRentKind?: "charge" | "opening" | "received" | "setoff";
  /** Quotation linked for logging only (not cascade-deleted with the quote — unlike sourceId). */
  refQuoteId?: string;
  /** Snapshot of quotation number at save time (survives quote delete). */
  quoteNo?: string;
  /** UPI recipient / account this money went to (only for mode "upi"); "" for cash. */
  account?: string;
  /** counter-account for transfers: journal voucher's TO-bank (account = FROM-bank). */
  account2?: string;
  /** cash that went straight to the owner (owner recorded it, or "Cash → Owner"): kept OUT of the
   *  manager's cash daybook, but still a recorded payment. */
  toOwner?: boolean;
  /** local user id who entered it */
  enteredBy: string;
  /** the quote/invoice id this entry was auto-created from (for cascade delete). */
  sourceId?: string;
  /** a standalone receipt/charge: the customer id this entry is credited/debited to (no source quote). */
  custId?: string;
  /** one customer receipt may be split across quotes (waterfall) — every piece carries the
   *  SAME receipt id so lists can show it back as the single amount that was actually taken. */
  rcptId?: string;
  /** on a custId entry: true = a DUE added (debit, they owe more); false/absent = a payment received. */
  charge?: boolean;
  /** Internal cash move (Paid to owner / Paid to manager): hits Daybook cash, never Books. */
  skipBooks?: boolean;
  /** set once the entry is archived into a closed session; falsy = current open session */
  sessionId?: string;
  /** Accounts tab: when this payment was physically collected from the account holder. */
  collectedAt?: string;
  /** who marked it collected */
  collectedBy?: string;
  createdAt: string;
  updatedAt: string;
  synced?: boolean;
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
  /** true while the handover is awaiting the owner's confirmation (not yet final). */
  pending?: boolean;
  /** owner user id who confirmed the handover. */
  confirmedBy?: string;
  /** local user id who requested/closed it */
  by: string;
  createdAt: string;
  updatedAt: string;
  synced?: boolean;
}

/** "on" = everything saved to the cloud · "queue" = a write is on its way ·
 *  "off" = offline (writes wait and retry) · "local" = booting. */
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
  synced?: boolean;
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
  synced?: boolean;
}
