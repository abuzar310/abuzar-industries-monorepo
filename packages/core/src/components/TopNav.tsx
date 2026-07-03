"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useApp } from "@/store/useApp";
import { setSearch, toast } from "@/store/app-store";
import { brandFor } from "@/lib/brand";
import { changePassword, lockApp } from "@/lib/local-auth";
import { formDialog } from "@/store/dialog-store";
import type { Tab } from "@/lib/types";

function isActive(href: string, path: string) {
  if (href === "/") return path === "/";
  // Editing an invoice (/editor/INV-…) belongs to the Invoices tab, not Quotation.
  const editingInvoice = /^\/editor\/INV/i.test(path);
  if (href === "/editor") return path === "/editor" || (path.startsWith("/editor/") && !editingInvoice);
  if (href === "/invoices") return path === "/invoices" || path.startsWith("/invoices/") || editingInvoice;
  return path === href || path.startsWith(href + "/");
}

const SYNC_LABEL = { on: "Synced", off: "Offline", queue: "Pending", local: "Local" } as const;

export default function TopNav({ tabs }: { tabs: Tab[] }) {
  const TABS = tabs;
  const { syncState, searchTerm, user, brandMode, unseen } = useApp();
  const path = usePathname();
  const router = useRouter();
  const isOwner = user?.role === "owner";
  const brand = brandFor(brandMode);

  const [userMenu, setUserMenu] = useState(false);
  useEffect(() => {
    if (!userMenu) return;
    const close = () => setUserMenu(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [userMenu]);

  function onSearch(value: string) {
    setSearch(value);
    if (!/^\/(quotations|invoices|customers)/.test(path)) router.push("/quotations");
  }

  return (
    <div className="topnav">
      <div className="topnav-in">
        <div className="nav-brand">{brand.name}</div>
        <div className="tabs">
          {TABS.map((t) => {
            const active = isActive(t.href, path);
            const cls = "tab" + (active ? " active" : "");
            if (t.owner) {
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  className={cls}
                  onClick={(e) => {
                    if (!isOwner) {
                      e.preventDefault();
                      toast("Only the owner can open Settings");
                    }
                  }}
                >
                  {t.label}
                </Link>
              );
            }
            return (
              <Link key={t.href} href={t.href} className={cls}>
                {t.label}
                {t.badge && unseen > 0 && <span className="tab-badge">{unseen}</span>}
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
        {user && (
          <div className="usermenu" onClick={(e) => e.stopPropagation()}>
            <button className="userchip" title={user.name} onClick={() => setUserMenu((v) => !v)}>
              <i>{user.name.charAt(0)}</i>
              {user.name}
              <span className="um-caret">▾</span>
            </button>
            {userMenu && (
              <div className="usermenu-pop">
                <div className="um-head">
                  {user.name} · {user.role === "owner" ? "Owner" : "Manager"}
                </div>
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
                    await changePassword(user.id, r.pw);
                    toast("Password updated");
                  }}
                >
                  Change password
                </button>
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
