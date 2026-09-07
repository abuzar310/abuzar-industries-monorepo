"use client";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useApp } from "@/store/useApp";
import { setSearch, toast } from "@/store/app-store";
import { brandFor } from "@/lib/brand";
import { cloakAvailable, toggleCloak } from "@/lib/cloak";
import { isInvoiceId } from "@/lib/doc";
import { changePassword, lockApp } from "@/lib/local-auth";
import { canToggleCloak } from "@/lib/staff-role";
import { formDialog } from "@/store/dialog-store";
import { IconBell, TabIcon } from "@/components/Icons";
import type { Tab } from "@/lib/types";

function isActive(href: string, path: string) {
  if (href === "/") return path === "/";
  // Editing an invoice belongs to the Invoices tab, not Quotation. Invoice ids are short
  // numbers (or legacy "INV-…"); quotations are FY-sequence ids — see isInvoiceId.
  const m = path.match(/^\/editor\/(.+)$/);
  const editingInvoice = m ? isInvoiceId(decodeURIComponent(m[1])) : false;
  if (href === "/editor") return path === "/editor" || (path.startsWith("/editor/") && !editingInvoice);
  if (href === "/invoices") return path === "/invoices" || path.startsWith("/invoices/") || editingInvoice;
  return path === href || path.startsWith(href + "/");
}

// on = saved in the cloud · queue = a save is on its way · off = offline · local = still booting
const SYNC_LABEL = { on: "Synced", off: "Offline", queue: "Saving…", local: "Loading…" } as const;

export default function TopNav({ tabs }: { tabs: Tab[] }) {
  const TABS = tabs;
  const { syncState, searchTerm, user, brandMode, unseen, buysDue, websitePending, chatUnseen } = useApp();
  const path = usePathname();
  const router = useRouter();
  const isOwner = user?.role === "owner";
  /** Owner + Manager (CloakCapableStaff) — same core hide gesture */
  const mayCloak = cloakAvailable() && canToggleCloak(user?.role);
  const brand = brandFor(brandMode);

  const [userMenu, setUserMenu] = useState(false);
  /** mobile: 5 rapid taps on brand toggles money cloak (owner/manager · unofficial) */
  const brandTaps = useRef<{ n: number; t: number }>({ n: 0, t: 0 });
  useEffect(() => {
    if (!userMenu) return;
    const close = () => setUserMenu(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [userMenu]);

  function onSearch(value: string) {
    setSearch(value);
    if (!/^\/(quotations|invoices|customers|suppliers|buys|carpenters|contacts|rent)/.test(path)) router.push("/quotations");
  }

  function onBrandPointer(e: MouseEvent) {
    if (!mayCloak) return;
    // Shortcut (Mac Option / Windows Alt + click once) — same as 5 taps
    if (e.altKey) {
      e.preventDefault();
      brandTaps.current = { n: 0, t: 0 };
      void toggleCloak();
      return;
    }
    // Same on Mac web + phone: click/tap the brand name 5× quickly
    // (looks like impatient lag tapping — no labeled button)
    const now = Date.now();
    if (now - brandTaps.current.t > 1600) brandTaps.current = { n: 0, t: now };
    brandTaps.current.n += 1;
    brandTaps.current.t = now;
    if (brandTaps.current.n >= 5) {
      brandTaps.current = { n: 0, t: 0 };
      void toggleCloak();
    }
  }

  return (
    <div className="topnav">
      <div className="topnav-in">
        <div
          className="nav-brand"
          onClick={onBrandPointer}
          onContextMenu={(e) => {
            // block “Inspect” long-press menu from looking special on the brand
            if (mayCloak) e.preventDefault();
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="phone-logo" src="/icon.png" alt="" width={22} height={22} />
          {brand.name}
        </div>
        <div className="tabs">
          {TABS.filter((t) => !t.owner || isOwner).map((t) => {
            const active = isActive(t.href, path);
            const cls = "tab" + (active ? " active" : "");
            const badgeN =
              t.badge === "buys" ? buysDue
              : t.badge === "website" ? websitePending
              : t.badge === "chat" ? chatUnseen
              : t.badge ? unseen : 0;
            return (
              <Link key={t.href} href={t.href} className={cls}>
                {t.href === "/ai" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src="/icon.png" alt="" width={16} height={16} className="tab-favicon" />
                ) : (
                  <TabIcon icon={t.icon} size={16} />
                )}
                {t.label}
                {badgeN > 0 && <span className="tab-badge">{badgeN}</span>}
              </Link>
            );
          })}
        </div>
        <div className="navsearch">
          <input
            placeholder="Search name / phone / no."
            value={searchTerm}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
        <span className={"syncdot " + syncState}>
          <i />
          <span>{SYNC_LABEL[syncState]}</span>
        </span>
        {(() => {
          const n = (unseen || 0) + (websitePending || 0) + (buysDue || 0) + (chatUnseen || 0);
          const href = websitePending ? "/website-quotations" : buysDue ? "/buys" : "/quotations";
          return (
            <Link className={"phone-bell" + (n ? " on" : "")} href={href} aria-label={n ? n + " alerts" : "Alerts"}>
              <IconBell size={16} />
              {n > 0 && <b>{n}</b>}
            </Link>
          );
        })()}
        {user && (
          <div className="usermenu" onClick={(e) => e.stopPropagation()}>
            <button className="userchip" title={user.name} onClick={() => setUserMenu((v) => !v)}>
              <i>{user.name.charAt(0)}</i>
              <span className="userchip-name">{user.name}</span>
              <span className="userchip-role">{user.role === "owner" ? "Owner" : "Manager"}</span>
              <span className="um-caret">▾</span>
            </button>
            {userMenu && (
              <div className="usermenu-pop">
                <div className="um-head">
                  {user.name} · {user.role === "owner" ? "Owner" : "Manager"}
                </div>
                {user.role === "owner" && (
                  <button
                    className="um-item"
                    onClick={async () => {
                      setUserMenu(false);
                      const r = await formDialog({
                        title: "Change my password",
                        message: "New password for " + user.name,
                        fields: [
                          { name: "pw", label: "New password", type: "password", required: true },
                          { name: "pw2", label: "Confirm password", type: "password", required: true },
                        ],
                        submitLabel: "Update",
                      });
                      if (!r) return;
                      if ((r.pw || "").trim().length < 4) return toast("Use at least 4 characters");
                      if (r.pw !== r.pw2) return toast("Passwords don't match");
                      const ok = await changePassword(user.id, r.pw);
                      toast(ok ? "Password updated" : "Could not update — try again");
                    }}
                  >
                    Change password
                  </button>
                )}
                <button
                  className="um-logout"
                  onClick={() => {
                    setUserMenu(false);
                    lockApp();
                  }}
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
