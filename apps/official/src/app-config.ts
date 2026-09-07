import type { AppFeatures, Tab } from "@/lib/types";

// Official Abuzar Industries app: quotations -> invoices + stock/trading.
// No daybook, no ledger.
// vouchers: false — hide Vouchers/Accounts nav + invoice Payments received for now (routes stay for later)
export const FEATURES: AppFeatures = { invoices: true, simpleQuote: false, acceptPayment: false, soloLogin: true, ledger: true, vouchers: false };

// Data isolation lives server-side: this app's API routes use the "official" schema.

export const TABS: Tab[] = [
  { label: "Dashboard", href: "/", group: "today" },
  { label: "Quotation", href: "/editor", group: "paper" },
  { label: "Quotations", href: "/quotations", group: "paper" },
  { label: "Invoices", href: "/invoices", group: "paper" },
  // Vouchers + Accounts hidden for now — pages still at /vouchers and /accounts
  { label: "Customers", href: "/customers", group: "people" },
  { label: "Suppliers", href: "/suppliers", group: "people" },
  { label: "Stock", href: "/stock", group: "books" },
  { label: "Reports", href: "/reports", group: "books" },
  { label: "AI", href: "/ai", group: "owner" },
  // Chat tab removed — page still at /chat for direct access
  // Ledger tab removed from the nav — the pages still exist at /ledger for direct access
  { label: "Settings", href: "/settings", owner: true, group: "owner" },
];
