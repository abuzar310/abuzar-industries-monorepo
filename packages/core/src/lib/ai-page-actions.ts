// Predetermined AI commands per nav tab — matched to what each page actually does.
import { getFeatures } from "./features";
import { customerFollowupMessage } from "./whatsapp";
import {
  docQuickActions,
  genericQuickActions,
  type AiQuickAction,
} from "./ai-doc-actions";
import type { Doc } from "./types";
import { chatHref, DAY_UPDATE_DRAFT } from "./staff-chat";

export type AiPageBundle = {
  /** Short page name for the FAB hint */
  title: string;
  /** Optional subtitle under the header */
  contextLabel?: string;
  actions: AiQuickAction[];
};

function appLine() {
  return cutSize()
    ? "Cut Size / Abuzar yard app (NOT Tally, Zoho, or Vyapar). Guide staff using the real screens and buttons in this app."
    : "Official Abuzar Industries app (quotations → invoices + stock). NOT Tally/Zoho. Guide staff using the real screens.";
}

function cutSize(): boolean {
  return !!getFeatures().simpleQuote;
}

function p(label: string, prompt: string): AiQuickAction {
  return { id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""), label, prompt };
}

function how(label: string, steps: string): AiQuickAction {
  return p(label, `${appLine()}\n\n${steps}\n\nUse short numbered steps. Name the exact tab/button. Do not invent menu names.`);
}

function draft(label: string, brief: string): AiQuickAction {
  return p(
    label,
    `${brief}\n\nWrite a short WhatsApp-ready draft in natural Indian English. Use [brackets] for any missing name/amount. 3–7 lines. No hashtags.`,
  );
}

function explain(label: string, topic: string): AiQuickAction {
  return p(label, `${appLine()}\n\nExplain ${topic} in plain language for yard staff. Max 8 short lines.`);
}

/** Dashboard `/` */
function dashboardActions(): AiQuickAction[] {
  if (!cutSize()) {
    return [
      explain("What is Dashboard?", "official home: sales/purchase CFT, closing stock, low stock, invoice activity"),
      how("Who owes on invoices?", "Customers tab (outstanding) or Reports. Invoices are the bills; quotations are estimates."),
      draft("Week sales note", "WhatsApp weekly sales/stock note for the owner — leave CFT and ₹ blanks"),
      how("Low stock", "Dashboard low-stock card or Stock tab — wood types running low."),
      how("Open a quotation", "Dashboard / Quotations → open the quote → convert to invoice when they confirm."),
    ];
  }
  return [
    explain("What is Dashboard?", "the Dashboard KPIs: sales received, billed quotations, outstanding parties, and the transactions list — and how they should match Balances"),
    draft("Month summary for owner", "Summarize a timber yard month for WhatsApp to the owner: billed, received, outstanding — leave [Month] and ₹ blanks"),
    how("Who owes the most?", "On Dashboard, use Outstanding / pending cards (or open Balances). Tell me to open Balances → search the party with the highest due."),
    how("Find today's payments", "On Dashboard open All Transactions or go to Receipts / Logs. Explain how to spot today's cash and UPI receipts."),
    {
      id: "ask-manager-day-update",
      label: "Ask manager for day update",
      href: chatHref(DAY_UPDATE_DRAFT),
    },
  ];
}

/** Balances `/payments` */
function balancesActions(): AiQuickAction[] {
  return [
    explain("What is Balances?", "the Balances tab: who still owes after Created quotes / quote money, opening dues, and payments — settled parties drop off"),
    draft("Balance reminder", "Polite WhatsApp payment reminder for a customer with outstanding timber balance. Use [Name] and [Amount]"),
    draft("Soft chase over ₹5,000", "Softer follow-up WhatsApp for parties owing more than ₹5,000 — fill [Name] [Amount]"),
    how("Check one party's due", "Balances → search name/phone → read the card (due on the card). Tap the card to open the customer page for the full ledger."),
    how("Send their statement", "Balances → that person's card → Preview, PDF, or Forward. Forward WhatsApps them their due + the statement PDF (needs their phone)."),
    how("Edit a wrong payment", "Open the customer from the Balances card → statement PDF / quotes, or Receipts / the quotation Payment block. Warn not to double-enter."),
    explain("Why Balances ≠ one quote", "Balances is the whole party (all Created quotes + dues − payments). One quotation Payment only updates that quote's paid/due."),
    draft("List chase for today", "WhatsApp note to myself / manager: top overdue parties to call today — leave blanks for names and amounts"),
  ];
}

