// Run: npx tsx packages/core/src/lib/phone-nav.check.ts
import { phoneBar, phoneQuickActions, phoneSectionOf, phoneShelves, phoneTabIcon } from "./phone-nav";
import type { Tab } from "./types";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

const tabs: Tab[] = [
  { label: "Dashboard", href: "/" },
  { label: "Balances", href: "/payments", group: "money" },
  { label: "Receipts", href: "/receipts", group: "money" },
  { label: "Books", href: "/books", owner: true, group: "money" },
  { label: "Quotations", href: "/quotations", group: "business" },
  { label: "Daybook", href: "/expenses", group: "records" },
  { label: "Settings", href: "/settings", owner: true, group: "more" },
];

const owner = phoneShelves(tabs, true);
ok(owner.money.map((t) => t.href).join() === "/payments,/receipts,/books", "owner money");
ok(phoneBar(owner, true).map((t) => t.id).join() === "home,money,business,records,more", "owner bar");

const mgr = phoneShelves(tabs, false);
ok(mgr.money.length === 0, "manager has no money shelf");
ok(mgr.business.some((t) => t.href === "/receipts") && !mgr.business.some((t) => t.href === "/books"), "manager money ops in business, no books");
ok(phoneBar(mgr, false).map((t) => t.id).join() === "home,business,records,more", "manager bar");
ok(phoneSectionOf(tabs, "/receipts") === "money", "section of receipts");
ok(phoneSectionOf(tabs, "/money") === "money", "money page");
ok(phoneSectionOf(tabs, "/business") === "business", "business page");
ok(phoneQuickActions({ invoices: false, simpleQuote: true, acceptPayment: true }).length === 5, "cut-size quick actions");
ok(phoneQuickActions({ invoices: true, simpleQuote: false, acceptPayment: false }).length === 2, "official quick actions");
ok(phoneQuickActions({ invoices: false, simpleQuote: true, acceptPayment: true })[0].href === "/editor", "quote is first quick action");
ok(!!phoneTabIcon("/receipts") && !!phoneTabIcon("/stock"), "shelf icons");

console.log(`phone-nav.check OK (${n} assertions)`);
