"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { inr } from "@/lib/calc";
import {
  addVoucher,
  contraLegs,
  dmyToIso,
  gstSplit,
  isoToDmy,
  journalLegs,
  paymentLegs,
  purchaseLegs,
  receiptLegs,
  salesLegs,
  PURCHASE_LEDGER,
  SALES_LEDGER,
  TAX_CGST,
  TAX_IGST,
  TAX_SGST,
} from "@/lib/ledger";
import { bumpData, toast } from "@/store/app-store";
import type { Ledger, VoucherType } from "@/lib/types";

const ACCOUNT_GROUPS = new Set(["Bank Accounts", "Bank OD", "Cash-in-hand"]);
// Tally F-key mapping shown on each type
const TYPES: { t: VoucherType; k: string }[] = [
  { t: "Contra", k: "F4" },
  { t: "Payment", k: "F5" },
  { t: "Receipt", k: "F6" },
  { t: "Journal", k: "F7" },
  { t: "Sales", k: "F8" },
  { t: "Purchase", k: "F9" },
];
const isGstType = (t: VoucherType) => t === "Sales" || t === "Purchase";

/** Tally-style accounting voucher screen. Keyboard: Enter advances fields, Esc cancels. */
export default function VoucherEntry({
  ledgers,
  enteredBy,
  initialType = "Receipt",
  fixedLedgerId,
  onDone,
  onCancel,
}: {
  ledgers: Ledger[];
  enteredBy: string;
  initialType?: VoucherType;
  fixedLedgerId?: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<VoucherType>(initialType);
  const [date, setDate] = useState(isoToDmy(new Date().toISOString().slice(0, 10)) || "");
  const [amount, setAmount] = useState("");
  const [gstKind, setGstKind] = useState<"split" | "igst" | "none">("split");
  const [rate, setRate] = useState("18");
  const [party, setParty] = useState(fixedLedgerId || "");
  const [account, setAccount] = useState("");
  const [fromAccount, setFromAccount] = useState("");
  const [drLedger, setDrLedger] = useState("");
  const [crLedger, setCrLedger] = useState("");
  const [tradeLedger, setTradeLedger] = useState("");
  const [narration, setNarration] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => setType(initialType), [initialType]);
  useEffect(() => {
    // focus first field for keyboard entry
    const first = bodyRef.current?.querySelector<HTMLElement>("[data-vf]");
    first?.focus();
  }, [type]);

  const accounts = useMemo(() => ledgers.filter((l) => ACCOUNT_GROUPS.has(l.group)), [ledgers]);
  const byName = (n: string) => ledgers.find((l) => l.name === n)?.id;
  const tax = { cgst: byName(TAX_CGST), sgst: byName(TAX_SGST), igst: byName(TAX_IGST) };
  const salesDefault = byName(SALES_LEDGER) || ledgers.find((l) => l.group === "Sales Accounts")?.id || "";
  const purchDefault = byName(PURCHASE_LEDGER) || ledgers.find((l) => l.group === "Purchase Accounts")?.id || "";

  const amt = +amount || 0;
  const g = isGstType(type) ? gstSplit(amt, +rate || 0, gstKind) : null;

  async function save() {
    try {
      if (type === "Receipt") {
        if (!account || !party || amt <= 0) return toast("Pick account, party and amount");
        await addVoucher({ type, date, legs: receiptLegs(account, party, amt), narration, enteredBy });
      } else if (type === "Payment") {
        if (!account || !party || amt <= 0) return toast("Pick party, account and amount");
        await addVoucher({ type, date, legs: paymentLegs(party, account, amt), narration, enteredBy });
      } else if (type === "Contra") {
        if (!account || !fromAccount || account === fromAccount || amt <= 0) return toast("Pick two different accounts + amount");
        await addVoucher({ type, date, legs: contraLegs(account, fromAccount, amt), narration, enteredBy });
      } else if (type === "Journal") {
        if (!drLedger || !crLedger || drLedger === crLedger || amt <= 0) return toast("Pick Dr, Cr ledgers + amount");
        await addVoucher({ type, date, legs: journalLegs(drLedger, crLedger, amt), narration, enteredBy });
      } else if (type === "Sales") {
        const sid = tradeLedger || salesDefault;
        if (!party || !sid || amt <= 0) return toast("Pick party, sales head + taxable amount");
        await addVoucher({ type, date, legs: salesLegs(party, sid, amt, +rate || 0, gstKind, tax), narration, enteredBy });
      } else {
        const pid = tradeLedger || purchDefault;
        if (!party || !pid || amt <= 0) return toast("Pick party, purchase head + taxable amount");
        await addVoucher({ type, date, legs: purchaseLegs(party, pid, amt, +rate || 0, gstKind, tax), narration, enteredBy });
      }
      bumpData();
      onDone();
      toast(type + " voucher saved ✓");
    } catch (e) {
      toast((e as Error).message || "Could not save");
    }
  }

  // Enter advances to next field; Ctrl/Cmd+Enter (or Enter on last) saves.
  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key === "Enter") {
      const fields = Array.from(bodyRef.current?.querySelectorAll<HTMLElement>("[data-vf]") || []);
      const i = fields.indexOf(e.target as HTMLElement);
      if (e.ctrlKey || e.metaKey || i === fields.length - 1) {
        e.preventDefault();
        save();
      } else if (i >= 0) {
        e.preventDefault();
        fields[i + 1]?.focus();
      }
    }
  }

  const opt = (opts: Ledger[], grouped = true) =>
    grouped ? groupedOptions(opts) : opts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>);
  const row = (label: string, side: "Dr" | "Cr" | "", node: React.ReactNode) => (
    <div className="t-vrow">
      <label>{label}</label>
      {side && <span className={"drcr " + side.toLowerCase()}>{side}</span>}
      {node}
    </div>
  );

  return (
    <div className="t-voucher" onKeyDown={onKey}>
      <div className="t-vtypes">
        {TYPES.map(({ t, k }) => (
          <button key={t} className={"t-vtype" + (t === type ? " on" : "")} onClick={() => setType(t)}>
            {k} {t}
          </button>
        ))}
      </div>
      <div className="t-vbody" ref={bodyRef}>
        {row("Date", "", <input data-vf type="date" value={dmyToIso(date)} onChange={(e) => setDate(isoToDmy(e.target.value))} />)}

        {type === "Receipt" && (
          <>
            {row("Account", "Dr", <select data-vf value={account} onChange={(e) => setAccount(e.target.value)}><option value="">Cash / Bank…</option>{opt(accounts)}</select>)}
            {row("Particulars", "Cr", <select data-vf value={party} onChange={(e) => setParty(e.target.value)}><option value="">Received from…</option>{opt(ledgers)}</select>)}
          </>
        )}
        {type === "Payment" && (
          <>
            {row("Particulars", "Dr", <select data-vf value={party} onChange={(e) => setParty(e.target.value)}><option value="">Paid to…</option>{opt(ledgers)}</select>)}
            {row("Account", "Cr", <select data-vf value={account} onChange={(e) => setAccount(e.target.value)}><option value="">Cash / Bank…</option>{opt(accounts)}</select>)}
          </>
        )}
        {type === "Contra" && (
          <>
            {row("To account", "Dr", <select data-vf value={account} onChange={(e) => setAccount(e.target.value)}><option value="">Into…</option>{opt(accounts)}</select>)}
            {row("From account", "Cr", <select data-vf value={fromAccount} onChange={(e) => setFromAccount(e.target.value)}><option value="">Out of…</option>{opt(accounts)}</select>)}
          </>
        )}
        {type === "Journal" && (
          <>
            {row("Debit", "Dr", <select data-vf value={drLedger} onChange={(e) => setDrLedger(e.target.value)}><option value="">Ledger…</option>{opt(ledgers)}</select>)}
            {row("Credit", "Cr", <select data-vf value={crLedger} onChange={(e) => setCrLedger(e.target.value)}><option value="">Ledger…</option>{opt(ledgers)}</select>)}
          </>
        )}
        {isGstType(type) && (
          <>
            {row(type === "Sales" ? "Customer" : "Supplier", type === "Sales" ? "Dr" : "Cr",
              <select data-vf value={party} onChange={(e) => setParty(e.target.value)}><option value="">Party…</option>{opt(ledgers)}</select>)}
            {row(type === "Sales" ? "Sales head" : "Purchase head", type === "Sales" ? "Cr" : "Dr",
              <select data-vf value={tradeLedger || (type === "Sales" ? salesDefault : purchDefault)} onChange={(e) => setTradeLedger(e.target.value)}>
                {opt(ledgers.filter((l) => l.group === (type === "Sales" ? "Sales Accounts" : "Purchase Accounts")), false)}
              </select>)}
            {row("GST", "", <select data-vf value={gstKind} onChange={(e) => setGstKind(e.target.value as "split" | "igst" | "none")}>
              <option value="split">SGST + CGST</option>
              <option value="igst">IGST (interstate)</option>
              <option value="none">No GST</option>
            </select>)}
            {gstKind !== "none" && row("Rate %", "", <input data-vf type="number" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />)}
          </>
        )}

        {row(isGstType(type) ? "Taxable amount" : "Amount", "", <input data-vf type="number" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />)}
        {row("Narration", "", <input data-vf placeholder="bill / cheque no / note…" value={narration} onChange={(e) => setNarration(e.target.value)} />)}
      </div>

      {g && amt > 0 && (
        <div className="t-vgst">
          Taxable ₹{inr(g.taxable)}
          {gstKind === "split" && <> · CGST ₹{inr(g.cgst)} · SGST ₹{inr(g.sgst)}</>}
          {gstKind === "igst" && <> · IGST ₹{inr(g.igst)}</>}
          {" "}· <b>Total ₹{inr(g.total)}</b>
        </div>
      )}

      <button className="t-vsave" onClick={save}>Accept (Enter) ✓</button>
    </div>
  );
}

function groupedOptions(ledgers: Ledger[]) {
  const groups = new Map<string, Ledger[]>();
  for (const l of ledgers) {
    const arr = groups.get(l.group) || [];
    arr.push(l);
    groups.set(l.group, arr);
  }
  return [...groups.entries()].map(([group, ls]) => (
    <optgroup key={group} label={group}>
      {ls.sort((a, b) => a.name.localeCompare(b.name)).map((l) => (
        <option key={l.id} value={l.id}>{l.name}</option>
      ))}
    </optgroup>
  ));
}