/** Receipts `/receipts` */
function receiptsActions(): AiQuickAction[] {
  return [
    explain("What is Receipts?", "the money desk: receive cash/UPI from a customer (apply to oldest quotes / one quote / account only), paid-outs, and worker give/repay shortcuts"),
    how("Take money from a customer", "Receipts → Received → Customer → pick customer → amount → Cash or UPI (+ account) → choose Apply to (oldest / one quote / account) → Record. Mention Pay full / Fill due if useful."),
    how("Accept place rent", "Receipts → Received → Customer → search Ismail Planning Work or Suresha Planning Work → Accept rent → amount → Cash or UPI → Accept rent. Same money as Rent → They paid rent. Does not sit on a customer account."),
    how("Apply to one quotation only", "Receipts → pick customer → Apply to that quotation number (not oldest). Or open the quotation → Payment block."),
    how("Paid out (food/truck/salary)", "Receipts → Paid out → pick category (food, truck, carpenter, salary, etc.) → amount → mode → Record."),
    how("Worker advance from Receipts", "Receipts worker panel: Give advance / Received back — without opening Attendance. Say when to use Attendance Pay instead."),
    draft("Receipt confirmation", "WhatsApp confirmation after receiving payment: [Name], ₹[Amount], Cash/UPI, thank you"),
    how("Edit or undo a receipt", "Receipts history → expand customer → Edit/Delete the row. Quote-locked payments may open in the editor instead."),
    draft("Ask customer to pay today", "Short WhatsApp asking customer to pay today's balance at the yard — [Name] [Amount]"),
  ];
}

/** Accounts `/accounts` */
function accountsActions(): AiQuickAction[] {
  return [
    explain("What is Accounts?", "UPI/cash 'pockets' (account holders like Tabrez GPay): money received into an account until Collect/handover to owner. Clear log resets this screen's totals only"),
    how("Collect from a holder", "Accounts → open holder → Collect (full or partial) → confirm. That marks money handed to the owner."),
    how("Add holder / UPI account", "Accounts → + Account holder → + Account under holder → optional opening balance."),
    draft("Holder balance WhatsApp", "WhatsApp summary for an account holder: Received / Collected / Balance still to collect — [Holder] with ₹ blanks"),
    how("Move a mis-filed UPI line", "Accounts → find the UPI payment line → move to the correct account. Or delete and re-enter in Receipts if needed."),
    how("Download holder PDF", "Accounts → open holder → Preview (look first) or PDF (download). File is the same Date / Particulars / Dr / Cr / Balance passbook as on screen. Send is a WhatsApp totals text."),
    explain("Accounts vs Daybook vs Receipts", "Receipts = customer money in. Daybook = manager till session. Accounts = which UPI pocket holds money before Collect to owner."),
  ];
}

/** Quotation hub `/editor` without a loaded doc */
function quotationHubActions(): AiQuickAction[] {
  return [
    how("Start a new quotation", "Quotation tab / + Create a quotation (or Quotations → + New). Fill customer (or turn on Carpenter mode), sizes/CFT lines, rates → Save. Draft vs Created: Created counts as billable in Balances."),
    how("Carpenter came to buy", "Quotation → Carpenter mode on → pick the carpenter. Customer is hidden; the bill is still under that name. House owner with a carpenter? Leave Carpenter mode off: Customer = owner, Carpenter = who brought them."),
    how("Open last quotation", "Quotation tab resumes the last open quote, or pick from Quotations list."),
    draft("Ask customer for sizes", "WhatsApp asking customer/carpenter for sizes (L×W×T×Pcs) and wood type before making the quote"),
    how("Mark Created (billable)", "In the editor set status to Created (not only Draft) so it appears in Balances / billed totals. Payment on a Draft also makes it count."),
    how("Accept payment on a quote", "Open quotation → Payment / Accept payment → Cash and/or UPI → save. Part payments allowed."),
    how("Add old balance on a new quote", "Pick a customer who already owes → under totals, Add old balance (optional). It goes on the printed amount due. They can pay this paper now or later. Leave it off if they will settle old dues separately."),
    how("Permit / extra charge", "On the quotation totals, name the line (Permit, loading, …) and type the ₹. It prints only when an amount is set. Unset / 0 stays off the paper."),
    draft("Send quote intro", "WhatsApp: we prepared your timber quotation — please check PDF / visit yard. [Name] [Quote no]"),
  ];
}

