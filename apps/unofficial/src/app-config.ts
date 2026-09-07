import type { AppFeatures, Tab } from "@/lib/types";

// Unofficial app (Ajju's daily book): quotations + customers + daybook.
// No invoices, no ledger, no stock.
export const FEATURES: AppFeatures = { invoices: false, simpleQuote: true, acceptPayment: true, carpenters: true };

// Data isolation lives server-side: this app's API routes use the "unofficial" schema.

export const TABS: Tab[] = [
  { label: "Dashboard", href: "/", group: "today" },
  { label: "Balances", href: "/payments", group: "money" },
  { label: "Receipts", href: "/receipts", group: "money" },
  { label: "Accounts", href: "/accounts", group: "money" },
  { label: "Quotation", href: "/editor", group: "paper" },
  { label: "Quotations", href: "/quotations", group: "paper" },
  { label: "Website Quotations", href: "/website-quotations", badge: "website", group: "paper" },
  { label: "Customers", href: "/customers", group: "people" },
  { label: "Carpenters", href: "/carpenters", group: "people" },
  { label: "Rent", href: "/rent", group: "yard" },
  { label: "Suppliers", href: "/buys", owner: true, badge: "buys", group: "yard" },
  { label: "Contacts", href: "/contacts", owner: true, icon: "customers", group: "people" },
  { label: "Daybook", href: "/expenses", badge: true, group: "today" },
  { label: "Books", href: "/books", owner: true, group: "money" },
  { label: "Logs", href: "/logs", owner: true, group: "owner" },
  { label: "Attendance", href: "/attendance", group: "people" },
  { label: "AI", href: "/ai", group: "owner" },
  // Chat tab removed — page still at /chat for direct access
  { label: "Settings", href: "/settings", owner: true, group: "owner" },
];
