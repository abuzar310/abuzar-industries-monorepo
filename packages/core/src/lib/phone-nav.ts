import type { AppFeatures, Tab, TabGroup } from "./types";

export type PhoneSection = TabGroup;

export function phoneShelves(tabs: Tab[], isOwner: boolean) {
  const visible = tabs.filter((t) => (!t.owner || isOwner) && t.href !== "/");
  const of = (g: PhoneSection) => visible.filter((t) => (t.group || "more") === g);
  let money = of("money");
  let business = of("business");
  const records = of("records");
  const more = of("more");
  // Manager has no Money tab — operational cash (receipts / balances) sits in Business.
  if (!isOwner) {
    business = [...business, ...money];
    money = [];
  }
  return { money, business, records, more };
}

export function phoneBar(shelves: ReturnType<typeof phoneShelves>, isOwner: boolean) {
  const items: { id: "home" | PhoneSection; label: string }[] = [{ id: "home", label: "Home" }];
  if (isOwner && shelves.money.length) items.push({ id: "money", label: "Money" });
  if (shelves.business.length) items.push({ id: "business", label: "Business" });
  if (shelves.records.length) items.push({ id: "records", label: "Records" });
  items.push({ id: "more", label: "More" });
  return items;
}

export function phoneSectionOf(tabs: Tab[], href: string): PhoneSection | "home" {
  if (!href || href === "/") return "home";
  if (href === "/money" || href.startsWith("/money/")) return "money";
  if (href === "/business" || href.startsWith("/business/")) return "business";
  if (href === "/records" || href.startsWith("/records/")) return "records";
  if (href === "/more" || href.startsWith("/more/")) return "more";
  const t = tabs.find((x) => x.href === href || (href.startsWith(x.href + "/") && x.href !== "/"));
  return (t?.group as PhoneSection) || "more";
}

export function phoneQuickActions(feat: AppFeatures) {
  const out: { href: string; label: string }[] = [{ href: "/editor", label: "New quotation" }];
  if (feat.acceptPayment) out.push({ href: "/receipts", label: "Receipt" });
  out.push({ href: "/customers", label: "Customer" });
  if (feat.simpleQuote) out.push({ href: "/expenses", label: "Daybook" });
  return out;
}
