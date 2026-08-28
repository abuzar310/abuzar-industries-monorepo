"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec } from "@/lib/data";
import { inr, todayStr } from "@/lib/calc";
import { lockAmount } from "@/lib/carpenter-financials";
import { allExpenses } from "@/lib/expenses";
import {
  addPlaceRentDebt,
  applyAgainstRent,
  chargePlaceRent,
  ensurePlaceRentTenants,
  monthCharged,
  monthTitle,
  pendingForTenant,
  placeRentDue,
  placeRentStatement,
  receivePlaceRent,
  setMonthlyRent,
  type PlaceRentStmt,
} from "@/lib/place-rent";
import { dialPhone, waLink } from "@/lib/whatsapp";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import { Paged } from "@/components/Pager";
import type { Carpenter, Doc, Expense } from "@/lib/types";

const r2 = (n: number) => Math.round(n * 100) / 100;

type RecordPanel = "" | "charge" | "received" | "convert" | "monthly" | "debt";

function dmyToIso(dmy: string) {
  const [d, m, y] = (dmy || "").split("-");
  return d && m && y ? `20${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` : "";
}
function isoToDmy(iso: string) {
  const [y, m, d] = (iso || "").split("-");
  return d && m && y ? `${d}-${m}-${y.slice(2)}` : "";
}

