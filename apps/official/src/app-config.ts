import type { AppFeatures, Tab } from "@/lib/types";

// Official Abuzar Industries app: quotations -> invoices + stock/trading.
// No daybook, no ledger.
export const FEATURES: AppFeatures = { invoices: true, simpleQuote: false, acceptPayment: false };

export const TABS: Tab[] = [
  { label: "Dashboard", href: "/" },
  { label: "Quotation", href: "/editor" },
  { label: "Quotations", href: "/quotations" },
  { label: "Invoices", href: "/invoices" },
  { label: "Customers", href: "/customers" },
  { label: "Stock", href: "/stock" },
  { label: "Settings", href: "/settings", owner: true },
];
