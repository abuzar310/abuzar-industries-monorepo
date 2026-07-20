import type { AppFeatures, Tab } from "@/lib/types";

// Official Abuzar Industries app: quotations -> invoices + stock/trading.
// No daybook, no ledger.
export const FEATURES: AppFeatures = { invoices: true, simpleQuote: false, acceptPayment: false, soloLogin: true, ledger: true };

// Data isolation lives server-side: this app's API routes use the "official" schema.

export const TABS: Tab[] = [
  { label: "Dashboard", href: "/" },
  { label: "Quotation", href: "/editor" },
  { label: "Quotations", href: "/quotations" },
  { label: "Invoices", href: "/invoices" },
  { label: "Customers", href: "/customers" },
  { label: "Suppliers", href: "/suppliers" },
  { label: "Stock", href: "/stock" },
  { label: "Reports", href: "/reports" },
  { label: "Ledger", href: "/ledger" },
  { label: "Settings", href: "/settings", owner: true },
];
