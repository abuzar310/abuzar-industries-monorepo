"use client";

// Heartwood icon set — 24×24, 1.75 stroke, round caps. `currentColor`.
// Decorative: parents already have visible text / aria-label, so no <title>.

type Props = { size?: number; className?: string };
type NavProps = Props & { filled?: boolean };

function glyph(size = 18, className: string | undefined, stroke: number, children: React.ReactNode) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
      style={{ flexShrink: 0 }}
    >
      {Array.isArray(children)
        ? children.map((c, i) => <g key={i}>{c}</g>)
        : children}
    </svg>
  );
}

function base(_title: string, size = 18, className?: string, ...children: React.ReactNode[]) {
  return glyph(size, className, 1.75, children);
}

function nav(size = 22, className: string | undefined, filled: boolean | undefined, children: React.ReactNode) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={1.85}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
      style={{ flexShrink: 0 }}
    >
      {children}
    </svg>
  );
}

// ── Navigation ───────────────────────────────────────────────────────────────

export function IconHome({ size = 18, className }: Props) {
  return base("Home", size, className,
    <path d="M4 11 12 4l8 7" />,
    <path d="M6 10.2V20h4.2v-6.2h3.6V20H18V10.2" />,
  );
}

export function IconNavHome({ size = 22, className, filled }: NavProps) {
  return nav(size, className, filled, filled ? (
    <path d="M12 3.5 3.8 10.7V20h6.3v-6.1h3.8V20h6.3v-9.3z" />
  ) : (
    <>
      <path d="M4 11 12 4l8 7" />
      <path d="M6 10.2V20h4.2v-6.2h3.6V20H18V10.2" />
    </>
  ));
}

export function IconNavMoney({ size = 22, className, filled }: NavProps) {
  return nav(size, className, filled, (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="3" />
      <path
        d="M8 9h8M8 12.2h8M11.2 9c2.4 0 4 1.15 4 2.85s-1.6 2.85-4 2.85H8L14.6 19"
        fill="none"
        stroke={filled ? "var(--panel-2)" : "currentColor"}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ));
}

export function IconNavBusiness({ size = 22, className, filled }: NavProps) {
  return nav(size, className, filled, (
    <>
      <rect x="3" y="8" width="18" height="12.5" rx="2.2" />
      <path d="M8 8V6.2A2.2 2.2 0 0 1 10.2 4h3.6A2.2 2.2 0 0 1 16 6.2V8" fill="none" stroke="currentColor" />
      <path d="M3 13h18" stroke={filled ? "var(--panel-2)" : "currentColor"} fill="none" />
    </>
  ));
}

export function IconNavRecords({ size = 22, className, filled }: NavProps) {
  return nav(size, className, filled, filled ? (
    <>
      <path d="M8.6 4.4h8.8A2.2 2.2 0 0 1 19.6 6.6v1.4H7.2V6.6A2.2 2.2 0 0 1 8.6 4.4z" />
      <path d="M6.2 8.6h13.2V19a2.2 2.2 0 0 1-2.2 2.2H8.4A2.2 2.2 0 0 1 6.2 19z" />
      <path d="M9.4 12.2h5.8M9.4 15.4h4.2" fill="none" stroke="var(--panel-2)" strokeWidth={1.6} />
    </>
  ) : (
    <>
      <path d="M8 6.5h9.2A2.3 2.3 0 0 1 19.5 8.8V20H8.2A2.2 2.2 0 0 1 6 17.8V8.7A2.2 2.2 0 0 1 8.2 6.5Z" />
      <path d="M6.4 16.2V6.8A2.3 2.3 0 0 1 8.7 4.5h8.6" />
      <path d="M9.4 11h6.2M9.4 14.2h4.6" />
    </>
  ));
}

export function IconNavMore({ size = 22, className, filled }: NavProps) {
  const r = filled ? 1.7 : 1.35;
  return nav(size, className, false, (
    <>
      <circle cx="5.5" cy="12" r={r} fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r={r} fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r={r} fill="currentColor" stroke="none" />
    </>
  ));
}

export function IconBriefcase({ size = 18, className }: Props) {
  return base("Business", size, className,
    <rect x="3" y="8" width="18" height="12.5" rx="2.2" />,
    <path d="M8 8V6.2A2.2 2.2 0 0 1 10.2 4h3.6A2.2 2.2 0 0 1 16 6.2V8" />,
    <path d="M3 13h18" />,
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
    <rect x="2.5" y="6" width="19" height="13" rx="2.4" />,
    <path d="M2.5 10h19" />,
    <circle cx="16.5" cy="14.4" r="1.15" fill="currentColor" stroke="none" />,
  );
}

