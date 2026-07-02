"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearStore, metaSet, STORES } from "@/lib/db";
import {
  cloudClear,
  getSupa,
  pullFromCloud,
  sessionMode,
  setOpenLock,
  setSecure,
  signOut,
  testConnection,
  trySync,
} from "@/lib/cloud";
import { resetCounters } from "@/lib/numbering";
import { exportBackup, importBackup, connectFolder } from "@/lib/backup";
import { createQuotation } from "@/lib/create";
import { canInstall, promptInstall } from "@/lib/pwa";
import { useApp } from "@/store/useApp";
import { bumpData, setShowLogin, setSyncState, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import { doLogin, refreshAuthIdentity } from "@/store/session";

export default function SettingsView() {
  const { authEmail } = useApp();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [secure, setSecureUI] = useState(false);
  const [openLock, setOpenLockUI] = useState<"never" | "daily" | "always">("daily");
  const [folderStatus, setFolderStatus] = useState("Folder: not connected.");
  const [cloud, setCloud] = useState("Checking cloud…");

  useEffect(() => {
    // reading module state after mount (Settings opens well after boot) avoids a hydration mismatch
    /* eslint-disable react-hooks/set-state-in-effect */
    setSecureUI(!!getSupa().secure);
    setOpenLockUI(sessionMode());
    setCloud(getSupa().url && getSupa().key ? "Connected to cloud" : "Local only (no cloud configured)");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // ---- cloud ----
  async function testCloud() {
    if (!getSupa().url || !getSupa().key) {
      setCloud("Local only (no cloud configured)");
      return toast("No cloud configured");
    }
    try {
      const res = await testConnection();
      if (res.ok) {
        setCloud("Connected to cloud ✓");
        setSyncState("on");
        trySync(true);
        toast("Cloud connected ✓ — syncing");
      } else if (res.status === 404) {
        setCloud("Connected, but tables are missing — run the one-time setup once");
        toast("Tables not found on the project");
      } else {
        setCloud("Cloud error: HTTP " + res.status);
        toast("Cloud error: HTTP " + res.status);
      }
    } catch {
      setCloud("Could not reach the cloud");
      toast("Could not reach the cloud");
    }
  }
  async function restore() {
    const ok = await confirmDialog({
      title: "Restore from cloud?",
      message: "Loads all records from the cloud onto this device.",
      confirmLabel: "Restore",
    });
    if (!ok) return;
    toast("Restoring…");
    const n = await pullFromCloud(true);
    setSyncState("on");
    bumpData();
    toast(n ? "Restored " + n + " records" : "Cloud is empty — nothing to restore");
  }

  // ---- local backup ----
  function importFile() {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".json,application/json";
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      await importBackup(f);
      toast("Backup imported");
      bumpData();
      router.push("/");
    };
    inp.click();
  }
  async function connect() {
    const ok = await connectFolder().catch(() => false);
    if (ok) {
      setFolderStatus("Folder: connected ✓ — snapshots + document copies will be written here.");
      toast("Folder connected");
    } else toast("Folder access needs Chrome/Edge desktop");
  }
  async function startFresh() {
    const ok = await confirmDialog({
      title: "Start fresh?",
      message:
        "Permanently deletes ALL quotations and invoices — here AND in the cloud — and resets numbering to 001. Customers and stock are kept. This cannot be undone.",
      confirmLabel: "Start fresh",
      danger: true,
    });
    if (!ok) return;
    toast("Clearing…");
    await clearStore("quotations");
    await clearStore("invoices");
    await cloudClear(["quotations", "invoices"]);
    await resetCounters();
    await metaSet("lastOpen", null);
    const d = await createQuotation();
    bumpData();
    toast("Done — starting fresh from " + d.number);
    router.push("/editor/" + d.id);
  }
  async function eraseAll() {
    const ok = await confirmDialog({
      title: "Erase everything?",
      message:
        "Removes ALL data on this device AND in the cloud. Export a backup first if unsure. This cannot be undone.",
      confirmLabel: "Erase everything",
      danger: true,
    });
    if (!ok) return;
    toast("Erasing…");
    await cloudClear(["quotations", "invoices", "customers", "stock", "expenses", "sessions", "ledgers", "vouchers"]);
    for (const s of STORES) await clearStore(s);
    toast("All data erased");
    location.reload();
  }

  // ---- security ----
  async function signInSettings() {
    const msg = await doLogin(email, pass);
    if (!msg) setPass("");
    else toast(msg);
  }
  async function signOutSettings() {
    await signOut();
    refreshAuthIdentity();
    setSyncState(getSupa().url ? "queue" : "local");
    toast("Signed out");
  }
  async function toggleSecure(v: boolean) {
    setSecureUI(v);
    await setSecure(v);
    if (v) {
      setShowLogin(true, true);
      toast("Security on — sign in to sync");
    } else toast("Security off");
  }
  async function changeOpenLock(v: "never" | "daily" | "always") {
    setOpenLockUI(v);
    await setOpenLock(v);
    if (v !== "never") setSecureUI(true);
    if (v === "never") toast("You will stay signed in on this device");
    else if (v === "daily") toast("You will sign in once a day");
    else toast("You will sign in every time the app opens");
    if (v !== "never") setShowLogin(true, true);
  }

  async function installApp() {
    if (canInstall()) await promptInstall();
    else toast("Use the browser menu → Install / Add to Home screen");
  }

  return (
    <div>
      <div className="sectitle">
        Settings <small>— app, backup &amp; cloud</small>
      </div>

      <div className="setbox">
        <div className="pc-head" style={{ margin: "-14px -16px 4px" }}>Install app</div>
        <p className="note">
          Install to your phone / desktop — opens in its own window with a home-screen icon and enables notifications.
        </p>
        <div className="rowbtns">
          <button className="btn primary sm" onClick={installApp}>
            Install on this device
          </button>
        </div>
      </div>

      <div className="setbox">
        <div className="pc-head" style={{ margin: "-14px -16px 4px" }}>Cloud sync</div>
        <p className="note">
          Everything saves on this device first (offline-first) and syncs to the cloud automatically when online. Status:{" "}
          <b>{cloud}</b>.
        </p>
        <div className="rowbtns">
          <button className="btn primary sm" onClick={testCloud}>
            Check connection
          </button>
          <button className="btn sm" onClick={() => trySync(true)}>
            Sync now
          </button>
          <button className="btn sm" onClick={restore}>
            Restore from cloud
          </button>
        </div>
      </div>

      <div className="setbox">
        <div className="pc-head" style={{ margin: "-14px -16px 4px" }}>Backup &amp; reset</div>
        <p className="note">Export a full backup file you can keep anywhere or move to another device.</p>
        <div className="rowbtns">
          <button className="btn sm" onClick={exportBackup}>
            Export backup (.json)
          </button>
          <button className="btn sm" onClick={importFile}>
            Import backup
          </button>
          <button className="btn sm" onClick={connect}>
            Connect data folder
          </button>
        </div>
        <p className="note">{folderStatus}</p>
        <div className="rowbtns" style={{ marginTop: 10 }}>
          <button className="btn warn sm" onClick={startFresh}>
            Start fresh (clear quotations &amp; invoices)
          </button>
          <button className="btn warn sm" onClick={eraseAll}>
            Erase everything
          </button>
        </div>
      </div>

      <div className="setbox">
        <div className="pc-head" style={{ margin: "-14px -16px 4px" }}>Security — require login</div>
        <p className="note">{authEmail ? "Signed in as " + authEmail + "." : "Not signed in."}</p>
        <label>Email</label>
        <input type="email" placeholder="you@business.com" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label>Password</label>
        <input type="password" placeholder="••••••••" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} />
        <div className="rowbtns">
          <button className="btn primary sm" onClick={signInSettings}>
            Sign in
          </button>
          <button className="btn sm" onClick={signOutSettings}>
            Sign out
          </button>
        </div>
        <label className="secline">
          <input type="checkbox" checked={secure} onChange={(e) => toggleSecure(e.target.checked)} /> Require login to
          read/write cloud data
        </label>
        <label className="secline" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          Ask to sign in:
          <select value={openLock} onChange={(e) => changeOpenLock(e.target.value as "never")} style={{ padding: "4px 8px", borderRadius: 8 }}>
            <option value="never">Stay signed in</option>
            <option value="daily">Once a day</option>
            <option value="always">Every time it opens</option>
          </select>
        </label>
      </div>
    </div>
  );
}
