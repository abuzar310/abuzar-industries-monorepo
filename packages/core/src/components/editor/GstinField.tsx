"use client";
import { useState } from "react";
import { cleanGstin, isValidGstinFormat, stateFromGstin, verifyGstin, type GstInfo } from "@/lib/gst";

/** Customer/Supplier GSTIN input with a one-tap "Verify" that fetches the
 *  registered business name + live status from the GST records, and lets you
 *  drop the fetched name/address straight onto the invoice. */
export default function GstinField({
  label,
  value,
  onChange,
  onUseName,
  onUseAddress,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** fill the customer name field with the fetched legal/trade name. */
  onUseName?: (name: string) => void;
  /** fill the address field with the fetched principal address. */
  onUseAddress?: (addr: string) => void;
}) {
  const [checking, setChecking] = useState(false);
  const [info, setInfo] = useState<GstInfo | null>(null);
  const [err, setErr] = useState("");

  const g = cleanGstin(value);
  const formatOk = g.length === 15 && isValidGstinFormat(g);
  const badFormat = g.length === 15 && !formatOk;
  const state = formatOk ? stateFromGstin(g) : undefined;

  async function run() {
    if (!formatOk || checking) return;
    setChecking(true);
    setErr("");
    setInfo(null);
    const r = await verifyGstin(g);
    setChecking(false);
    if (r.ok) setInfo(r.info);
    else setErr(r.error);
  }

  // typing a new number invalidates the last result
  function handleChange(next: string) {
    onChange(next);
    if (cleanGstin(next) !== (info?.gstin ?? g)) {
      setInfo(null);
      setErr("");
    }
  }

  const name = info?.tradeName || info?.legalName;

  return (
    <div className="f">
      <label>{label}</label>
      <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
        <input
          placeholder="—"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              run();
            }
          }}
          style={{ flex: 1, textTransform: "uppercase" }}
        />
        <button
          type="button"
          className="btn sm no-print"
          onClick={run}
          disabled={!formatOk || checking}
          title={formatOk ? "Look up this GSTIN" : "Enter a valid 15-character GSTIN"}
        >
          {checking ? "Checking…" : "Verify"}
        </button>
      </div>

      {badFormat && (
        <div className="no-print" style={{ fontSize: 12, color: "var(--danger)", marginTop: 4 }}>
          Invalid GSTIN — check the number.
        </div>
      )}
      {formatOk && state && !info && !err && !checking && (
        <div className="no-print" style={{ fontSize: 12, color: "var(--ink-faint, #8a7b45)", marginTop: 4 }}>
          {state} · press Verify to fetch the business name.
        </div>
      )}
      {err && (
        <div className="no-print" style={{ fontSize: 12, color: "var(--danger)", marginTop: 4 }}>{err}</div>
      )}

      {info?.sandbox && (
        <div
          className="no-print"
          style={{
            marginTop: 6,
            padding: "8px 10px",
            border: "1px solid #e6cd9f",
            borderRadius: 8,
            background: "#f7e9d2",
            color: "#8a5a16",
            fontSize: 12.5,
          }}
        >
          <b>Test mode — not a real check.</b> The Appyflow key is on free/sandbox
          credits, which return sample data for every GSTIN. Add paid credits to
          verify real numbers.
        </div>
      )}

      {info && !info.sandbox && (
        <div
          className="no-print"
          style={{
            marginTop: 6,
            padding: "8px 10px",
            border: "1px solid var(--line, #e6dcc4)",
            borderRadius: 8,
            background: "var(--paper-2, #fbf6ea)",
            fontSize: 13,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className={"badge " + (info.active ? "b-confirm" : "b-reject")}>
              {info.status || (info.active ? "Active" : "Inactive")}
            </span>
            <b>{name || "—"}</b>
            {info.tradeName && info.legalName && info.tradeName !== info.legalName && (
              <span style={{ color: "var(--ink-faint, #8a7b45)" }}>({info.legalName})</span>
            )}
          </div>
          <div style={{ color: "var(--ink-faint, #8a7b45)", marginTop: 4 }}>
            {[info.taxpayerType, info.constitution, info.state].filter(Boolean).join(" · ")}
          </div>
          {info.address && (
            <div style={{ color: "var(--ink-faint, #8a7b45)", marginTop: 4 }}>{info.address}</div>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {onUseName && name && (
              <button type="button" className="btn sm" onClick={() => onUseName(name)}>
                Use name
              </button>
            )}
            {onUseAddress && info.address && (
              <button type="button" className="btn sm" onClick={() => onUseAddress(info.address!)}>
                Use address
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
