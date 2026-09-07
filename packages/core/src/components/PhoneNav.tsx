"use client";
import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconBag, IconClipboardList, IconHome, IconWallet } from "@/components/Icons";
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
      {path !== "/" && (
        <Link className="phone-fab" href="/editor" aria-label="New quotation">+</Link>
      )}
      <nav className={"phone-tabs phone-tabs-" + bar.length} aria-label="Phone">
        {bar.map((t) => {
          const on = t.id === "home" ? path === "/" : here === t.id;
          return (
            <Link key={t.id} href={HREF[t.id]} className={on ? "on" : ""}>
              <span aria-hidden>
                {t.id === "home" && <IconHome size={20} />}
                {t.id === "money" && <IconWallet size={20} />}
                {t.id === "business" && <IconBag size={20} />}
                {t.id === "records" && <IconClipboardList size={20} />}
                {t.id === "more" && <span className="phone-more-ico" />}
              </span>
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
