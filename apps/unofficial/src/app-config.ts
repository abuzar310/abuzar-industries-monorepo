import type { AppFeatures, Tab } from "@/lib/types";

// Unofficial app (Ajju's daily book): quotations + customers + daybook.
// No invoices, no ledger, no stock.
export const FEATURES: AppFeatures = { invoices: false, simpleQuote: true, acceptPayment: true, carpenters: true };

// Data isolation lives server-side: this app's API routes use the "unofficial" schema.

export const TABS: Tab[] = [
  { label: "Dashboard", href: "/" },
  { label: "Balances", href: "/payments", group: "money" },
  { label: "Receipts", href: "/receipts", group: "money" },
  { label: "Accounts", href: "/accounts", group: "money" },
  { label: "Books", href: "/books", owner: true, group: "money" },
  { label: "Quotation", href: "/editor", group: "business" },
  { label: "Quotations", href: "/quotations", group: "business" },
  { label: "Website Quotations", href: "/website-quotations", badge: "website", group: "business" },
  { label: "Customers", href: "/customers", group: "business" },
  { label: "Carpenters", href: "/carpenters", group: "business" },
  { label: "Rent", href: "/rent", group: "business" },
  { label: "Suppliers", href: "/buys", owner: true, badge: "buys", group: "business" },
  { label: "Daybook", href: "/expenses", badge: true, group: "records" },
  { label: "Attendance", href: "/attendance", group: "records" },
  { label: "Logs", href: "/logs", owner: true, group: "records" },
  { label: "Contacts", href: "/contacts", owner: true, icon: "customers", group: "more" },
  { label: "AI", href: "/ai", group: "more" },
  { label: "Settings", href: "/settings", owner: true, group: "more" },
];