/** Quotations list `/quotations` */
function quotationsListActions(): AiQuickAction[] {
  return [
    explain("What is Quotations list?", "archive of all quotes — search, open, print, WhatsApp PDF, balance remind, month report PDF. Drafts show but don't count as billed until Created or paid"),
    how("Find a customer's quotes", "Quotations → use search (name/phone/number) or TopNav search. Open the row to edit."),
    how("WhatsApp a quote PDF", "Quotations row → WhatsApp (or open quote → WhatsApp). PDF goes via share sheet on phone; wa.me is text-only."),
    draft("Remind unpaid quote", "WhatsApp reminder for unpaid quotation [Quote no] to [Name] for ₹[Balance]"),
    how("Month report PDF", "Quotations → Download report PDF. Same cream passbook as Accounts: Date / Particulars / Billed / Received / Balance, oldest month first, every quote not just the list page."),
    how("New quotation from list", "Quotations → + New Quotation → editor."),
    how("Recycle bin quotes", "Multi-select rows → Recycle bin. Restore later from Settings."),
    draft("Follow up old draft", "WhatsApp to customer about an old draft quotation still pending approval — [Name] [Quote no]"),
  ];
}

/** Customers `/customers` */
function customersActions(detailName?: string): AiQuickAction[] {
  const name = detailName || "[Customer]";
  const base: AiQuickAction[] = [
    explain("What is Customers?", "customer directory with quote counts, paid, opening dues, outstanding — start new quotes and WhatsApp from cards; detail page has statement PDF"),
    how("Add a customer", "Customers → + Add customer → name, phone, carpenter/site → save."),
    ...(cutSize()
      ? [how("Carpenter commission book", "Carpenters tab — who they brought, when commission was given, how much.")]
      : []),
    how("New quote for a customer", "Customers → card or detail → New quote (opens editor with that party)."),
    {
      id: "cust-followup",
      label: "WhatsApp follow-up",
      readyText: detailName ? customerFollowupMessage(detailName) : undefined,
      prompt: detailName
        ? undefined
        : "Draft a short WhatsApp follow-up for a timber customer enquiry. Use [Name]. 3–5 lines.",
    },
    draft("Balance statement msg", `WhatsApp sharing outstanding for ${name} — leave ₹ blanks if unknown; ask them to check statement`),
    how("Sort by outstanding", "Customers → sort Outstanding first to chase dues."),
    how("Opening dues", "On customer detail/edit, opening dues add to Balances outstanding. Explain briefly when to use opening dues vs a Created quote."),
    how("Statement PDF", "Customer page → Preview or PDF. Same Date / Particulars / Dr / Cr / Balance passbook as Accounts — every bill and payment, not the 15-row screen page."),
    draft("Ask carpenter site phone", "WhatsApp asking for carpenter name and site phone to save on the customer card"),
  ];
  return base;
}

/** Suppliers — Cut Size `/buys` or official `/suppliers` */
function suppliersActions(): AiQuickAction[] {
  if (!cutSize()) {
    return [
      explain("What is Suppliers?", "supplier master for the official app — purchases/stock side"),
      how("Add a supplier", "Suppliers → add supplier → save name/phone."),
      draft("Ask supplier for rates", "WhatsApp to timber supplier asking current rates / availability — [Supplier]"),
      how("Link purchase / stock", "Explain how purchases from suppliers affect stock in the official app (high level)."),
    ];
  }
  return [
    explain("What is Suppliers (Buys)?", "purchase side: timber buys (CFT, rate, cash vs invoice), payments to suppliers, due reminders — separate from customer sales"),
    how("Log a purchase", "Suppliers → Register → + Purchase → supplier, bill/CFT, cash vs bank split → save."),
    how("Pay a supplier", "Suppliers → Payments → + Payment → amount, mode → apply to supplier dues."),
    draft("Payment note to supplier", "WhatsApp to supplier confirming payment sent — [Supplier] ₹[Amount] Cash/UPI/NEFT"),
    how("Due reminders", "Suppliers badge / unpaid filter — set or clear reminders on purchases due."),
    how("Supplier PDF register", "Expand supplier → Preview or Save PDF of their purchase/payment register."),
    explain("Cash vs invoice outstanding", "Supplier KPIs split what you still owe as cash purchases vs invoice/credit purchases."),
    draft("Ask for bill/CFT", "WhatsApp asking supplier to send bill number and CFT for today's load"),
  ];
}

