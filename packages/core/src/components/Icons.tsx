"use client";

// High-quality SVG icon set — 24×24 viewBox, 1.5px stroke, round caps/joins.
// Every icon includes a <title> for accessibility and uses `currentColor`
// so it inherits the surrounding text colour. Designed to be crisp at 14–20px.
//
// Style: Lucide-inspired — clean, minimal, instantly readable at small sizes.
// Each component stands alone so unused ones tree-shake away.

type Props = { size?: number; className?: string };

function base(title: string, size = 18, className?: string, ...children: React.ReactNode[]) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flexShrink: 0 }}
    >
      <title>{title}</title>
      <g>{children.map((c, i) => <g key={i}>{c}</g>)}</g>
    </svg>
  );
}

// ── Navigation ───────────────────────────────────────────────────────────────

export function IconHome({ size = 18, className }: Props) {
  return base("Home", size, className,
    <path d="M3 12L12 3l9 9" />,
    <path d="M5 10v9a1 1 0 0 0 1 1h3v-5h6v5h3a1 1 0 0 0 1-1v-9" />,
    <path d="M9 21V12h6v9" />,
  );
}

/** Arrows left-right + ₹ for money in/out — the universal "transactions" signal. */
export function IconTransactions({ size = 18, className }: Props) {
  return base("Transactions", size, className,
    <path d="M8 3L4 7l4 4" />,
    <path d="M16 21l4-4-4-4" />,
    <path d="M4 7h16" />,
    <path d="M20 17H4" />,
    <circle cx="12" cy="12" r="1" fill="currentColor" />,
  );
}

export function IconWallet({ size = 18, className }: Props) {
  return base("Wallet", size, className,
    <rect x="1" y="5" width="22" height="14" rx="2" ry="2" />,
    <circle cx="17" cy="12" r="1.5" fill="currentColor" />,
    <path d="M1 9h22" />,
  );
}

export function IconReceipt({ size = 18, className }: Props) {
  return base("Receipt", size, className,
    <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z" />,
    <path d="M8 7h8" />,
    <path d="M8 11h6" />,
    <path d="M8 15h4" />,
  );
}

export function IconFileText({ size = 18, className }: Props) {
  return base("Documents", size, className,
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />,
    <polyline points="14 2 14 8 20 8" />,
    <line x1="8" y1="13" x2="16" y2="13" />,
    <line x1="8" y1="17" x2="14" y2="17" />,
  );
}

export function IconFilePlus({ size = 18, className }: Props) {
  return base("New Document", size, className,
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />,
    <polyline points="14 2 14 8 20 8" />,
    <line x1="12" y1="11" x2="12" y2="17" />,
    <line x1="9" y1="14" x2="15" y2="14" />,
  );
}

export function IconCustomers({ size = 18, className }: Props) {
  return base("Customers", size, className,
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />,
    <circle cx="9" cy="7" r="4" />,
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />,
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />,
  );
}

export function IconBook({ size = 18, className }: Props) {
  return base("Daybook", size, className,
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />,
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />,
    <line x1="8" y1="7" x2="16" y2="7" />,
    <line x1="8" y1="11" x2="14" y2="11" />,
  );
}

export function IconClipboardList({ size = 18, className }: Props) {
  return base("Quotations List", size, className,
    <rect x="3" y="3" width="18" height="20" rx="2" ry="2" />,
    <line x1="9" y1="9" x2="15" y2="9" />,
    <line x1="9" y1="13" x2="15" y2="13" />,
    <line x1="9" y1="17" x2="13" y2="17" />,
    <path d="M9 3v2h6V3" />,
  );
}

export function IconSettings({ size = 18, className }: Props) {
  return base("Settings", size, className,
    <circle cx="12" cy="12" r="3" />,
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />,
  );
}

export function IconInvoices({ size = 18, className }: Props) {
  return base("Invoices", size, className,
    <rect x="4" y="3" width="16" height="20" rx="2" />,
    <line x1="8" y1="9" x2="16" y2="9" />,
    <line x1="8" y1="13" x2="14" y2="13" />,
    <line x1="8" y1="17" x2="12" y2="17" />,
    <path d="M14 3v3a1 1 0 0 0 1 1h3" />,
  );
}

export function IconTruck({ size = 18, className }: Props) {
  return base("Suppliers", size, className,
    <rect x="1" y="3" width="15" height="13" rx="1" />,
    <circle cx="5" cy="18" r="2" />,
    <circle cx="16" cy="18" r="2" />,
    <path d="M16 8h3l3 3v5h-6V8z" />,
  );
}

export function IconBoxes({ size = 18, className }: Props) {
  return base("Stock", size, className,
    <path d="M21 7v10l-9 4-9-4V7l9-4 9 4z" />,
    <path d="M3 7l9 4 9-4" />,
    <path d="M12 18V11" />,
  );
}

