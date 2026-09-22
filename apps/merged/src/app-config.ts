import type { AppFeatures, Tab } from "@/lib/types";

// Testing mix: Cut Size daybook + Official invoices/stock/tally.
// Data lives in the `merged` schema — never official or unofficial.
export const FEATURES: AppFeatures = {
  invoices: true,
  simpleQuote: true,
  acceptPayment: true,
  soloLogin: false,
  ledger: true,
  vouchers: false,
  carpenters: true,
};

export const TABS: Tab[] = [
  { label: "Dashboard", href: "/" },
  { label: "Balances", href: "/payments", group: "money" },
  { label: "Receipts", href: "/receipts", group: "money" },
  { label: "Accounts", href: "/accounts", group: "money" },
  { label: "Books", href: "/books", owner: true, group: "money" },
  { label: "Quotation", href: "/editor", group: "business" },
  { label: "Quotations", href: "/quotations", group: "business" },
  { label: "Website Quotations", href: "/website-quotations", badge: "website", group: "business" },
  { label: "Invoices", href: "/invoices", group: "business" },
  { label: "Customers", href: "/customers", group: "business" },
  { label: "Carpenters", href: "/carpenters", group: "business" },
  { label: "Rent", href: "/rent", group: "business" },
  { label: "Suppliers", href: "/suppliers", group: "business" },
  { label: "Suppliers", href: "/buys", owner: true, badge: "buys", group: "business" },
  { label: "Daybook", href: "/expenses", badge: true, group: "records" },
  { label: "Attendance", href: "/attendance", group: "records" },
  { label: "Logs", href: "/logs", owner: true, group: "records" },
  { label: "Tally", href: "/tally", group: "records" },
  { label: "Stock", href: "/stock", group: "records" },
  { label: "Contacts", href: "/contacts", owner: true, icon: "customers", group: "more" },
  { label: "AI", href: "/ai", group: "more" },
  { label: "Excel", href: "/excel", owner: true, icon: "squares", group: "more" },
  { label: "Reports", href: "/reports", group: "more" },
  { label: "Settings", href: "/settings", owner: true, group: "more" },
];
