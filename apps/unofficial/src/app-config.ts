import type { AppFeatures, Tab } from "@/lib/types";

// Unofficial app (Ajju's daily book): quotations + customers + daybook.
// No invoices, no ledger, no stock.
export const FEATURES: AppFeatures = { invoices: false, simpleQuote: true, acceptPayment: true };

// Data isolation lives server-side: this app's API routes use the "unofficial" schema.

export const TABS: Tab[] = [
  { label: "Dashboard", href: "/", icon: "home" },
  { label: "Transactions", href: "/transactions", icon: "transactions", badge: true },
  { label: "Balances", href: "/payments", icon: "scale" },
  { label: "Receipts", href: "/receipts", icon: "receipt" },
  { label: "Statements", href: "/statements", icon: "statement" },
  { label: "Accounts", href: "/accounts", icon: "building" },
  { label: "Quotation", href: "/editor", icon: "file-plus" },
  { label: "Quotations", href: "/quotations", icon: "clipboard" },
  { label: "Customers", href: "/customers", icon: "customers" },
  { label: "Daybook", href: "/expenses", icon: "book", badge: true },
  { label: "Attendance", href: "/attendance", icon: "calendar" },
  { label: "Settings", href: "/settings", icon: "settings", owner: true },
];