/** Contacts `/contacts` */
function contactsActions(): AiQuickAction[] {
  return [
    explain("What is Contacts?", "printable phone book — Customers (with carpenter) or Carpenters (with their parties). Read-only; money is elsewhere"),
    how("Find a phone number", "Contacts → Customers or Carpenters → search → tap name to open customer detail."),
    how("Parties under a carpenter", cutSize()
      ? "Carpenters tab (or Contacts → Carpenters) → open a carpenter → see linked parties and commission."
      : "Contacts → Carpenters view → find carpenter → see linked parties."),
    draft("Intro to carpenter", "WhatsApp intro to a carpenter about timber supply from our yard — [Carpenter name]"),
    how("Print contact list", "Contacts → Print for a paper phone list."),
    draft("Ask missing phone", "WhatsApp to manager asking to update phone number for [Customer/Carpenter]"),
  ];
}

/** Daybook `/expenses` */
function daybookActions(): AiQuickAction[] {
  return [
    explain("What is Daybook?", "manager till for the open cash session: money in/out, running in-hand, Hand over to Owner (owner confirms). Also shows a statements log of cash/UPI receipts"),
    how("What's in hand?", "Daybook shows ₹ in hand for the current session. Hand over to Owner sends that cash upstairs for owner Confirm/Decline."),
    how("Money out (tea/food/shop)", "Daybook → Money Out → pick category → amount → Add entry. Hits the open session."),
    how("Money in (paid to manager)", "Daybook → Money In → use when cash is paid to the manager for the till (daybook-only labels as designed)."),
    how("Hand over to owner", "Manager: Hand over to Owner with amount in hand → Owner: Confirm received or Decline. Don't double-count in Receipts."),
    draft("Handover note to owner", "WhatsApp: handing over cash ₹[Amount] from daybook session — please confirm in app"),
    draft("Today's daybook summary", "WhatsApp summary of today's daybook: opening/in/out/in-hand — leave ₹ blanks"),
    explain("Daybook vs Receipts", "Customer payments belong in Receipts (or quote Payment). Daybook is the manager's cash drawer session and handover."),
  ];
}

/** Books `/books` */
function booksActions(): AiQuickAction[] {
  return [
    explain("What is Books?", "owner month-end books from the same money events: Income & Expense, Month ledger, Cash book, Bank/UPI book, Balance sheet, Assets — with Save PDF"),
    how("P&L this month", "Books → Income & Expense → set month/year → read totals → Save PDF if needed."),
    how("Cash book vs Bank book", "Books → Cash book for cash movements; Bank (UPI) book for UPI accounts. Explain they follow Books inclusion rules (not every daybook-only label)."),
    draft("Month summary for owner", "Plain-language WhatsApp P&L style summary for the owner — [Month] with blanks for income, expense, net"),
    how("Balance sheet view", "Books → Balance sheet — receivables vs cash/UPI style snapshot for the period."),
    how("Biggest expense category", "Books → Income & Expense / ledger filters — find the largest expense category this month."),
    how("Save PDF of a section", "Books → choose view → Preview or Save PDF. Month ledger and Cash book dump the full book (oldest first), not the 15 rows on screen."),
  ];
}

/** Logs `/logs` */
function logsActions(): AiQuickAction[] {
  return [
    explain("What is Logs?", "audit trail: who logged in/out and who created/updated/deleted parties, payments, amounts — replaces old Statements route"),
    how("Who deleted a payment?", "Logs → filter Deleted → search party/amount → expand row for full detail."),
    how("What did a manager change?", "Logs → filter by who (manager) + Updated/Created → last hour/today."),
    how("Find quote activity", "Logs → search quotation number or id → expand matching rows."),
    how("Login trail today", "Logs → Login / Logout filters for today."),
    draft("Ask about a delete", "WhatsApp to manager politely asking why a payment/quote was deleted — [Ref] [Time]"),
    explain("Logs vs Balances", "Logs show who changed what; Balances show current dues. Use Logs to investigate mistakes."),
  ];
}