export function IconReceipt({ size = 18, className }: Props) {
  return base("Receipt", size, className,
    <path d="M7 3.5h10v17l-1.6-1-1.6 1-1.6-1-1.6 1-1.6-1-2 1z" />,
    <path d="M9.2 8h5.6M9.2 11.2h4.4M9.2 14.4h3.2" />,
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
    <path d="M14 3H7.2A2.2 2.2 0 0 0 5 5.2v13.6A2.2 2.2 0 0 0 7.2 21h9.6A2.2 2.2 0 0 0 19 18.8V8z" />,
    <path d="M14 3v5h5" />,
    <path d="M12 11.4v5.2M9.4 14h5.2" />,
  );
}

export function IconCustomers({ size = 18, className }: Props) {
  return base("Customers", size, className,
    <path d="M15.6 20.5v-1.6A3.4 3.4 0 0 0 12.2 15.5H5.8A3.4 3.4 0 0 0 2.4 18.9v1.6" />,
    <circle cx="9" cy="7.4" r="3.2" />,
    <path d="M21.6 20.5v-1.6a3.4 3.4 0 0 0-2.5-3.3" />,
    <path d="M15.4 4.4a3.1 3.1 0 0 1 0 6" />,
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
    <rect x="6" y="4.5" width="12" height="16.5" rx="2" />,
    <rect x="9" y="2.4" width="6" height="3.4" rx="1" />,
    <path d="M9 10.4h6M9 13.6h6M9 16.8h4" />,
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
    <path d="M7 3.5 4.4 8v11.2A1.8 1.8 0 0 0 6.2 21h11.6a1.8 1.8 0 0 0 1.8-1.8V8L17 3.5z" />,
    <path d="M4.4 8h15.2" />,
    <path d="M15.2 11.2a3.2 3.2 0 0 1-6.4 0" />,
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

export function IconSun({ size = 18, className }: Props) {
  return base("Morning", size, className,
    <circle cx="12" cy="12" r="4" />,
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />,
  );
}

export function IconEye({ size = 18, className }: Props) {
  return base("Show amounts", size, className,
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />,
    <circle cx="12" cy="12" r="3" />,
  );
}

export function IconEyeOff({ size = 18, className }: Props) {
  return base("Hide amounts", size, className,
    <path d="M3 3l18 18" />,
    <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />,
    <path d="M9.9 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a16 16 0 0 1-3.2 4.4" />,
    <path d="M6.1 6.1A16 16 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 4.2-.9" />,
  );
}

export function IconBell({ size = 18, className }: Props) {
  return base("Alerts", size, className,
    <path d="M6 8a6 6 0 1 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9" />,
    <path d="M10 21a2 2 0 0 0 4 0" />,
  );
}

export function IconSaw({ size = 18, className }: Props) {
  return base("Cut Size", size, className,
    <circle cx="9.2" cy="14.4" r="5.4" />,
    <circle cx="9.2" cy="14.4" r="1.5" />,
    <path d="M13.4 11.2 20 4.8" />,
    <path d="M16.2 4.5h4.2v4.2" />,
  );
}

export function IconDots({ size = 18, className }: Props) {
  return base("More", size, className,
    <circle cx="5.5" cy="12" r="1.35" fill="currentColor" stroke="none" />,
    <circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none" />,
    <circle cx="18.5" cy="12" r="1.35" fill="currentColor" stroke="none" />,
  );
}

export function IconRupee({ size = 18, className }: Props) {
  return base("Rupee", size, className,
    <path d="M7 5h10" />,
    <path d="M7 9h10" />,
    <path d="M11 5c3 0 5 1.5 5 4s-2 4-5 4H7l8 8" />,
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
  briefcase: IconBriefcase,
  ledger: IconLedger,
  plus: IconPlus,
  sun: IconSun,
  eye: IconEye,
  "eye-off": IconEyeOff,
  bell: IconBell,
  saw: IconSaw,
  dots: IconDots,
  rupee: IconRupee,
};

export function TabIcon({ icon, size = 16, className }: { icon?: string; size?: number; className?: string }) {
  if (!icon) return null;
  const Cmp = ICON_MAP[icon];
  if (!Cmp) return null;
  return <Cmp size={size} className={className} />;
}
