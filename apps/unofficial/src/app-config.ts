import type { AppFeatures, Tab } from "@/lib/types";

// Unofficial app (Ajju's daily book): quotations + customers + daybook.
// No invoices, no ledger, no stock.
export const FEATURES: AppFeatures = { invoices: false, simpleQuote: true, acceptPayment: true };

// Data isolation lives server-side: this app's API routes use the "unofficial" schema.

export const TABS: Tab[] = [
  { label: "Dashboard", href: "/" },
  { label: "Balances", href: "/payments" },
  { label: "Receipts", href: "/receipts" },
  { label: "Accounts", href: "/accounts" },
  { label: "Quotation", href: "/editor" },
  { label: "Quotations", href: "/quotations" },
  { label: "Customers", href: "/customers" },
  { label: "Suppliers", href: "/buys", owner: true, badge: "buys" },
  { label: "Contacts", href: "/contacts", owner: true, icon: "customers" },
  { label: "Daybook", href: "/expenses", badge: true },
  { label: "Books", href: "/books", owner: true },
  { label: "Logs", href: "/logs", owner: true },
  { label: "Attendance", href: "/attendance" },
  { label: "Settings", href: "/settings", owner: true },
];