/** Attendance `/attendance` */
function attendanceActions(): AiQuickAction[] {
  return [
    explain("What is Attendance?", "yard labour: mark full/half/absent by day, weekly earn vs paid, wage pot + advance/debt, pay wages, give advance, cut wages, repay — cash via manager Daybook or owner pocket"),
    how("Mark present today", "Attendance → find worker → tap today's cell to cycle Full / Half / Absent."),
    how("Pay wages", "Attendance → open worker Pay panel → Pay wages (or to debt) → Paid by Manager/Owner → confirm."),
    how("Give advance", "Attendance → worker → Give advance ₹ → choose Manager/Owner cash path."),
    how("Cut wages toward advance", "Attendance → deduct/cut from wages against the worker's advance/debt pot."),
    draft("Week attendance summary", "WhatsApp Mon–Sat attendance summary for the owner — leave worker names and Full/Half/Absent blanks"),
    how("Who is due wages?", "Attendance week grid + earn vs paid — list who still has unpaid wages this week."),
    draft("Tell worker wage paid", "WhatsApp to worker: wages paid ₹[Amount] for week [dates]"),
  ];
}

/** Settings */
function settingsActions(): AiQuickAction[] {
  return [
    how("Restore deleted quote", "Settings → Recycle bin / Archive → restore the quotation. Don't recreate a duplicate."),
    how("Backup / import", "Settings → backup or import as offered — warn to be careful overwriting live data."),
    how("Set AI API key", "Settings → AI assistant → host URL, model, API key → Save AI. Owner only. The key is never shown again."),
    how("Install app (PWA)", "Settings → install / Add to Home Screen if shown."),
    explain("What managers shouldn't touch", "Owner-only Settings: recycle, archive, migrations. Managers use day-to-day tabs only."),
  ];
}

/** Official-only extras */
function invoicesActions(): AiQuickAction[] {
  return [
    explain("What is Invoices?", "tax invoices converted from quotations in the official app — GST, print, e-way related fields"),
    how("Make invoice from quote", "Open quotation → convert / create invoice (official flow) → fill GSTIN/pay type → save."),
    draft("Invoice WhatsApp note", "WhatsApp sending tax invoice [Inv no] to [Name] — thank you"),
    how("Print tax invoice", "Invoices list or editor → Print / PDF."),
  ];
}

function stockActions(): AiQuickAction[] {
  return [
    explain("What is Stock?", "wood stock levels affected by buying/selling invoices in the official app"),
    how("Check stock of a size", "Stock tab → find the wood/size row → read quantity."),
    draft("Stock short note", "WhatsApp to yard: low stock alert for [Size/Wood] — please check"),
  ];
}

function reportsActions(): AiQuickAction[] {
  return [
    explain("What is Reports?", "official app management reports over invoices/trading"),
    draft("Weekly sales note", "WhatsApp weekly sales summary for owner — leave blanks for totals"),
    how("Export / print a report", "Reports → pick the report → print or download as the screen allows."),
  ];
}

function pathKey(pathname: string): string {
  const pth = (pathname || "/").split("?")[0].replace(/\/+$/, "") || "/";
  if (pth === "/") return "dashboard";
  if (pth.startsWith("/editor")) return "editor";
  if (pth.startsWith("/quotations")) return "quotations";
  if (pth.startsWith("/invoices")) return "invoices";
  if (pth.startsWith("/payments")) return "balances";
  if (pth.startsWith("/receipts")) return "receipts";
  if (pth.startsWith("/accounts")) return "accounts";
  if (pth.startsWith("/customers")) return "customers";
  if (pth.startsWith("/carpenters")) return "carpenters";
  if (pth.startsWith("/rent")) return "rent";
  if (pth.startsWith("/buys") || pth.startsWith("/suppliers")) return "suppliers";
  if (pth.startsWith("/contacts")) return "contacts";
  if (pth.startsWith("/expenses")) return "daybook";
  if (pth.startsWith("/books")) return "books";
  if (pth.startsWith("/logs") || pth.startsWith("/statements")) return "logs";
  if (pth.startsWith("/attendance")) return "attendance";
  if (pth.startsWith("/settings")) return "settings";
  if (pth.startsWith("/stock")) return "stock";
  if (pth.startsWith("/reports")) return "reports";
  if (pth.startsWith("/transactions")) return "dashboard";
  return "other";
}

/**
 * Resolve predetermined commands for the current route.
 * Editor with an open Doc uses document-specific actions (reminders with real ₹).
 */
