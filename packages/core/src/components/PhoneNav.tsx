"use client";
import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconNavBusiness, IconNavHome, IconNavMoney, IconNavMore, IconNavRecords } from "@/components/Icons";
import { phoneBar, phoneSectionOf, phoneShelves, type PhoneSection } from "@/lib/phone-nav";
import { useApp } from "@/store/useApp";
import type { Tab } from "@/lib/types";

const HREF: Record<"home" | PhoneSection, string> = {
  home: "/",
  money: "/money",
  business: "/business",
  records: "/records",
  more: "/more",
};

const ICO: Record<"home" | PhoneSection, typeof IconNavHome> = {
  home: IconNavHome,
  money: IconNavMoney,
  business: IconNavBusiness,
  records: IconNavRecords,
  more: IconNavMore,
};

export default function PhoneNav({ tabs }: { tabs: Tab[] }) {
  const path = usePathname();
  const { user } = useApp();
  const isOwner = user?.role === "owner";
  const shelves = useMemo(() => phoneShelves(tabs, isOwner), [tabs, isOwner]);
  const bar = useMemo(() => phoneBar(shelves, isOwner), [shelves, isOwner]);
  const here = path === "/money" || path === "/business" || path === "/records" || path === "/more"
    ? (path.slice(1) as PhoneSection)
    : phoneSectionOf(tabs, path);
  if (!user) return null;

  return (
    <div className="phone-chrome no-print">
      <nav className={"phone-tabs phone-tabs-" + bar.length} aria-label="Primary">
        {bar.map((t) => {
          const on = t.id === "home" ? path === "/" : here === t.id;
          const Ico = ICO[t.id];
          return (
            <Link key={t.id} href={HREF[t.id]} className={on ? "on" : ""} aria-current={on ? "page" : undefined}>
              <Ico size={22} filled={on} />
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
