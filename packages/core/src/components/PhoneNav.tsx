"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { IconBag, IconClipboardList, IconHome, IconWallet, TabIcon } from "@/components/Icons";
import { getFeatures } from "@/lib/features";
import { lockApp } from "@/lib/local-auth";
import { phoneBar, phoneQuickActions, phoneSectionOf, phoneShelves, type PhoneSection } from "@/lib/phone-nav";
import { useApp } from "@/store/useApp";
import type { Tab } from "@/lib/types";

const TITLE: Record<PhoneSection, string> = {
  money: "Money",
  business: "Business",
  records: "Records",
  more: "More",
};

export default function PhoneNav({ tabs }: { tabs: Tab[] }) {
  const path = usePathname();
  const router = useRouter();
  const { user, unseen, buysDue, websitePending, chatUnseen } = useApp();
  const [open, setOpen] = useState<PhoneSection | "qa" | null>(null);
  const isOwner = user?.role === "owner";
  const feat = getFeatures();
  const shelves = useMemo(() => phoneShelves(tabs, isOwner), [tabs, isOwner]);
  const bar = useMemo(() => phoneBar(shelves, isOwner), [shelves, isOwner]);
  const quick = useMemo(() => phoneQuickActions(feat), [feat]);
  const here = phoneSectionOf(tabs, path);
  if (!user) return null;

  function badge(t: Tab) {
    return t.badge === "buys" ? buysDue
      : t.badge === "website" ? websitePending
      : t.badge === "chat" ? chatUnseen
      : t.badge ? unseen : 0;
  }

  function goTab(id: "home" | PhoneSection) {
    if (id === "home") {
      setOpen(null);
      router.push("/");
      return;
    }
    setOpen((cur) => (cur === id ? null : id));
  }

  const sheet = open && open !== "qa" ? open : null;
  const items = sheet ? shelves[sheet] : [];

  return (
    <div className="phone-chrome no-print">
      <button
        className="phone-fab"
        type="button"
        aria-label="Quick actions"
        onClick={() => setOpen((cur) => (cur === "qa" ? null : "qa"))}
      >
        +
      </button>

      {open === "qa" && (
        <div className="phone-more" onClick={() => setOpen(null)}>
          <div className="phone-more-card" onClick={(e) => e.stopPropagation()}>
            <div className="phone-more-title">Quick actions</div>
            <div className="phone-shelf">
              {quick.map((q) => (
                <Link key={q.href} href={q.href} className="phone-shelf-item" onClick={() => setOpen(null)}>
                  <span>{q.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {sheet && (
        <div className="phone-more" onClick={() => setOpen(null)}>
          <div className="phone-more-card" onClick={(e) => e.stopPropagation()}>
            <div className="phone-more-title">{TITLE[sheet]}</div>
            <div className="phone-shelf">
              {items.map((t) => {
                const n = badge(t);
                return (
                  <Link key={t.href} href={t.href} className="phone-shelf-item" onClick={() => setOpen(null)}>
                    <TabIcon icon={t.icon} size={18} />
                    <span>{t.label}</span>
                    {n > 0 && <em>{n}</em>}
                  </Link>
                );
              })}
              {sheet === "more" && (
                <>
                  <button type="button" className="phone-shelf-item" onClick={() => { setOpen(null); lockApp(); }}>
                    Switch profile
                  </button>
                  <button type="button" className="phone-shelf-item" onClick={() => { setOpen(null); lockApp(); }}>
                    Log out
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <nav className={"phone-tabs phone-tabs-" + bar.length} aria-label="Phone">
        {bar.map((t) => {
          const on = t.id === "home"
            ? path === "/" && !open
            : open === t.id || (!open && here === t.id);
          return (
            <button
              key={t.id}
              type="button"
              className={on ? "on" : ""}
              onClick={() => goTab(t.id)}
            >
              <span aria-hidden>
                {t.id === "home" && <IconHome size={20} />}
                {t.id === "money" && <IconWallet size={20} />}
                {t.id === "business" && <IconBag size={20} />}
                {t.id === "records" && <IconClipboardList size={20} />}
                {t.id === "more" && <span className="phone-more-ico" />}
              </span>
              {t.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