export default function RentView() {
  const { ready, dataVersion, user, cloakMoney } = useApp();
  const [tenants, setTenants] = useState<Carpenter[]>([]);
  const [quotes, setQuotes] = useState<Doc[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [openId, setOpenId] = useState("");

  const load = useCallback(() => {
    Promise.all([ensurePlaceRentTenants(), allRec<Doc>("quotations"), allExpenses()]).then(([t, q, e]) => {
      setTenants(cloakMoney ? [] : t);
      setQuotes(cloakMoney ? [] : q);
      setExpenses(cloakMoney ? [] : e);
    });
  }, [cloakMoney]);

  useEffect(() => {
    if (ready) load();
  }, [ready, dataVersion, load]);

  useEffect(() => {
    if (!openId) return;
    document.getElementById("rent-sec-" + openId)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [openId]);

  function toggle(id: string) {
    setOpenId((cur) => (cur === id ? "" : id));
  }

  return (
    <div>
      <div className="sectitle">
        Rent <small>— place rent for two people · cash received goes to Daybook &amp; Receipts</small>
      </div>
      <div className="rent-hero">
        {tenants.map((c) => (
          <HeroCard
            key={c.id}
            tenant={c}
            quotes={quotes}
            expenses={expenses}
            open={openId === c.id}
            onToggle={() => toggle(c.id)}
          />
        ))}
      </div>
      {!tenants.length && !cloakMoney && (
        <div className="empty">
          <div className="empty-title">Loading place rent…</div>
        </div>
      )}
      {!!tenants.length && !openId && (
        <div className="rent-hint">Tap a card for that person — what they owe, rent history, and commission converted into rent.</div>
      )}
      {tenants.map((c) => (
        <RentSection
          key={c.id}
          tenant={c}
          quotes={quotes}
          expenses={expenses}
          enteredBy={user?.id || "unknown"}
          open={openId === c.id}
          onDone={load}
        />
      ))}
    </div>
  );
}

function HeroCard({
  tenant,
  quotes,
  expenses,
  open,
  onToggle,
}: {
  tenant: Carpenter;
  quotes: Doc[];
  expenses: Expense[];
  open: boolean;
  onToggle: () => void;
}) {
  const due = placeRentDue(tenant, expenses);
  const pendingSum = r2(pendingForTenant(tenant, quotes, expenses).reduce((s, p) => s + p.pending, 0));
  const headline = due > 0.5 ? "They owe" : pendingSum > 0.5 ? "We owe" : "Settled";
  const headAmt = due > 0.5 ? due : pendingSum > 0.5 ? pendingSum : 0;
  const today = todayStr();
  const charged = monthCharged(tenant, expenses, today);

  return (
    <button
      type="button"
      className={"rent-pick" + (open ? " on" : "")}
      aria-pressed={open}
      aria-expanded={open}
      aria-controls={"rent-sec-" + tenant.id}
      onClick={onToggle}
    >
      <div className="rent-pick-top">
        <span className="rent-pick-name">{tenant.name}</span>
        <span className="rent-pick-caret" aria-hidden>
          {open ? "▴" : "▾"}
        </span>
      </div>
      <div className="rent-pick-phone">{tenant.phone || "—"}</div>
      <div className="rent-pick-k">{headline}</div>
      <div className={"rent-pick-v" + (due > 0.5 ? " due" : "")}>{headAmt > 0.5 ? "₹ " + inr(headAmt) : "✓"}</div>
      <div className="rent-pick-sub">
        {charged ? monthTitle(today) + " charged" : monthTitle(today) + " not charged"}
        {r2(+(tenant.monthlyRent || 0) || 0) > 0 ? " · monthly ₹" + inr(tenant.monthlyRent || 0) : ""}
      </div>
    </button>
  );
}

function RentSection({
  tenant,
  quotes,
  expenses,
  enteredBy,
  open,
  onDone,
}: {
  tenant: Carpenter;
  quotes: Doc[];
  expenses: Expense[];
  enteredBy: string;
  open: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const due = placeRentDue(tenant, expenses);
  const today = todayStr();
  const charged = monthCharged(tenant, expenses, today);
  const pending = pendingForTenant(tenant, quotes, expenses);
  const pendingSum = r2(pending.reduce((s, p) => s + p.pending, 0));
  const stmt = placeRentStatement(tenant, expenses);
  const rentHist = [...stmt.filter((e) => e.kind !== "setoff")].reverse();
  const converted = [...stmt.filter((e) => e.kind === "setoff")].reverse();
  const monthly = r2(+(tenant.monthlyRent || 0) || 0);
  const tot = stmtTotals(stmt);

  const [panel, setPanel] = useState<RecordPanel>("");
  const [chargeAmt, setChargeAmt] = useState("");
  const [recvAmt, setRecvAmt] = useState("");
  const [recvHow, setRecvHow] = useState("cash");
  const [recvAccount, setRecvAccount] = useState("");
  const [recvNote, setRecvNote] = useState("");
  const [monthAmt, setMonthAmt] = useState("");
  const [quoteId, setQuoteId] = useState("");
  const [against, setAgainst] = useState("");
  const [cash, setCash] = useState("");
  const [debtAmt, setDebtAmt] = useState("");
  const [debtNote, setDebtNote] = useState("");
  const [debtDate, setDebtDate] = useState("");

  useEffect(() => {
    if (!open) return;
    setPanel("");
    setChargeAmt(monthly ? String(monthly) : "");
    setMonthAmt(monthly ? String(monthly) : "");
    setRecvAmt("");
    setRecvHow("cash");
    setRecvAccount("");
    setRecvNote("");
    const first = pending[0];
    setQuoteId(first?.d.id || "");
    const against0 = first ? r2(Math.min(first.pending, due)) : 0;
    setAgainst(against0 ? String(against0) : "0");
    setCash("0");
    setDebtAmt("");
    setDebtNote("");
    setDebtDate(dmyToIso(today));
    // Reset the form when this person's section is opened, not on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tenant.id]);

  const picked = pending.find((p) => p.d.id === quoteId) || pending[0];

  function onRecord(v: string) {
    if (v === "call") {
      if (tenant.phone) dialPhone(tenant.phone);
      return;
    }
    if (v === "wa") {
      if (tenant.phone) window.open(waLink(tenant.phone, "Hello " + tenant.name), "_blank");
      return;
    }
    if (v === "charge" && charged) return toast(monthTitle(today) + " already charged");
    if (v === "convert" && !pending.length) return toast("No pending commission on a quotation");
    setPanel(v as RecordPanel);
  }

  async function doCharge() {
    try {
      await chargePlaceRent(tenant, +chargeAmt || 0, enteredBy);
      bumpData();
      onDone();
      setPanel("");
      toast("Place rent charged · they owe ₹" + inr(+chargeAmt || 0));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not charge");
    }
  }

  async function doReceived() {
    const mode = recvHow === "upi" ? "upi" : "cash";
    try {
      await receivePlaceRent(tenant, +recvAmt || 0, enteredBy, mode, recvAccount, recvHow === "owner", recvNote);
      bumpData();
      onDone();
      setPanel("");
      toast("₹" + inr(+recvAmt || 0) + " received · Receipts & Daybook");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not record");
    }
  }

  async function doMonthly() {
    await setMonthlyRent(tenant, +monthAmt || 0);
    bumpData();
    onDone();
    setPanel("");
    toast("Monthly rent saved");
  }

  async function doDebt() {
    try {
      await addPlaceRentDebt(tenant, +debtAmt || 0, enteredBy, debtNote, isoToDmy(debtDate) || today);
      bumpData();
      onDone();
      setPanel("");
      toast("Old debt added · they owe ₹" + inr(+debtAmt || 0));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not add old debt");
    }
  }

  async function doConvert() {
    if (!picked) return toast("Pick a quotation");
    try {
      await applyAgainstRent({
        tenant,
        quote: picked.d,
        against: +against || 0,
        cash: +cash || 0,
        enteredBy,
        expenses,
      });
      bumpData();
      onDone();
      setPanel("");
      toast("Commission converted into rent");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not apply");
    }
  }

  function onQuoteChange(id: string) {
    setQuoteId(id);
    const row = pending.find((p) => p.d.id === id);
    if (!row) return;
    const against0 = r2(Math.min(row.pending, due));
    setAgainst(against0 ? String(against0) : "0");
    setCash("0");
  }

  return (
    <section
      id={"rent-sec-" + tenant.id}
      className="rent-section"
      hidden={!open}
      aria-label={tenant.name + " place rent"}
    >
      <div className="pc-head">
        <span>{tenant.name}</span>
        <span style={{ fontFamily: "var(--mono)", fontSize: 12, letterSpacing: 0, textTransform: "none" }}>
          {tenant.phone || "—"}
        </span>
      </div>

      <div className="rent-body">
        <div className="rent-owe">
          <div className="rent-owe-row hero">
            <span>Place rent due</span>
            <b className={due > 0.5 ? "due" : ""}>{due > 0.5 ? "₹ " + inr(due) : "Settled"}</b>
          </div>
          <div className="rent-owe-row">
            <span>This month</span>
            <span>{charged ? monthTitle(today) + " charged" : monthTitle(today) + " not charged"}</span>
          </div>
          <div className="rent-owe-row">
            <span>Monthly figure</span>
            <span>{monthly > 0 ? "₹ " + inr(monthly) : "not set"}</span>
          </div>
          <div className="rent-owe-row">
            <span>Old debt brought in</span>
            <span>₹ {inr(tot.opening)}</span>
          </div>
          <div className="rent-owe-row">
            <span>Charged (months)</span>
            <span>₹ {inr(tot.charged)}</span>
          </div>
          <div className="rent-owe-row">
            <span>Cash received</span>
            <span>− ₹ {inr(tot.received)}</span>
          </div>
          <div className="rent-owe-row">
            <span>Commission → rent</span>
            <span>− ₹ {inr(tot.setoff)}</span>
          </div>
          <div className="rent-owe-row">
            <span>Commission we still owe</span>
            <span>{pendingSum > 0.5 ? "₹ " + inr(pendingSum) : "—"}</span>
          </div>
        </div>

        {pending.length > 0 && (
          <div className="rent-pending">
            <div className="rent-pending-h">Locked quotations — pending commission</div>
            {pending.map((p) => (
              <button
                key={p.d.id}
                type="button"
                className="rent-qrow"
                onClick={() => router.push("/editor/" + p.d.id)}
              >
                <span>
                  #{p.d.displayNumber || p.d.number}
                  <small>
                    {(p.d.commLock?.party || p.d.customerName || "—") +
                      " · locked ₹" +
                      inr(lockAmount(p.d)) +
                      " · pending ₹" +
                      inr(p.pending)}
                  </small>
                </span>
                <span className="rent-qgo">Open</span>
              </button>
            ))}
          </div>
        )}

        <div className="rent-form rent-quick">
          <label className="modal-field">
            <span>Monthly rent ₹</span>
            <input
              type="number"
              inputMode="decimal"
              value={monthAmt}
              onChange={(e) => setMonthAmt(e.target.value)}
              placeholder="usual charge each month"
            />
          </label>
          <div className="rowbtns">
            <button className="btn sm" type="button" onClick={() => void doMonthly()}>
              Save monthly ₹
            </button>
          </div>
        </div>

        <label className="modal-field rent-record">
          <span>Record</span>
          <select
            className="paysel"
            value=""
            aria-label={"Record for " + tenant.name}
            onChange={(e) => {
              const v = e.target.value;
              e.target.value = "";
              if (v) onRecord(v);
            }}
          >
            <option value="">Choose…</option>
            <option value="debt">Old debt (they already owe)</option>
            <option value="charge" disabled={charged}>
              {charged ? monthTitle(today) + " already charged" : "Charge " + monthTitle(today)}
            </option>
            <option value="received">Cash received</option>
            <option value="convert" disabled={!pending.length}>
              {pending.length ? "Convert commission → rent" : "No commission to convert"}
            </option>
            <option value="monthly">Set monthly ₹</option>
            {tenant.phone ? <option value="call">Call</option> : null}
            {tenant.phone ? <option value="wa">WhatsApp</option> : null}
          </select>
        </label>

        {panel === "charge" && (
          <div className="rent-form">
            <label className="modal-field">
              <span>Charge {monthTitle(today)} ₹</span>
              <input type="number" inputMode="decimal" value={chargeAmt} onChange={(e) => setChargeAmt(e.target.value)} />
            </label>
            <div className="rowbtns">
              <button className="btn primary sm" type="button" onClick={() => void doCharge()}>
                Charge
              </button>
              <button className="btn sm" type="button" onClick={() => setPanel("")}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {panel === "received" && (
          <div className="rent-form">
            <div className="rec-grid rec-grid-due">
              <label className="modal-field">
                <span>Amount ₹</span>
                <input type="number" inputMode="decimal" value={recvAmt} onChange={(e) => setRecvAmt(e.target.value)} />
              </label>
              <label className="modal-field">
                <span>How</span>
                <select className="paysel" value={recvHow} onChange={(e) => setRecvHow(e.target.value)}>
                  <option value="cash">Cash (Daybook)</option>
                  <option value="upi">UPI</option>
                  <option value="owner">Cash → Owner</option>
                </select>
              </label>
            </div>
            {recvHow === "upi" && (
              <label className="modal-field">
                <span>UPI account</span>
                <input value={recvAccount} onChange={(e) => setRecvAccount(e.target.value)} placeholder="GPay / PhonePe…" />
              </label>
            )}
            <label className="modal-field">
              <span>Note</span>
              <input value={recvNote} onChange={(e) => setRecvNote(e.target.value)} placeholder="optional" />
            </label>
            <div className="rowbtns">
              <button className="btn primary sm" type="button" onClick={() => void doReceived()}>
                Received
              </button>
              <button className="btn sm" type="button" onClick={() => setPanel("")}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {panel === "debt" && (
          <div className="rent-form">
            <p className="note" style={{ margin: "0 0 10px" }}>
              Rent they already owe from before. Adds to place rent due. Does not count as this month&apos;s charge and
              does not go through Daybook.
            </p>
            <div className="rec-grid rec-grid-due">
              <label className="modal-field">
                <span>Old debt ₹</span>
                <input type="number" inputMode="decimal" value={debtAmt} onChange={(e) => setDebtAmt(e.target.value)} />
              </label>
              <label className="modal-field">
                <span>From date</span>
                <input type="date" value={debtDate} onChange={(e) => setDebtDate(e.target.value)} />
              </label>
            </div>
            <label className="modal-field">
              <span>Note</span>
              <input value={debtNote} onChange={(e) => setDebtNote(e.target.value)} placeholder="e.g. arrears till July" />
            </label>
            <div className="rowbtns">
              <button className="btn primary sm" type="button" onClick={() => void doDebt()}>
                Add old debt
              </button>
              <button className="btn sm" type="button" onClick={() => setPanel("")}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {panel === "monthly" && (
          <div className="rent-form">
            <label className="modal-field">
              <span>Monthly ₹</span>
              <input type="number" inputMode="decimal" value={monthAmt} onChange={(e) => setMonthAmt(e.target.value)} />
            </label>
            <div className="rowbtns">
              <button className="btn primary sm" type="button" onClick={() => void doMonthly()}>
                Save
              </button>
              <button className="btn sm" type="button" onClick={() => setPanel("")}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {panel === "convert" && (
          <div className="rent-form">
            <p className="note" style={{ margin: "0 0 10px" }}>
              Against rent is not cash. Cash commission goes to Daybook. Sum cannot exceed pending
              {picked ? " ₹" + inr(picked.pending) : ""}. Place rent due ₹{inr(due)}.
            </p>
            <label className="modal-field">
              <span>Quotation</span>
              <select className="paysel" value={picked?.d.id || ""} onChange={(e) => onQuoteChange(e.target.value)}>
                {pending.map((p) => (
                  <option key={p.d.id} value={p.d.id}>
                    #{p.d.displayNumber || p.d.number} · pending ₹{inr(p.pending)}
                  </option>
                ))}
              </select>
            </label>
            <div className="rec-grid rec-grid-due">
              <label className="modal-field">
                <span>Against rent ₹</span>
                <input type="number" inputMode="decimal" value={against} onChange={(e) => setAgainst(e.target.value)} />
              </label>
              <label className="modal-field">
                <span>Cash commission ₹</span>
                <input type="number" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} />
              </label>
            </div>
            <div className="rowbtns">
              <button className="btn primary sm" type="button" onClick={() => void doConvert()}>
                Convert
              </button>
              <button className="btn sm" type="button" onClick={() => setPanel("")}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <details className="sqltoggle rent-hist" open>
          <summary>Place rent history</summary>
          <HistList
            items={rentHist}
            empty="Old debt, this month's charge, and cash received show here."
            resetKey={tenant.id + "-rent-" + rentHist.length}
            onQuote={(id) => router.push("/editor/" + id)}
          />
        </details>

        <details className="sqltoggle rent-hist" open>
          <summary>Commission converted into rent</summary>
          <HistList
            items={converted}
            empty="Convert pending commission from Record → Convert commission → rent, or from a locked quotation."
            resetKey={tenant.id + "-setoff-" + converted.length}
            onQuote={(id) => router.push("/editor/" + id)}
          />
        </details>
      </div>
    </section>
  );
}

function stmtTotals(stmt: PlaceRentStmt[]) {
  let charged = 0,
    opening = 0,
    received = 0,
    setoff = 0;
  for (const e of stmt) {
    const a = Math.abs(e.signed);
    if (e.kind === "charge") charged += a;
    else if (e.kind === "opening") opening += a;
    else if (e.kind === "received") received += a;
    else setoff += a;
  }
  return { charged: r2(charged), opening: r2(opening), received: r2(received), setoff: r2(setoff) };
}

function HistList({
  items,
  empty,
  resetKey,
  onQuote,
}: {
  items: PlaceRentStmt[];
  empty: string;
  resetKey: string;
  onQuote: (id: string) => void;
}) {
  if (!items.length) return <div className="empty-note" style={{ padding: "8px 0 4px" }}>{empty}</div>;
  return (
    <Paged items={items} resetKey={resetKey}>
      {(view) => (
        <div className="cs-card rent-hist-list">
          {view.map((ev) => (
            <div
              className="stmt"
              key={ev.id}
              style={ev.quoteId ? { cursor: "pointer" } : undefined}
              onClick={ev.quoteId ? () => onQuote(ev.quoteId!) : undefined}
            >
              <div className={"stmt-ic " + (ev.kind === "received" ? "cash" : ev.kind === "setoff" ? "upi" : "due")}>
                {ev.kind === "received" ? "₹" : ev.kind === "setoff" ? "−" : ev.kind === "opening" ? "Old" : "Rent"}
              </div>
              <div className="stmt-main">
                <div className="stmt-to">{ev.label}</div>
                <div className="stmt-sub">{[ev.date, ev.sub].filter(Boolean).join(" · ")}</div>
              </div>
              <div className="cs-amt">
                <div className={"stmt-amt" + (ev.signed > 0 ? " due" : "")}>
                  {ev.signed > 0 ? "+" : "−"}₹{inr(Math.abs(ev.signed))}
                </div>
                <small className="cs-runbal">due ₹{inr(ev.bal)}</small>
              </div>
            </div>
          ))}
        </div>
      )}
    </Paged>
  );
}
