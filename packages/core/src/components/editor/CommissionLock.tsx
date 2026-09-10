"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { inr, nowIso } from "@/lib/calc";
import {
  commissionPendingOnQuote,
  lockAmount,
  pendingPayHref,
} from "@/lib/carpenter-financials";
import {
  applyAgainstRent,
  ensurePlaceRentTenants,
  matchPlaceRentTenant,
  placeRentDue,
  unpaidChargedMonths,
} from "@/lib/place-rent";
import { USERS } from "@/lib/local-auth";
import { bumpData, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import type { Carpenter, CommissionLock as Lock, Customer, Doc, Expense } from "@/lib/types";
import CustomerPicker from "./CustomerPicker";
import CarpenterPicker, { type CarpenterHit } from "./CarpenterPicker";

const userName = (id: string) => USERS.find((u) => u.id === id)?.name || id || "—";
const r2 = (n: number) => Math.round(n * 100) / 100;

export default function CommissionLock({
  doc,
  expenses,
  customers,
  carpenters,
  by,
  onCommit,
  onApplied,
}: {
  doc: Doc;
  expenses: Expense[];
  customers: Customer[];
  carpenters: CarpenterHit[];
  by: string;
  onCommit: (lock: Lock | undefined) => void;
  onApplied?: () => void;
}) {
  const router = useRouter();
  const lockedAmt = lockAmount(doc);
  const isLocked = lockedAmt > 0;
  const pending = commissionPendingOnQuote(doc, expenses);
  const lockKey = isLocked
    ? `${lockedAmt}|${doc.commLock?.carpenter || ""}|${doc.commLock?.lockedAt || ""}`
    : "";

  const [amt, setAmt] = useState("");
  const [carpenter, setCarpenter] = useState("");
  const [party, setParty] = useState("");
  const [partyId, setPartyId] = useState("");
  const [editing, setEditing] = useState(false);
  const [tenants, setTenants] = useState<Carpenter[]>([]);
  const [against, setAgainst] = useState("");
  const [cash, setCash] = useState("");
  const [setoffMonth, setSetoffMonth] = useState("");

  useEffect(() => {
    void ensurePlaceRentTenants().then(setTenants);
  }, []);

  useEffect(() => {
    setEditing(false);
    const L = doc.commLock;
    if (L && +(L.amount || 0) > 0) {
      setAmt(String(L.amount));
      setCarpenter((L.carpenter || "").trim());
      setParty((L.party || doc.customerName || "").trim());
      setPartyId(L.partyId || doc.customerId || "");
    } else {
      setAmt("");
      setCarpenter((doc.site || "").trim());
      setParty((doc.customerName || "").trim());
      setPartyId(doc.customerId || "");
    }
    // Re-init when the saved lock changes, not on every poll clone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id, lockKey]);

  useEffect(() => {
    const go = () => setEditing(true);
    window.addEventListener("abuzar-comm-lock-edit", go);
    return () => window.removeEventListener("abuzar-comm-lock-edit", go);
  }, []);

  const carpenterLabel = (doc.commLock?.carpenter || carpenter || doc.site || "").trim();
  const partyLabel = (doc.commLock?.party || party || doc.customerName || "").trim();
  const tenant = matchPlaceRentTenant(
    {
      site: carpenterLabel || doc.site,
      sitePhone: doc.sitePhone,
      commLock: {
        amount: lockedAmt,
        carpenter: carpenterLabel,
        lockedBy: doc.commLock?.lockedBy || "",
        lockedAt: doc.commLock?.lockedAt || "",
      },
    },
    tenants,
  );
  const due = tenant ? placeRentDue(tenant, expenses) : 0;
  const towards = r2(+against || 0);
  const afterComm = r2(Math.max(0, due - towards));

  useEffect(() => {
    if (!tenant || pending <= 0) return;
    const against0 = r2(Math.min(pending, due));
    setAgainst(against0 ? String(against0) : "0");
    setCash("0");
  }, [doc.id, lockKey, tenant?.id, pending, due]);

  function fillFromDoc() {
    const L = doc.commLock;
    if (L && +(L.amount || 0) > 0) {
      setAmt(String(L.amount));
      setCarpenter((L.carpenter || "").trim());
      setParty((L.party || doc.customerName || "").trim());
      setPartyId(L.partyId || doc.customerId || "");
    }
  }

  function lockNow() {
    const a = Math.round(Math.max(0, +amt || 0) * 100) / 100;
    if (a <= 0) return toast("Enter the commission amount");
    const name = carpenter.trim() || (doc.site || "").trim();
    if (!name) return toast("Name the carpenter on this lock (or on the quotation)");
    if (!carpenter.trim()) setCarpenter(name);
    const partyName = party.trim() || (doc.customerName || "").trim();
    onCommit({
      amount: a,
      carpenter: name,
      party: partyName || undefined,
      partyId: partyId || doc.customerId || undefined,
      lockedBy: isLocked ? doc.commLock?.lockedBy || by : by || "unknown",
      lockedAt: isLocked && doc.commLock?.lockedAt ? doc.commLock.lockedAt : nowIso(),
    });
    setEditing(false);
    toast(isLocked ? "Lock updated · ₹" + inr(a) : "Commission locked · ₹" + inr(a) + " pending on Carpenters");
  }

  async function deleteLock() {
    const ok = await confirmDialog({
      title: "Delete this lock?",
      message:
        "Removes the decided amount from Carpenters pending. The quotation stays. Money already given stays in history.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    onCommit(undefined);
    setEditing(false);
    toast("Lock deleted");
  }

  function payNow() {
    if (pending <= 0) return;
    router.push(
      pendingPayHref({
        carpenter: carpenter.trim() || doc.commLock?.carpenter || doc.site || "",
        party: party.trim() || doc.commLock?.party || doc.customerName || "",
        partyId: partyId || doc.commLock?.partyId || doc.customerId || undefined,
        quoteId: doc.id,
        pending,
      }),
    );
  }

  async function putTowardsRent() {
    if (!tenant) return;
    try {
      await applyAgainstRent({
        tenant,
        quote: doc,
        against: +against || 0,
        cash: +cash || 0,
        enteredBy: by,
        expenses,
        placeRentMonth: setoffMonth || undefined,
      });
      bumpData();
      onApplied?.();
      toast("Commission put towards rent");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not apply");
    }
  }

  const towardsRentCard =
    tenant && isLocked && !editing && pending > 0 ? (
      <div className="rent-act" style={{ marginTop: 14 }}>
        <div className="rent-act-h">
          <span className="rent-act-n">1</span>
          <div>
            <b>Commission towards rent</b>
            <p>We owe them commission. Put it on this rent instead of paying cash.</p>
          </div>
        </div>
        <div className="rent-qrow" style={{ cursor: "default" }}>
          <span>
            #{doc.displayNumber || doc.number}
            <small>
              {(partyLabel || "—") + " · pending ₹" + inr(pending)}
              {tenant.name ? " · " + tenant.name : ""}
            </small>
          </span>
        </div>
        {tenant && unpaidChargedMonths(tenant, expenses).length > 0 && (
          <label className="modal-field">
            <span>Which month</span>
            <select className="paysel" value={setoffMonth} onChange={(e) => setSetoffMonth(e.target.value)}>
              <option value="">Old balance / any due</option>
              {unpaidChargedMonths(tenant, expenses).map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label} · left ₹{inr(m.remain)}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="rec-grid rec-grid-due">
          <label className="modal-field">
            <span>Towards rent ₹</span>
            <input type="number" inputMode="decimal" value={against} onChange={(e) => setAgainst(e.target.value)} />
          </label>
          <label className="modal-field">
            <span>Cash to them ₹</span>
            <input type="number" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} />
          </label>
        </div>
        <p className="rent-of">
          Pending ₹{inr(pending)}. Rent due ₹{inr(due)}.
          {towards > 0.5 ? " After this they owe ₹" + inr(afterComm) + "." : ""}
        </p>
        <div className="rowbtns">
          <button className="btn primary" type="button" onClick={() => void putTowardsRent()}>
            Put towards rent
          </button>
          <button className="btn sm" type="button" onClick={() => router.push("/rent/" + encodeURIComponent(tenant.id))}>
            Open rent
          </button>
        </div>
      </div>
    ) : null;

  return (
    <div
      id="comm-lock"
      className={"panel-card no-print" + (isLocked ? " comm-lock-on" : "")}
      style={{ marginTop: 12, padding: 14 }}
    >
      {isLocked && !editing ? (
        <>
          <div className="comm-lock-head">
            <span className="comm-lock-stamp">Locked</span>
            <span className="comm-lock-sum">₹{inr(lockedAmt)}</span>
          </div>
          <div className="comm-lock-meta">
            {carpenterLabel}
            {partyLabel ? ` · ${partyLabel}` : ""}
            {tenant ? " · Rent" : ""}
            <br />
            {pending > 0
              ? `Pending ₹${inr(pending)} of ₹${inr(lockedAmt)}`
              : `₹${inr(lockedAmt)} given in full`}
            {doc.commLock?.lockedBy ? ` · locked by ${userName(doc.commLock.lockedBy)}` : ""}
          </div>
          <div className="rowbtns" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn" type="button" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button className="btn warn" type="button" onClick={() => void deleteLock()}>
              Delete
            </button>
            {pending > 0 && (
              <button className={"btn" + (tenant ? "" : " primary")} type="button" onClick={payNow}>
                Pay ₹{inr(pending)}
              </button>
            )}
          </div>
          {towardsRentCard}
        </>
      ) : (
        <>
          <div className="comm-lock-head">
            {isLocked ? <span className="comm-lock-stamp">Locked</span> : null}
            <div style={{ fontFamily: "var(--disp)", fontWeight: 600 }}>
              {isLocked ? "Edit commission lock" : "Commission lock"}
            </div>
          </div>
          <small style={{ display: "block", color: "var(--ink-faint)", marginBottom: 12, lineHeight: 1.45 }}>
            Decides what we will pay the carpenter. Does not pay this wood bill. Pay later from Carpenters
            {isLocked
              ? pending > 0
                ? ` · pending ₹${inr(pending)} of ₹${inr(lockedAmt)}`
                : ` · ₹${inr(lockedAmt)} given in full`
              : ""}
            .
            {isLocked && doc.commLock?.lockedBy ? ` Locked by ${userName(doc.commLock.lockedBy)}.` : ""}
            {tenant ? " This person is on Rent — after Lock, put commission towards their rent." : ""}
          </small>
          <div className="pb-comm" style={{ padding: 0, borderBottom: 0 }}>
            <div className="rec-grid rec-grid-due">
              <label className="modal-field">
                <span>Amount ₹</span>
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="0"
                  value={amt}
                  onChange={(e) => setAmt(e.target.value)}
                />
              </label>
              <label className="modal-field">
                <span>Carpenter</span>
                <CarpenterPicker
                  value={carpenter}
                  carpenters={carpenters}
                  onType={setCarpenter}
                  onPick={(c) => setCarpenter(c.name)}
                  placeholder="Who receives this commission"
                />
              </label>
            </div>
            <label className="modal-field" style={{ width: "100%" }}>
              <span>Party / customer</span>
              <CustomerPicker
                value={party}
                customers={customers}
                onType={(v) => {
                  setParty(v);
                  setPartyId("");
                }}
                onPick={(c) => {
                  setParty(c.name);
                  setPartyId(c.id);
                }}
                placeholder="Usually this quotation's customer"
                maxResults={12}
              />
            </label>
            <div className="rowbtns" style={{ gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              <button className="btn primary" type="button" onClick={lockNow}>
                {isLocked ? "Save" : "Lock"}
              </button>
              {editing && (
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    fillFromDoc();
                    setEditing(false);
                  }}
                >
                  Cancel
                </button>
              )}
              {isLocked && (
                <button className="btn warn" type="button" onClick={() => void deleteLock()}>
                  Delete
                </button>
              )}
              {pending > 0 && (
                <button className="btn" type="button" onClick={payNow}>
                  Pay ₹{inr(pending)}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