export function resolveAiPageActions(pathname: string, doc: Doc | null): AiPageBundle {
  const key = pathKey(pathname);

  if (key === "editor" && doc) {
    return {
      title: doc.kind === "invoice" ? "This invoice" : "This quotation",
      contextLabel: undefined, // AiFab fills from doc facts
      actions: docQuickActions(doc),
    };
  }

  switch (key) {
    case "dashboard":
      return { title: "Dashboard", actions: dashboardActions() };
    case "balances":
      return { title: "Balances", actions: balancesActions() };
    case "receipts":
      return { title: "Receipts", actions: receiptsActions() };
    case "accounts":
      return { title: "Accounts", actions: accountsActions() };
    case "editor":
      return { title: "Quotation", actions: quotationHubActions() };
    case "quotations":
      return { title: "Quotations", actions: quotationsListActions() };
    case "customers": {
      const m = pathname.match(/^\/customers\/([^/]+)/);
      return {
        title: m ? "Customer" : "Customers",
        actions: customersActions(),
      };
    }
    case "rent": {
      const onPerson = /\/rent\/[^/]+/.test(pathname);
      return {
        title: onPerson ? "Tenant" : "Rent",
        actions: [
          explain("What is Rent?", "Cut Size place rent for two people (Ismail and Suresha). Two cards on top. Tap a card to open that person, the same way you open a carpenter or a customer. History for both sits under the cards."),
          how("Set monthly rent", "Rent → tap the person → Usual monthly ₹ on the year list → Save."),
          how("Set old balance", "Rent → tap the person → Old balance → Save old balance. This replaces what they already owe."),
          how("Tick a month", "Rent → tap the person → 12 month names. Tick the box after the month you want on the due. Any day is fine — it is not tied to today's date. Does not put cash in Daybook."),
          how("Untick a month", "Rent → tap the person → tick a month that already has a mark → Remove tick."),
          how("Record rent they paid", "Rent → tap the person → 1 They paid rent. Full, Part, or type an amount (₹5,000 of what they owe). Cash goes to Daybook and Receipts."),
          how("Put commission towards rent", "Rent → tap the person → 2 Commission towards rent. On a locked quotation for Ismail or Suresha the same card appears under Commission lock. Towards rent is not cash; leftover cash commission goes to Daybook."),
        ],
      };
    }
    case "carpenters": {
      const m = pathname.match(/^\/carpenters\/([^/]+)/);
      return {
        title: m ? "Carpenter" : "Carpenters",
        actions: [
          explain("What is Carpenters?", "Cut Size list of carpenters (Who) plus Commission: pending locks, paid totals, and payout history."),
          how("Add a carpenter", "Carpenters → + Add carpenter → name, phone, alternative number, village, city, photo (Take photo or From phone)."),
          how("Call a carpenter", "Carpenters → Who card → Call (opens the phone dialer). WhatsApp beside it opens chat."),
          how("Edit a carpenter", "Carpenters → Who card → Edit. Delete is inside that Edit dialog. Tap the card for commission paid, wood they bought, and quotations they brought."),
          how("Carpenter photo", "On Who, tap the Photo circle. On a carpenter page use Take photo or From phone. Saved on the contact; compressed so it syncs."),
          how("See who / paid / customers", "Carpenters → Who is the card list. Commission has pending, the roster, and payout history. Open a card or row for that person."),
          how("Transaction history", "Carpenters → Commission, and each carpenter page, list commission we paid — date, customer, quote, amount. Other spends stay in Receipts."),
          how("Record commission", "Carpenters → Record commission, or a carpenter → Record commission (Receipts Paid out → Carpenter commission)."),
          draft("Intro to carpenter", "WhatsApp intro to a carpenter about timber supply from our yard — [Carpenter name]"),
        ],
      };
    }
    case "suppliers":
      return { title: cutSize() ? "Suppliers" : "Suppliers", actions: suppliersActions() };
    case "contacts":
      return { title: "Contacts", actions: contactsActions() };
    case "daybook":
      return { title: "Daybook", actions: daybookActions() };
    case "books":
      return { title: "Books", actions: booksActions() };
    case "logs":
      return { title: "Logs", actions: logsActions() };
    case "attendance":
      return { title: "Attendance", actions: attendanceActions() };
    case "settings":
      return { title: "Settings", actions: settingsActions() };
    case "invoices":
      return { title: "Invoices", actions: invoicesActions() };
    case "stock":
      return { title: "Stock", actions: stockActions() };
    case "reports":
      return { title: "Reports", actions: reportsActions() };
    default:
      return { title: "Yard help", actions: genericQuickActions() };
  }
}
