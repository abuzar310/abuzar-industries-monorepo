import type { AppFeatures, Tab } from "@/lib/types";

// Official Abuzar Industries app: quotations -> invoices + stock/trading.
// No daybook, no ledger.
export const FEATURES: AppFeatures = { invoices: true, simpleQuote: false, acceptPayment: false, soloLogin: true, ledger: true };

// Data isolation lives server-side: this app's API routes use the "official" schema.

export const TABS: Tab[] = [
  { label: "Dashboard", href: "/", icon: "home" },
  { label: "Quotation", href: "/editor", icon: "file-plus" },
  { label: "Quotations", href: "/quotations", icon: "clipboard" },
  { label: "Invoices", href: "/invoices", icon: "invoices" },
  { label: "Customers", href: "/customers", icon: "customers" },
  { label: "Suppliers", href: "/suppliers", icon: "truck" },
  { label: "Stock", href: "/stock", icon: "boxes" },
  { label: "Reports", href: "/reports", icon: "chart" },
  // Ledger tab removed from the nav — the pages still exist at /ledger for direct access
  { label: "Settings", href: "/settings", icon: "settings", owner: true },
];