export function IconChart({ size = 18, className }: Props) {
  return base("Reports", size, className,
    <line x1="18" y1="20" x2="18" y2="10" />,
    <line x1="12" y1="20" x2="12" y2="4" />,
    <line x1="6" y1="20" x2="6" y2="14" />,
  );
}

// ── Additional high-quality icons ─────────────────────────────────────────────

export function IconEdit({ size = 18, className }: Props) {
  return base("Edit", size, className,
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />,
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />,
  );
}

/** Calendar with check — perfect for Attendance. */
export function IconCalendarCheck({ size = 18, className }: Props) {
  return base("Attendance", size, className,
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />,
    <line x1="3" y1="10" x2="21" y2="10" />,
    <line x1="8" y1="2" x2="8" y2="6" />,
    <line x1="16" y1="2" x2="16" y2="6" />,
    <polyline points="9 16 11 18 15 14" />,
  );
}

/** Building with columns — for Accounts. */
export function IconBuilding({ size = 18, className }: Props) {
  return base("Accounts", size, className,
    <rect x="4" y="2" width="16" height="20" rx="1" />,
    <line x1="9" y1="6" x2="9" y2="10" />,
    <line x1="15" y1="6" x2="15" y2="10" />,
    <line x1="9" y1="14" x2="9" y2="18" />,
    <line x1="15" y1="14" x2="15" y2="18" />,
    <line x1="4" y1="22" x2="20" y2="22" />,
  );
}

/** Balance scale — for Balances. */
export function IconScale({ size = 18, className }: Props) {
  return base("Balances", size, className,
    <line x1="12" y1="2" x2="12" y2="6" />,
    <path d="M3 22h18" />,
    <path d="M4 22l3-12h2l3 12" />,
    <path d="M12 22l3-12h2l3 12" />,
  );
}

/** Document with columns + numbers — for Statements. */
export function IconStatement({ size = 18, className }: Props) {
  return base("Statement", size, className,
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />,
    <polyline points="14 2 14 8 20 8" />,
    <path d="M7 12h3" />,
    <path d="M14 12h3" />,
    <path d="M7 16h6" />,
    <path d="M14 16h3" />,
  );
}

/** Two receipts / money arrows — for Payments. */
export function IconPayments({ size = 18, className }: Props) {
  return base("Payments", size, className,
    <path d="M14 12l-2 2-2-2" />,
    <path d="M12 14V4" />,
    <path d="M8 8l2-2 2 2" />,
    <rect x="4" y="16" width="16" height="5" rx="1" />,
    <path d="M4 21v-8" />,
    <path d="M20 21v-8" />,
  );
}

/** Shopping bag — for Purchase Entry. */
export function IconBag({ size = 18, className }: Props) {
  return base("Purchase", size, className,
    <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />,
    <line x1="3" y1="6" x2="21" y2="6" />,
    <path d="M16 10a4 4 0 0 1-8 0" />,
  );
}

/** Ledger journal lines. */
export function IconLedger({ size = 18, className }: Props) {
  return base("Ledger", size, className,
    <path d="M4 2h16v20H4z" />,
    <line x1="4" y1="6" x2="20" y2="6" />,
    <line x1="8" y1="10" x2="16" y2="10" />,
    <line x1="8" y1="14" x2="18" y2="14" />,
    <line x1="8" y1="18" x2="14" y2="18" />,
  );
}

/** Rounded plus — generic add/create. */
export function IconPlus({ size = 18, className }: Props) {
  return base("Add", size, className,
    <circle cx="12" cy="12" r="10" />,
    <line x1="12" y1="8" x2="12" y2="16" />,
    <line x1="8" y1="12" x2="16" y2="12" />,
  );
}

// ── Icon key → component mapping ─────────────────────────────────────────────

export const ICON_MAP: Record<string, React.FC<Props>> = {
  home: IconHome,
  transactions: IconTransactions,
  wallet: IconWallet,
  receipt: IconReceipt,
  "file-text": IconFileText,
  "file-plus": IconFilePlus,
  customers: IconCustomers,
  book: IconBook,
  clipboard: IconClipboardList,
  settings: IconSettings,
  invoices: IconInvoices,
  truck: IconTruck,
  boxes: IconBoxes,
  chart: IconChart,
  edit: IconEdit,
  calendar: IconCalendarCheck,
  building: IconBuilding,
  scale: IconScale,
  statement: IconStatement,
  payments: IconPayments,
  bag: IconBag,
  ledger: IconLedger,
  plus: IconPlus,
};

export function TabIcon({ icon, size = 16, className }: { icon?: string; size?: number; className?: string }) {
  if (!icon) return null;
  const Cmp = ICON_MAP[icon];
  if (!Cmp) return null;
  return <Cmp size={size} className={className} />;
}
