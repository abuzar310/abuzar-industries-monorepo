"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { IconHome, TabIcon } from "@/components/Icons";
import { getFeatures } from "@/lib/features";
import { useApp } from "@/store/useApp";
import type { Tab, TabGroup } from "@/lib/types";

const ORDER: TabGroup[] = ["today", "paper", "money", "books", "people", "yard", "owner"];
const LABEL: Record<TabGroup, string> = {
  today: "Today",
  paper: "Paper",
  money: "Money",
  books: "Books",
  people: "People",
  yard: "Yard",
  owner: "Owner",
};

export default function PhoneNav({ tabs }: { tabs: Tab[] }) {
  const path = usePathname();
  const router = useRouter();
  const { user, unseen, buysDue, websitePending, chatUnseen } = useApp();
  const [more, setMore] = useState(false);
  const isOwner = user?.role === "owner";
  const home = path === "/";
  const feat = getFeatures();

  const shelves = useMemo(() => {
    const visible = tabs.filter((t) => !t.owner || isOwner);
    return ORDER.map((g) => ({
      g,
      items: visible.filter((t) => (t.group || "today") === g && t.href !== "/"),
    })).filter((s) => s.items.length);
  }, [tabs, isOwner]);

  function badge(t: Tab) {
    return t.badge === "buys" ? buysDue
      : t.badge === "website" ? websitePending
      : t.badge === "chat" ? chatUnseen
      : t.badge ? unseen : 0;
  }

  return (
    <div className="phone-chrome no-print">
      {home && (
        <button
          className="phone-fab"
          type="button"
          onClick={() => router.push("/editor")}
        >
          {feat.simpleQuote ? "Add New Quote" : "Add New Sale"}
        </button>
      )}
      {more && (
        <div className="phone-more" onClick={() => setMore(false)}>
          <div className="phone-more-card" onClick={(e) => e.stopPropagation()}>
            <div className="phone-more-title">More</div>
            {shelves.map((s) => (
              <div key={s.g} className="phone-shelf">
                <h3>{LABEL[s.g]}</h3>
                {s.items.map((t) => {
                  const n = badge(t);
                  return (
                    <Link key={t.href} href={t.href} className="phone-shelf-item" onClick={() => setMore(false)}>
                      <TabIcon icon={t.icon} size={18} />
                      <span>{t.label}</span>
                      {n > 0 && <em>{n}</em>}
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
      <nav className="phone-tabs">
        <Link href="/" className={home && !more ? "on" : ""} onClick={() => setMore(false)}>
          <IconHome size={20} />
          Home
        </Link>
        <button type="button" className={more ? "on" : ""} onClick={() => setMore((v) => !v)}>
          <span className="phone-more-ico" aria-hidden />
          More
        </button>
      </nav>
    </div>
  );
}
