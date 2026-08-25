"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { exportBackup, importBackup } from "@/lib/backup";
import { purgeDoc, purgedDocs, restoreDoc, trashedDocs } from "@/lib/trash";
import { docStore } from "@/lib/doc";
import type { Doc } from "@/lib/types";
import { canInstall, promptInstall } from "@/lib/pwa";
import { getFeatures } from "@/lib/features";
import { inr } from "@/lib/calc";
import { migrateAccountReceiptsToQuotes } from "@/lib/receipts";
import { autoPostEnabled, setAutoPost } from "@/lib/ledger-autopost";
import { getBusinessPincode, isValidPincode, setBusinessPincode } from "@/lib/ewaybill";
import { bumpData, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";

export default function SettingsView() {
  const router = useRouter();
  const [autoPost, setAutoPostUI] = useState(false);
  const [trash, setTrash] = useState<Doc[]>([]);
  const [archive, setArchive] = useState<Doc[]>([]);
  const [bizPin, setBizPin] = useState("");
  const [aiKey, setAiKey] = useState("");
  const [aiHost, setAiHost] = useState("https://api.openai.com/v1");
  const [aiModel, setAiModel] = useState("gpt-4o-mini");
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const ledgerOn = getFeatures().ledger;
  const receiptsApp = getFeatures().acceptPayment;
  const ewayOn = getFeatures().invoices && !getFeatures().simpleQuote;

  const loadTrash = () => {
    trashedDocs().then(setTrash);
    purgedDocs().then(setArchive);
  };
  useEffect(() => {
    autoPostEnabled().then(setAutoPostUI);
    if (ewayOn) getBusinessPincode().then(setBizPin);
    loadTrash();
    fetch("/api/ai/config", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d: { configured?: boolean; host?: string; model?: string }) => {
        setAiConfigured(!!d.configured);
        if (typeof d.host === "string" && d.host.trim()) setAiHost(d.host);
        if (typeof d.model === "string" && d.model.trim()) setAiModel(d.model);
      })
      .catch(() => undefined);
  }, [ewayOn]);

  async function saveAi() {
    if (aiBusy) return;
    setAiBusy(true);
    try {
      const r = await fetch("/api/ai/config", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: aiHost.trim(),
          model: aiModel.trim() || undefined,
          apiKey: aiKey.trim() || undefined,
        }),
      });
      const d = (await r.json().catch(() => ({}))) as {
        error?: string;
        configured?: boolean;
        host?: string;
        model?: string;
      };
      if (!r.ok) throw new Error(d.error || "Could not save");
      setAiKey("");
      if (typeof d.host === "string" && d.host.trim()) setAiHost(d.host);
      if (typeof d.model === "string" && d.model.trim()) setAiModel(d.model);
      setAiConfigured(!!d.configured);
      toast(d.configured ? "AI settings saved" : "Saved host — paste an API key to enable chat");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save");
    } finally {
      setAiBusy(false);
    }
  }

  async function onRestore(d: Doc) {
    await restoreDoc(docStore(d), d.id);
    loadTrash();
    bumpData();
    toast(d.number + " restored");
  }
  async function onPurge(d: Doc) {
    const ok = await confirmDialog({
      title: "Archive " + d.number + "?",
      message:
        "Removes it from the Recycle bin, but the record stays in the cloud forever. You can still restore it from Archive below.",
      confirmLabel: "Archive",
      danger: true,
    });
    if (!ok) return;
    await purgeDoc(docStore(d), d.id);
    loadTrash();
    bumpData();
    toast(d.number + " archived (still recoverable)");
  }

  async function onMigrateReceipts() {
    const ok = await confirmDialog({
      title: "Apply account receipts to quotations?",
      message:
        "Re-applies past Receipts-tab payments onto each customer's open quotations, so their quotes and Statements update. Money totals don't change and it's safe to run again.",
      confirmLabel: "Apply now",
    });
    if (!ok) return;
    toast("Applying…");
    const r = await migrateAccountReceiptsToQuotes();
    bumpData();
    if (r.receiptsConverted === 0) {
      toast(r.scanned ? "Nothing to apply — receipts already on quotes" : "No account receipts found");
    } else {
      toast(
        `Applied ${r.receiptsConverted} receipt${r.receiptsConverted === 1 ? "" : "s"} to ${r.quotesUpdated} quote${r.quotesUpdated === 1 ? "" : "s"}` +
          (r.leftover > 0.5 ? ` · ₹${inr(r.leftover)} kept as account credit` : ""),
      );
    }
  }

  async function toggleAutoPost(v: boolean) {
    setAutoPostUI(v);
    await setAutoPost(v);
    toast(v ? "Invoices will now post to the Ledger" : "Auto-posting off");
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
        Settings <small>— app &amp; backup</small>
      </div>

      <div className="setbox">
        <div className="pc-head" style={{ margin: "-14px -16px 4px" }}>AI assistant</div>
        <p className="note">
          Owner only. Any OpenAI-compatible chat API (OpenAI, Groq, OpenRouter, a local server). The key is stored
          in this app&apos;s cloud and is never shown again.
        </p>
        <label>
          Host URL
          <input
            type="url"
            placeholder="https://api.openai.com/v1"
            value={aiHost}
            onChange={(e) => setAiHost(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label>
          Model
          <input
            type="text"
            placeholder="gpt-4o-mini"
            value={aiModel}
            onChange={(e) => setAiModel(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label>
          API key {aiConfigured ? <small style={{ textTransform: "none", letterSpacing: 0 }}>— saved</small> : null}
          <input
            type="password"
            placeholder={aiConfigured ? "Leave blank to keep the saved key" : "Paste sk-… or provider key"}
            value={aiKey}
            onChange={(e) => setAiKey(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        <div className="rowbtns" style={{ marginTop: 12 }}>
          <button className="btn primary sm" type="button" disabled={aiBusy} onClick={() => void saveAi()}>
            Save AI
          </button>
        </div>
      </div>

      <div className="setbox">
        <div className="pc-head" style={{ margin: "-14px -16px 4px" }}>Cloud</div>
        <p className="note">
          The cloud database is the single source of truth — every save goes straight there, and
          every device shows the same data within seconds. Nothing is stored on this device.
        </p>
      </div>

      {ewayOn && (
        <div className="setbox">
          <div className="pc-head" style={{ margin: "-14px -16px 4px" }}>E-way bill · business PIN</div>
          <p className="note">
            From-place PIN used in the NIC bulk JSON (ewaybillgst.gov.in). Default is Chitradurga 577501.
          </p>
          <div className="rowbtns" style={{ alignItems: "center" }}>
            <input
              inputMode="numeric"
              maxLength={6}
              placeholder="6 digits"
              value={bizPin}
              onChange={(e) => setBizPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              style={{ width: 120, padding: "8px 10px", border: "1px solid var(--line-2)", borderRadius: 8 }}
            />
            <button
              className="btn primary sm"
              type="button"
              onClick={async () => {
                if (!isValidPincode(bizPin)) return toast("Enter a valid 6-digit PIN");
                await setBusinessPincode(bizPin);
                toast("Business PIN saved ✓");
              }}
            >
              Save PIN
            </button>
          </div>
        </div>
      )}

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

      {receiptsApp && (
        <div className="setbox">
          <div className="pc-head" style={{ margin: "-14px -16px 4px" }}>Apply receipts to quotations</div>
          <p className="note">
            Re-applies past <b>Receipts</b> payments onto each customer&apos;s open quotations, so their quotes and
            Statements show as paid. Totals don&apos;t change and it&apos;s safe to run again.
          </p>
          <div className="rowbtns">
            <button className="btn primary sm" onClick={onMigrateReceipts}>Apply receipts to quotations</button>
          </div>
        </div>
      )}

      <div className="setbox">
        <div className="pc-head" style={{ margin: "-14px -16px 4px" }}>Recycle bin</div>
        <p className="note">
          Deleted quotations &amp; invoices stay here — never really removed from the cloud. Restore anytime, or move to Archive.
        </p>
        {trash.length === 0 ? (
          <p className="note" style={{ opacity: 0.6, marginTop: 4 }}>Nothing deleted.</p>
        ) : (
          trash.map((d) => (
            <div className="exprow" key={d.id}>
              <span className="expnote">
                {d.number} — {d.customerName || "—"}
                <small>
                  {d.kind === "invoice" ? "Invoice" : "Quotation"}
                  {d.deletedAt
                    ? " · deleted " +
                      new Date(d.deletedAt).toLocaleString([], { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                    : ""}
                </small>
              </span>
              <button className="btn sm" onClick={() => onRestore(d)}>Restore</button>
              <button className="btn warn sm" onClick={() => onPurge(d)}>Archive</button>
            </div>
          ))
        )}
      </div>

      <div className="setbox">
        <div className="pc-head" style={{ margin: "-14px -16px 4px" }}>Archive</div>
        <p className="note">
          Hidden invoices/quotations that were “deleted forever”. They still exist in the cloud — restore any time.
        </p>
        {archive.length === 0 ? (
          <p className="note" style={{ opacity: 0.6, marginTop: 4 }}>Archive empty.</p>
        ) : (
          archive.map((d) => (
            <div className="exprow" key={"arch-" + d.id}>
              <span className="expnote">
                {d.number} — {d.customerName || "—"}
                <small>
                  {d.kind === "invoice" ? "Invoice" : "Quotation"}
                  {d.purgedAt
                    ? " · archived " +
                      new Date(d.purgedAt).toLocaleString([], { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                    : ""}
                </small>
              </span>
              <button className="btn sm" onClick={() => onRestore(d)}>Restore</button>
            </div>
          ))
        )}
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
