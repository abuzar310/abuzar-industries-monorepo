"use client";
import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TabIcon } from "@/components/Icons";
import { lockApp } from "@/lib/local-auth";
import { phoneShelves, type PhoneSection } from "@/lib/phone-nav";
import { useApp } from "@/store/useApp";
import type { Tab } from "@/lib/types";

const TITLE: Record<PhoneSection, string> = {
  money: "Money",
  business: "Business",
  records: "Records",
  more: "More",
};

export default function PhoneSectionView({ section, tabs }: { section: PhoneSection; tabs: Tab[] }) {
  const router = useRouter();
  const { user, unseen, buysDue, websitePending, chatUnseen } = useApp();
  const isOwner = user?.role === "owner";
  const items = useMemo(() => phoneShelves(tabs, isOwner)[section], [tabs, isOwner, section]);

  useEffect(() => {
    if (!user) return;
    if (section === "money" && !items.length) router.replace("/");
  }, [user, section, items.length, router]);

  function badge(t: Tab) {
    return t.badge === "buys" ? buysDue
      : t.badge === "website" ? websitePending
      : t.badge === "chat" ? chatUnseen
      : t.badge ? unseen : 0;
  }

  return (
    <div className="phone-sec">
      <h1 className="sectitle">{TITLE[section]}</h1>
      <div className="listwrap">
        {items.map((t) => {
          const n = badge(t);
          return (
            <Link key={t.href} href={t.href} className="lrow phone-sec-row">
              <TabIcon icon={t.icon} size={18} />
              <span className="nm">{t.label}</span>
              {n > 0 && <em>{n}</em>}
            </Link>
          );
        })}
        {section === "more" && (
          <>
            <button type="button" className="lrow phone-sec-row" onClick={() => lockApp()}>
              <span className="nm">Switch profile</span>
            </button>
            <button type="button" className="lrow phone-sec-row" onClick={() => lockApp()}>
              <span className="nm">Log out</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
