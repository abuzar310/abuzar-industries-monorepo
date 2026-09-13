import type { AppFeatures, Tab } from "@/lib/types";

// Official Abuzar Industries app: quotations -> invoices + stock/trading.
// No daybook, no ledger.
// vouchers: false — hide Vouchers/Accounts nav + invoice Payments received for now (routes stay for later)
export const FEATURES: AppFeatures = { invoices: true, simpleQuote: false, acceptPayment: false, ledger: true, vouchers: false };

// Data isolation lives server-side: this app's API routes use the "official" schema.

export const TABS: Tab[] = [
  { label: "Dashboard", href: "/" },
  { label: "Quotation", href: "/editor", group: "business" },
  { label: "Quotations", href: "/quotations", group: "business" },
  { label: "Invoices", href: "/invoices", group: "business" },
  { label: "Customers", href: "/customers", group: "business" },
  { label: "Suppliers", href: "/suppliers", group: "business" },
  { label: "Stock", href: "/stock", group: "records" },
  { label: "Reports", href: "/reports", group: "more" },
  { label: "AI", href: "/ai", group: "more" },
  { label: "Settings", href: "/settings", owner: true, group: "more" },
];
