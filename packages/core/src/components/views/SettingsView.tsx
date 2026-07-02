"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearStore } from "@/lib/db";
import { getSupa, pullFromCloud, testConnection, trySync } from "@/lib/cloud";
import { exportBackup, importBackup } from "@/lib/backup";
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
  async function resetToCloud() {
    const ok = await confirmDialog({
      title: "Match this device to the cloud?",
      message:
        "Clears this device's local records and reloads exactly what's in the cloud — removes any local-only leftovers. Anything not yet synced up will be lost.",
      confirmLabel: "Match to cloud",
      danger: true,
    });
    if (!ok) return;
    toast("Cleaning up…");
    for (const s of ["quotations", "invoices", "customers", "stock", "expenses", "sessions", "ledgers", "vouchers"] as const) {
      await clearStore(s);
    }
    const n = await pullFromCloud(true);
    setSyncState("on");
    bumpData();
    toast("Done — matched to the cloud (" + n + " records)");
    router.push("/");
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
        <p className="note" style={{ marginTop: 8 }}>
          Seeing old/leftover records that aren&apos;t on your other devices? They&apos;re local-only. Match this device to
          the cloud to clear them.
        </p>
        <div className="rowbtns">
          <button className="btn warn sm" onClick={resetToCloud}>Match this device to the cloud</button>
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
        <div className="pc-head" style={{ margin: "-14px -16px 4px" }}>Backup</div>
        <p className="note">Export a full backup file you can keep anywhere or move to another device.</p>
        <div className="rowbtns">
          <button className="btn sm" onClick={exportBackup}>Export backup (.json)</button>
          <button className="btn sm" onClick={importFile}>Import backup</button>
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
