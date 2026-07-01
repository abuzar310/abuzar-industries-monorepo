"use client";
import { useEffect, useRef, useState } from "react";
import { inr } from "@/lib/calc";
import { addEntry, editEntry, gstOf, dmyToIso, isoToDmy } from "@/lib/ledger";
import { bumpData, toast } from "@/store/app-store";
import type { Account, Customer, LedgerEntry, Vendor, VoucherKind } from "@/lib/types";

const TYPE_LABEL: Record<VoucherKind, string> = {
  opening: "Opening Balance",
  sale: "Sales",
  purchase: "Purchase",
  receipt: "Receipt",
  payment: "Payment",
  contra: "Contra (transfer)",
};
const GST_RATES = [0, 5, 12, 18, 28];

type Scope = "debtor" | "creditor" | "bank" | "party";

function typesFor(scope: Scope, partyKind?: "debtor" | "creditor"): VoucherKind[] {
  if (scope === "bank") return ["receipt", "payment", "contra"];
  const kind = scope === "party" ? partyKind : scope;
  return kind === "creditor" ? ["purchase", "payment", "opening"] : ["sale", "receipt", "opening"];
}

export default function VoucherForm({
  scope,
  party,
  customers,
  vendors,
  accounts,
  enteredBy,
  editing,
  onDone,
  onCancelEdit,
}: {
  scope: Scope;
  party?: { kind: "debtor" | "creditor"; id: string };
  customers: Customer[];
  vendors: Vendor[];
  accounts: Account[];
  enteredBy: string;
  editing?: LedgerEntry | null;
  onDone: () => void;
  onCancelEdit?: () => void;
}) {
  // State is initialised once from `editing`; the parent passes a `key` so the
  // form remounts (and re-initialises) when the edit target changes.
  const allowed = typesFor(scope, party?.kind);
  const ed = editing;
  const firstAcct = accounts[0]?.id || "";
  const secondAcct = accounts[1]?.id || firstAcct;
  const [type, setType] = useState<VoucherKind>(ed ? ed.kind : allowed[0]);
  const [partyId, setPartyId] = useState(ed ? ed.partyId : party?.id || "");
  const [amount, setAmount] = useState(ed ? String(ed.kind === "sale" || ed.kind === "purchase" ? ed.taxable : ed.amount) : "");
  const [gstRate, setGstRate] = useState(ed ? String(ed.gstRate || 0) : "18");
  const [acct, setAcct] = useState(ed ? (ed.kind === "contra" ? ed.fromAccount : ed.account || firstAcct) : firstAcct);
  const [toAcct, setToAcct] = useState(ed && ed.kind === "contra" ? ed.account : secondAcct);
  const [date, setDate] = useState(ed ? ed.date : "");
  const [ref, setRef] = useState(ed ? ed.ref : "");
  const [note, setNote] = useState(ed ? ed.note : "");
  const amountRef = useRef<HTMLInputElement>(null);

  // focus the amount when opened for editing (DOM side-effect, runs once)
  useEffect(() => {
    if (ed) amountRef.current?.focus();
  }, [ed]);

  const isGst = type === "sale" || type === "purchase";
  const isContra = type === "contra";
  const needsAccount = type === "receipt" || type === "payment" || type === "contra";
  // party kind implied by (scope, type)
  const partyKind: "debtor" | "creditor" | "" = isContra
    ? ""
    : scope === "party"
      ? party!.kind
      : scope === "bank"
        ? type === "receipt"
          ? "debtor"
          : "creditor"
        : scope;
  const showParty = !isContra && scope !== "party";
  const partyOpts = partyKind === "creditor" ? vendors : customers;
  const { total } = gstOf(+amount || 0, +gstRate || 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = +amount || 0;
    if (amt <= 0) {
      amountRef.current?.focus();
      return toast("Enter an amount");
    }
    const pid = scope === "party" ? party!.id : partyId;
    if (showParty && !pid) return toast(partyKind === "creditor" ? "Select a vendor" : "Select a customer");
    if (isContra && acct === toAcct) return toast("Pick two different accounts");
    if (needsAccount && !(isContra ? toAcct && acct : acct)) return toast("Pick an account");

    const input = {
      kind: type,
      date,
      partyKind,
      partyId: pid,
      amount: amt,
      gstRate: isGst ? +gstRate || 0 : 0,
      account: isContra ? toAcct : needsAccount ? acct : "",
      fromAccount: isContra ? acct : "",
      ref,
      note,
      enteredBy,
    };
    if (editing) {
      await editEntry(editing.id, input);
      toast("Entry updated");
      bumpData();
      onDone();
      onCancelEdit?.(); // parent clears `editing` -> form remounts fresh
      return;
    }
    await addEntry(input);
    toast("Entry added");
    // keep type/party/account/date for fast repeated entry
    setAmount("");
    setRef("");
    setNote("");
    amountRef.current?.focus();
    bumpData();
    onDone();
  }

  return (
    <form className="panel-card daybook-entry" onSubmit={submit}>
      <label className="modal-field">
        <span>Type</span>
        <select value={type} onChange={(e) => setType(e.target.value as VoucherKind)}>
          {allowed.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </label>

      {showParty && (
        <label className="modal-field">
          <span>{partyKind === "creditor" ? "Vendor" : "Customer"}</span>
          <select value={partyId} onChange={(e) => setPartyId(e.target.value)}>
            <option value="">Select…</option>
            {partyOpts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="modal-field">
        <span>{isGst ? "Taxable (₹)" : "Amount (₹)"}</span>
        <input ref={amountRef} type="number" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>

      {isGst && (
        <label className="modal-field">
          <span>GST %</span>
          <select value={gstRate} onChange={(e) => setGstRate(e.target.value)}>
            {GST_RATES.map((r) => (
              <option key={r} value={r}>
                {r}%
              </option>
            ))}
          </select>
        </label>
      )}

      {needsAccount && (
        <label className="modal-field">
          <span>{isContra ? "From account" : "Account"}</span>
          <select value={acct} onChange={(e) => setAcct(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {isContra && (
        <label className="modal-field">
          <span>To account</span>
          <select value={toAcct} onChange={(e) => setToAcct(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="modal-field">
        <span>Date</span>
        <input type="date" value={dmyToIso(date)} onChange={(e) => setDate(isoToDmy(e.target.value))} />
      </label>

      <label className="modal-field">
        <span>Ref.</span>
        <input placeholder="bill / cheque no." value={ref} onChange={(e) => setRef(e.target.value)} />
      </label>

      <label className="modal-field note">
        <span>Narration</span>
        <input placeholder="e.g. part payment, lorry no…" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>

      <button className="btn primary" type="submit">
        {editing ? "Save" : "Add voucher"}
      </button>
      {editing && onCancelEdit && (
        <button className="btn" type="button" onClick={onCancelEdit}>
          Cancel
        </button>
      )}
      {isGst && +amount > 0 && (
        <div style={{ flexBasis: "100%", fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-faint)" }}>
          GST ₹{inr(gstOf(+amount || 0, +gstRate || 0).gstAmount)} · Total ₹{inr(total)}
        </div>
      )}
    </form>
  );
}
