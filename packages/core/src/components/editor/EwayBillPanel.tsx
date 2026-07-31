"use client";
import { useEffect, useRef, useState } from "react";
import { activeBrand } from "@/lib/brand";
import { computeDoc, inr, todayStr } from "@/lib/calc";
import {
  downloadNicJson,
  EWAY_PORTAL_URL,
  ewayReady,
  extractPincode,
  getBusinessPincode,
  openEwayPortal,
  underThresholdNote,
} from "@/lib/ewaybill";
import { generatePdf, printOrSavePdf } from "@/lib/pdf";
import { toast } from "@/store/app-store";
import type { Doc } from "@/lib/types";

interface Props {
  doc: Doc;
  onChange: (patch: Partial<Doc>) => void;
  onPersist: () => void | Promise<void>;
  /** When true, run Download JSON + open portal once on mount (toolbar shortcut). */
  autoRun?: boolean;
  onAutoRunDone?: () => void;
}

/**
 * Fastest free path without GSP Client ID/Secret:
 * one action prepares NIC bulk JSON from the invoice and opens ewaybillgst.gov.in
 * → user Generate Bulk once → paste EWB number → print.
 */
export default function EwayBillPanel({ doc, onChange, onPersist, autoRun, onAutoRunDone }: Props) {
  const brand = activeBrand();
  const [fromPin, setFromPin] = useState("");
  const [busy, setBusy] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const ranAuto = useRef(false);
  const totals = computeDoc(doc);

  useEffect(() => {
    getBusinessPincode().then(setFromPin);
  }, []);

  useEffect(() => {
    if (!doc.custPincode) {
      const pin = extractPincode(doc.shipTo || doc.address);
      if (pin) onChange({ custPincode: pin });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.address, doc.shipTo]);

  const ready = ewayReady(doc, brand, fromPin);
  const warn = underThresholdNote(doc);
  const toPin = doc.shipToPincode || doc.custPincode || "";

  async function runEway() {
    if (!ready.ok) {
      toast(ready.errors[0] || "Fill PIN, HSN, and vehicle first");
      return;
    }
    setBusy(true);
    try {
      await onPersist();
      downloadNicJson(doc, brand, fromPin);
      openEwayPortal();
      toast("JSON ready · portal opened → e-Waybill → Generate Bulk → upload file");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!autoRun || ranAuto.current || !fromPin) return;
    ranAuto.current = true;
    void runEway().finally(() => onAutoRunDone?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, fromPin]);

  async function onPrintEwb() {
    await onPersist();
    if (!printRef.current) return;
    const how = await printOrSavePdf(printRef.current, "eway-" + (doc.number || doc.id));
    if (how === "print") {
      await generatePdf(printRef.current, "eway-" + (doc.number || doc.id));
      toast("E-way slip PDF downloaded ✓");
    } else if (how === "pdf" || how === "shared") {
      toast("E-way slip ready ✓");
    }
  }

  return (
    <div className="eway-panel no-print panel-card" id="eway-panel">
      <div className="eway-head">
        <div>
          <b>E-way bill</b>
          <small>One click → JSON + NIC portal (free · no GSP Client ID)</small>
        </div>
      </div>

      <p className="eway-steps">
        <b>E-way</b> downloads the file and opens the portal. Then: login →{" "}
        <b>e-Waybill → Generate Bulk</b> → upload the file → Generate → paste the number below.
      </p>

      <div className="eway-grid">
        <label>
          <span>Customer PIN</span>
          <input
            inputMode="numeric"
            maxLength={6}
            placeholder="6 digits"
            value={doc.custPincode || ""}
            onChange={(e) => onChange({ custPincode: e.target.value.replace(/\D/g, "").slice(0, 6) })}
          />
        </label>
        <label>
          <span>HSN</span>
          <input value={doc.hsn || ""} readOnly title="Edit in invoice header" />
        </label>
        <label>
          <span>Vehicle</span>
          <input
            placeholder="KA…"
            value={doc.vehicleNo || ""}
            onChange={(e) => onChange({ vehicleNo: e.target.value.toUpperCase() })}
          />
        </label>
        <label>
          <span>Distance km</span>
          <input
            type="number"
            inputMode="numeric"
            placeholder="approx."
            value={doc.transDistance ?? ""}
            onChange={(e) =>
              onChange({ transDistance: e.target.value.trim() === "" ? undefined : Math.max(0, +e.target.value || 0) })
            }
          />
        </label>
      </div>

      <div className="eway-summary">
        <span>{brand.gstin || "—"}</span>
        <span>→ {(doc.custGstin || "URP").toUpperCase()} · PIN {toPin || "—"}</span>
        <span>₹{inr(totals.grand)}</span>
      </div>

      {!ready.ok && (
        <ul className="eway-errors">
          {ready.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {warn && <p className="eway-warn">{warn}</p>}

      <div className="eway-actions">
        <button type="button" className="btn primary" disabled={!ready.ok || busy} onClick={() => void runEway()}>
          {busy ? "Working…" : "E-way — JSON + open portal"}
        </button>
        <button type="button" className="btn" onClick={() => void onPrintEwb()}>
          Print slip
        </button>
      </div>

      <div className="eway-ewb-row">
        <label>
          <span>EWB number (from portal)</span>
          <input
            placeholder="paste after Generate"
            value={doc.ewbNo || ""}
            onChange={(e) => onChange({ ewbNo: e.target.value.trim() })}
          />
        </label>
        <label>
          <span>EWB date</span>
          <input
            placeholder={todayStr()}
            value={doc.ewbDate || ""}
            onChange={(e) => onChange({ ewbDate: e.target.value })}
          />
        </label>
        <button
          type="button"
          className="btn primary sm"
          disabled={!doc.ewbNo}
          onClick={() => {
            void Promise.resolve(onPersist()).then(() => toast("EWB saved ✓"));
          }}
        >
          Save
        </button>
      </div>

      <div className="cd-print eway-slip" ref={printRef}>
        <div className="eway-slip-head">
          <div>
            <h1>{brand.name}</h1>
            <div>{brand.addr}</div>
            <div>
              GSTIN: {brand.gstin} · PIN {fromPin}
            </div>
          </div>
          <div className="eway-slip-title">
            <div>E-WAY BILL SLIP</div>
            <div className="eway-slip-no">{doc.ewbNo ? "EWB " + doc.ewbNo : "Pending portal generate"}</div>
            {doc.ewbDate && <div>Date {doc.ewbDate}</div>}
          </div>
        </div>
        <table className="eway-slip-tbl">
          <tbody>
            <tr>
              <td>Invoice</td>
              <td>
                {doc.number} · {doc.date}
              </td>
            </tr>
            <tr>
              <td>Customer</td>
              <td>
                {doc.customerName || "—"}
                {doc.custGstin ? " · GSTIN " + doc.custGstin : ""}
              </td>
            </tr>
            <tr>
              <td>Ship to</td>
              <td>{(doc.shipTo || doc.address || "—") + " · PIN " + (toPin || "—")}</td>
            </tr>
            <tr>
              <td>HSN / Goods</td>
              <td>
                {doc.hsn || "—"} · {(doc.sections[0]?.name || brand.goods || "Timber").trim()}
              </td>
            </tr>
            <tr>
              <td>Taxable / GST / Total</td>
              <td>
                ₹{inr(totals.sub)} · ₹{inr(totals.gstAmt)} · ₹{inr(totals.grand)}
              </td>
            </tr>
            <tr>
              <td>Vehicle</td>
              <td>
                {(doc.vehicleNo || "—") + (doc.transDistance ? " · " + doc.transDistance + " km" : "")}
              </td>
            </tr>
          </tbody>
        </table>
        <p className="eway-slip-foot">Authoritative e-way bill number is issued only by {EWAY_PORTAL_URL}.</p>
      </div>
    </div>
  );
}
