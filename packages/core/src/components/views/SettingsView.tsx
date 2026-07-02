"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearStore, metaSet, STORES } from "@/lib/db";
import { cloudClear, getSupa, pullFromCloud, testConnection, trySync } from "@/lib/cloud";
import { resetCounters } from "@/lib/numbering";
import { exportBackup, importBackup } from "@/lib/backup";
import { createQuotation } from "@/lib/create";
import { canInstall, promptInstall } from "@/lib/pwa";
import { getFeatures } from "@/lib/features";
import { autoPostEnabled, setAutoPost } from "@/lib/ledger-autopost";
import { bumpData, setSyncState, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";

export default function SettingsView() {
  const router = useRouter();
  const [cloud, setCloud] = useState("Checking cloud…");
  const [autoPost, setAutoPostUI] = useState(false);
  const ledgerOn = getFeatures().ledger;

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setCloud(getSupa().url && getSupa().key ? "Connected to cloud" : "Local only (no cloud configured)");
    /* eslint-enable react-hooks/set-state-in-effect */
    autoPostEnabled().then(setAutoPostUI);
  }, []);

  async function toggleAutoPost(v: boolean) {
    setAutoPostUI(v);
    await setAutoPost(v);
    toast(v ? "Invoices will now post to the Ledger" : "Auto-posting off");
  }

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
      message: "Removes ALL data on this device AND in the cloud. Export a backup first if unsure. This cannot be undone.",
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
  async function installApp() {
    if (canInstall()) await promptInstall();
    else toast("Use the browser menu → Install / Add to Home screen");
  }

  return (
    <div>
      <div className="sectitle">
        Settings <small>— app, cloud &amp; backup</small>
      </div>

      <div className="setbox">
        <div className="pc-head" style={{ margin: "-14px -16px 4px" }}>Cloud sync</div>
        <p className="note">
          Everything saves on this device first and syncs to the cloud automatically when online. Status: <b>{cloud}</b>.
        </p>
        <div className="rowbtns">
          <button className="btn primary sm" onClick={testCloud}>Check connection</button>
          <button className="btn sm" onClick={() => trySync(true)}>Sync now</button>
          <button className="btn sm" onClick={restore}>Restore from cloud</button>
        </div>
      </div>

      {ledgerOn && (
        <div className="setbox">
          <div className="pc-head" style={{ margin: "-14px -16px 4px" }}>Ledger</div>
          <p className="note">
            When on, every invoice writes a Sales/Purchase voucher (and a Receipt/Payment for money received) straight into
            the Ledger. Leave off to keep the Ledger manual.
          </p>
          <label className="secline">
            <input type="checkbox" checked={autoPost} onChange={(e) => toggleAutoPost(e.target.checked)} /> Auto-post invoices
            &amp; payments to Ledger
          </label>
        </div>
      )}

      <div className="setbox">
        <div className="pc-head" style={{ margin: "-14px -16px 4px" }}>Backup &amp; reset</div>
        <p className="note">Export a full backup file you can keep anywhere or move to another device.</p>
        <div className="rowbtns">
          <button className="btn sm" onClick={exportBackup}>Export backup (.json)</button>
          <button className="btn sm" onClick={importFile}>Import backup</button>
        </div>
        <div className="rowbtns" style={{ marginTop: 10 }}>
          <button className="btn warn sm" onClick={startFresh}>Start fresh (clear quotations &amp; invoices)</button>
          <button className="btn warn sm" onClick={eraseAll}>Erase everything</button>
        </div>
      </div>

      <div className="setbox">
        <div className="pc-head" style={{ margin: "-14px -16px 4px" }}>Install app</div>
        <p className="note">Install to your phone / desktop — opens in its own window with a home-screen icon and enables notifications.</p>
        <div className="rowbtns">
          <button className="btn primary sm" onClick={installApp}>Install on this device</button>
        </div>
      </div>
    </div>
  );
}
