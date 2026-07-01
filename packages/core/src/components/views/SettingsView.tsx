"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearStore, metaSet, STORES } from "@/lib/db";
import { LOCK_SQL, SAMPLE_SECTIONS, SETUP_SQL, WIPE_SQL } from "@/lib/constants";
import { DEMO_BRAND, REAL_BRAND, saveBrandMode } from "@/lib/brand";
import {
  cloudClear,
  getSupa,
  hasRealData,
  pullFromCloud,
  saveSupa,
  sessionMode,
  setOpenLock,
  setSecure,
  signOut,
  testConnection,
  trySync,
} from "@/lib/cloud";
import { resetCounters } from "@/lib/numbering";
import { exportBackup, importBackup, connectFolder } from "@/lib/backup";
import { createQuotation, createSampleQuotation } from "@/lib/create";
import { canInstall, promptInstall } from "@/lib/pwa";
import { useApp } from "@/store/useApp";
import { bumpData, setShowLogin, setSyncState, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import { doLogin, refreshAuthIdentity } from "@/store/session";

export default function SettingsView() {
  const { authEmail, brandMode } = useApp();
  const router = useRouter();
  const [supaUrl, setSupaUrl] = useState("");
  const [supaKey, setSupaKey] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [secure, setSecureUI] = useState(false);
  const [openLock, setOpenLockUI] = useState<"never" | "daily" | "always">("daily");
  const [folderStatus, setFolderStatus] = useState("Folder: not connected.");
  const [cloudWipeStatus, setCloudWipeStatus] = useState("");

  useEffect(() => {
    const s = getSupa();
    setSupaUrl(s.url || "");
    setSupaKey(s.key || "");
    setSecureUI(!!s.secure);
    setOpenLockUI(sessionMode());
  }, []);

  // ---- cloud config ----
  async function saveAndTest() {
    const cfg = await saveSupa({ url: supaUrl, key: supaKey, secure: getSupa().secure, openLock: getSupa().openLock });
    setSupaUrl(cfg.url);
    if (!cfg.url || !cfg.key) {
      toast("Cleared cloud config");
      setSyncState("local");
      return;
    }
    try {
      const res = await testConnection();
      if (res.ok) {
        setSyncState("on");
        if (await hasRealData()) {
          toast("Supabase connected ✓ — syncing");
          trySync(true);
        } else {
          const n = await pullFromCloud(true);
          if (n) {
            toast("Connected ✓ — restored " + n + " records from cloud");
            bumpData();
          } else {
            toast("Connected ✓ — cloud is empty, ready to sync");
            trySync(true);
          }
        }
      } else if (res.status === 404) toast("Connected, but tables not found — run the SQL below first");
      else if (res.status === 401 || res.status === 403) toast("Key/permission issue — re-run the SQL (RLS policy) below");
      else toast("Supabase says: " + (res.text.slice(0, 90) || "HTTP " + res.status));
    } catch {
      toast("Could not reach that URL — check the Project URL");
      setSyncState("off");
    }
  }
  async function restore() {
    if (!getSupa().url) return toast("Set up Supabase first");
    const ok = await confirmDialog({
      title: "Restore from cloud?",
      message: "Loads all quotations, invoices, customers and stock from Supabase onto this device.",
      confirmLabel: "Restore",
    });
    if (!ok) return;
    toast("Restoring from cloud…");
    const n = await pullFromCloud(true);
    setSyncState("on");
    bumpData();
    toast(n ? "Restored " + n + " records from cloud" : "Cloud is empty — nothing to restore");
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
      setFolderStatus("Folder: connected ✓ (Abuzar Industries/…). Snapshots + document copies will be written here.");
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
        "Removes ALL quotations, invoices, customers and stock on this device AND in the cloud. Export a backup first if unsure. This cannot be undone.",
      confirmLabel: "Erase everything",
      danger: true,
    });
    if (!ok) return;
    toast("Erasing…");
    const res = await cloudClear(["quotations", "invoices", "customers", "stock"]);
    for (const s of STORES) await clearStore(s);
    if (getSupa().url && getSupa().key && res && !res.ok) {
      await confirmDialog({
        title: "Cloud not fully cleared",
        message:
          "This device was cleared, but the cloud could not be fully deleted:\n\n" +
          res.failed.join("\n") +
          '\n\nUse "Wipe the cloud" + the SQL in Supabase, otherwise old data will sync back.',
        confirmLabel: "OK",
        cancelLabel: "Dismiss",
      });
    }
    toast("All data erased");
    location.reload();
  }
  async function wipeCloud() {
    if (!getSupa().url || !getSupa().key) {
      setCloudWipeStatus("No cloud is configured on this device.");
      return;
    }
    const ok = await confirmDialog({
      title: "Delete all cloud data?",
      message: "Every device will lose this data on its next sync. This cannot be undone.",
      confirmLabel: "Delete cloud data",
      danger: true,
    });
    if (!ok) return;
    setCloudWipeStatus("Deleting from cloud…");
    const res = await cloudClear(["quotations", "invoices", "customers", "stock"]);
    if (res.ok) {
      setCloudWipeStatus("✓ Cloud cleared. Also use \"Erase everything\" on each device so they don't re-upload old data.");
      toast("Cloud cleared ✓");
    } else {
      setCloudWipeStatus("Could not delete: " + res.failed.join(" · ") + ". Use the SQL command below in Supabase.");
      toast("Cloud delete failed — use the SQL below");
    }
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

  // ---- sample ----
  async function loadSample() {
    const d = await createSampleQuotation(SAMPLE_SECTIONS);
    toast("Example loaded as " + d.id);
    router.push("/editor/" + d.id);
  }

  async function installApp() {
    if (canInstall()) await promptInstall();
    else toast("Use the browser menu → Install / Add to Home screen");
  }

  async function pickBrand(mode: "demo" | "real") {
    await saveBrandMode(mode);
    toast(mode === "real" ? "Showing real branding" : "Showing demo branding");
  }

  return (
    <div>
      <div className="sectitle">
        Settings <small>— branding, backup &amp; cloud</small>
      </div>

      <div className="setbox">
        <div className="pc-head" style={{ margin: "-14px -16px 4px" }}>Branding</div>
        <p className="note">
          The app shows a neutral demo identity by default — on screen and on every quotation, invoice, PDF and WhatsApp
          message. Switch to your real branding when you want it on the documents.
        </p>
        <div className="brandtoggle">
          <button className={brandMode === "demo" ? "active" : ""} onClick={() => pickBrand("demo")}>
            <b>Demo</b>
            <small>{DEMO_BRAND.name}</small>
          </button>
          <button className={brandMode === "real" ? "active" : ""} onClick={() => pickBrand("real")}>
            <b>Real</b>
            <small>{REAL_BRAND.name}</small>
          </button>
        </div>
      </div>

      <div className="setbox">
        <div className="pc-head" style={{ margin: "-14px -16px 4px" }}>Desktop &amp; Mobile app</div>
        <p className="note">
          Install as an app — it opens in its own window with a desktop / home-screen icon, no browser bar. (Works once
          the page is hosted on a web address, in Chrome or Edge.)
        </p>
        <div className="rowbtns">
          <button className="btn primary sm" onClick={installApp}>
            Install app on this device
          </button>
        </div>
      </div>

      <div className="setbox">
        <div className="pc-head" style={{ margin: "-14px -16px 4px" }}>Local Backup (your portable database)</div>
        <p className="note">
          All data lives in this browser&apos;s built-in database (IndexedDB). Export a full backup file you can store
          anywhere or move to another PC.
        </p>
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
            Start fresh — clear quotations &amp; invoices
          </button>
          <button className="btn warn sm" onClick={eraseAll}>
            Erase everything
          </button>
        </div>
        <p className="note">
          <b>Start fresh</b> deletes all quotations &amp; invoices (here and in the cloud) and resets numbering to 001,
          but keeps customers &amp; stock. <b>Erase everything</b> removes all data on this device and the cloud.
        </p>
      </div>

      <div className="setbox">
        <div className="pc-head" style={{ margin: "-14px -16px 4px" }}>Wipe the cloud (Supabase)</div>
        <p className="note">
          If old data keeps coming back after erasing, it&apos;s still stored in the cloud. Use this to delete everything
          from the cloud directly.
        </p>
        <div className="rowbtns">
          <button className="btn warn sm" onClick={wipeCloud}>
            Delete ALL data from cloud
          </button>
        </div>
        <p className="note" style={{ marginTop: 8 }}>{cloudWipeStatus}</p>
        <details className="sqltoggle">
          <summary>Guaranteed wipe — SQL for Supabase → SQL Editor</summary>
          <pre>{WIPE_SQL}</pre>
        </details>
      </div>

      <div className="setbox">
        <div className="pc-head" style={{ margin: "-14px -16px 4px" }}>Cloud Backup — Supabase</div>
        <p className="note">
          Local saves happen first (offline-first). When online, records sync to Supabase automatically. The project is
          pre-configured from the app&apos;s environment — just run the setup SQL once on it, then press Save &amp; test.
        </p>
        <details className="sqltoggle">
          <summary>One-time setup SQL — run in Supabase → SQL Editor</summary>
          <pre>{SETUP_SQL}</pre>
        </details>
        <label>Supabase Project URL (base only — no /rest/v1)</label>
        <input value={supaUrl} placeholder="https://xxxxxxxx.supabase.co" onChange={(e) => setSupaUrl(e.target.value)} />
        <label>Supabase key (publishable sb_publishable_… or legacy anon key)</label>
        <input value={supaKey} placeholder="sb_publishable_…  or  eyJhbGciOi…" onChange={(e) => setSupaKey(e.target.value)} />
        <div className="rowbtns">
          <button className="btn primary sm" onClick={saveAndTest}>
            Save &amp; test
          </button>
          <button className="btn sm" onClick={() => trySync(true)}>
            Sync now
          </button>
          <button className="btn sm" onClick={restore}>
            Restore from cloud
          </button>
        </div>
        <p className="note">The key lives only in this browser — never share your <b>secret</b> key.</p>
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
        <details className="sqltoggle">
          <summary>Lock SQL — restrict the database to logged-in users</summary>
          <pre>{LOCK_SQL}</pre>
        </details>
      </div>

      <div className="setbox">
        <div className="pc-head" style={{ margin: "-14px -16px 4px" }}>Sample data</div>
        <div className="rowbtns">
          <button className="btn sm" onClick={loadSample}>
            Load example quotation
          </button>
        </div>
      </div>
    </div>
  );
}
