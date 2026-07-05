import type { AppFeatures, Tab } from "@/lib/types";

// Unofficial app (Ajju's daily book): quotations + customers + daybook.
// No invoices, no ledger, no stock.
export const FEATURES: AppFeatures = { invoices: false, simpleQuote: true, acceptPayment: true };

// Isolated data namespace — Safa (Cut Size Wood) never shares tables/DB with Abuzar.
export const CLOUD_PREFIX = "sf_";

export const TABS: Tab[] = [
  { label: "Dashboard", href: "/" },
  { label: "Balances", href: "/payments" },
  { label: "Receipts", href: "/receipts" },
  { label: "Statements", href: "/statements" },
  { label: "Quotation", href: "/editor" },
  { label: "Quotations", href: "/quotations" },
  { label: "Customers", href: "/customers" },
  { label: "Daybook", href: "/expenses", badge: true },
  { label: "Settings", href: "/settings", owner: true },
];
