import type { AppFeatures, Tab } from "@/lib/types";

// Official Abuzar Industries app: quotations -> invoices + stock/trading.
// No daybook, no ledger.
// vouchers: false — hide Vouchers/Accounts nav + invoice Payments received for now (routes stay for later)
export const FEATURES: AppFeatures = { invoices: true, simpleQuote: false, acceptPayment: false, soloLogin: true, ledger: true, vouchers: false };

// Data isolation lives server-side: this app's API routes use the "official" schema.

export const TABS: Tab[] = [
  { label: "Dashboard", href: "/" },
  { label: "Quotation", href: "/editor" },
  { label: "Quotations", href: "/quotations" },
  { label: "Invoices", href: "/invoices" },
  { label: "Tally", href: "/tally" },
  // Vouchers + Accounts hidden for now — pages still at /vouchers and /accounts
  { label: "Customers", href: "/customers" },
  { label: "Suppliers", href: "/suppliers" },
  { label: "Stock", href: "/stock" },
  { label: "Reports", href: "/reports" },
  { label: "AI", href: "/ai" },
  // Chat tab removed — page still at /chat for direct access
  // Ledger tab removed from the nav — the pages still exist at /ledger for direct access
  { label: "Settings", href: "/settings", owner: true },
];
