"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { inr, todayStr } from "@/lib/calc";
import { editCarpenterDialog, listCarpenters } from "@/lib/carpenters";
import { allRec } from "@/lib/data";
import { allExpenses, upiAccounts } from "@/lib/expenses";
import {
  MONTH_NAMES,
  applyAgainstRent,
  chargeOfMonth,
  chargePlaceRent,
  ensurePlaceRentTenants,
  findDuplicateCarpenters,
  monthAlloc,
  monthFirstDay,
  monthRemain,
  monthRentStatus,
  monthTitle,
  pendingForTenant,
  placeRentDue,
  placeRentStatement,
  receivePlaceRent,
  rentOpeningOf,
  setMonthlyRent,
  setRentOpening,
  unchargePlaceRent,
  unpaidChargedMonths,
  yearFromDmy,
  yearMonthsCharged,
} from "@/lib/place-rent";
import { formDialog, type DialogField } from "@/store/dialog-store";
import { dialPhone, waLink } from "@/lib/whatsapp";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import type { Carpenter, Doc, Expense } from "@/lib/types";
import { HistList, mergeDuplicates, pullCarpenter, r2 } from "./rent-ui";

export default function RentDetail({ id }: { id: string }) {
  const { ready, dataVersion, user, cloakMoney } = useApp();
  const router = useRouter();
  const [tenants, setTenants] = useState<Carpenter[]>([]);
  const [directory, setDirectory] = useState<Carpenter[]>([]);
  const [quotes, setQuotes] = useState<Doc[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    Promise.all([ensurePlaceRentTenants(), listCarpenters(), allRec<Doc>("quotations"), allExpenses()]).then(
      ([t, dir, q, e]) => {
        setTenants(cloakMoney ? [] : t);
        setDirectory(cloakMoney ? [] : dir);
        setQuotes(cloakMoney ? [] : q);
        setExpenses(cloakMoney ? [] : e);
        setLoaded(true);
      },
    );
  }, [cloakMoney]);

  useEffect(() => {
    if (ready) load();
  }, [ready, dataVersion, load]);

  const tenant = tenants.find((c) => c.id === id) || directory.find((c) => c.id === id);

  async function go(next: Carpenter | "deleted" | null) {
    if (!next) return;
    bumpData();
    if (next === "deleted") {
      router.push("/rent");
      return;
    }
    if (next.id !== id) router.replace("/rent/" + encodeURIComponent(next.id));
    load();
  }

  async function onPull() {
    const next = await pullCarpenter(tenant, directory);
    if (!next) return;
    toast("Rent card is " + next.name);
    await go(next);
  }

  async function onMerge() {
    if (!tenant) return;
    const next = await mergeDuplicates(tenant, directory);
    if (!next) return;
    toast("Merged into " + next.name);
    await go(next);
  }

  async function onEdit() {
    if (!tenant) return;
    const res = await editCarpenterDialog(tenant);
    if (!res) return;
    if (res === "deleted") toast("Carpenter deleted");
    else toast("Saved " + res.name);
    await go(res);
  }

  if (!loaded) return <div className="sectitle">Rent <small>— loading…</small></div>;
  if (!tenant) {
    return (
      <div className="empty">
        <div className="empty-title">{cloakMoney ? "Hidden" : "Tenant not found"}</div>
        <button className="btn sm" style={{ marginTop: 12 }} onClick={() => router.push("/rent")}>
          ← Back to rent
        </button>
      </div>
    );
  }

  return (
    <div>
      <button className="btn sm" style={{ marginBottom: 14 }} onClick={() => router.push("/rent")}>
        ← Rent
      </button>
      <RentSection
        tenant={tenant}
        quotes={quotes}
        expenses={expenses}
        directory={directory}
        enteredBy={user?.id || "unknown"}
        onDone={load}
        onEdit={() => void onEdit()}
        onPull={() => void onPull()}
        onMerge={() => void onMerge()}
      />
    </div>
  );
}

function RentSection({
  tenant,
  quotes,
  expenses,
  directory,
  enteredBy,
  onDone,
  onEdit,
  onPull,
  onMerge,
}: {
  tenant: Carpenter;
  quotes: Doc[];
  expenses: Expense[];
  directory: Carpenter[];
  enteredBy: string;
  onDone: () => void;
  onEdit: () => void;
  onPull: () => void;
  onMerge: () => void;
}) {
  const router = useRouter();
  const due = placeRentDue(tenant, expenses);
  const today = todayStr();
  const yearNow = yearFromDmy(today);
  const monthNow = Math.max(1, Math.min(12, +(today.split("-")[1] || 0)));
  const [year, setYear] = useState(yearNow);
  const ticked = yearMonthsCharged(tenant, expenses, year);
  const pending = pendingForTenant(tenant, quotes, expenses);
  const pendingSum = r2(pending.reduce((s, p) => s + p.pending, 0));
  const stmt = placeRentStatement(tenant, expenses);
  const history = [...stmt].reverse();
  const monthly = r2(+(tenant.monthlyRent || 0) || 0);
  const opening = rentOpeningOf(tenant, expenses);
  const dups = findDuplicateCarpenters(tenant, directory);

  const [recvAmt, setRecvAmt] = useState("");
  const [payKind, setPayKind] = useState<"part" | "full">("part");
  const [recvHow, setRecvHow] = useState("cash");
  const [recvAccount, setRecvAccount] = useState("");
  const [monthAmt, setMonthAmt] = useState("");
  const [openAmt, setOpenAmt] = useState("");
  const [quoteId, setQuoteId] = useState("");
  const [against, setAgainst] = useState("");
  const [cash, setCash] = useState("");
  const [setoffMonth, setSetoffMonth] = useState("");
  const [upiAccts, setUpiAccts] = useState<string[]>([]);

  useEffect(() => {
    upiAccounts().then(setUpiAccts);
  }, []);

  useEffect(() => {
    setMonthAmt(monthly ? String(monthly) : "");
    setOpenAmt(opening ? String(opening) : "0");
    setRecvAmt("");
    setPayKind("part");
    setRecvHow("cash");
    setRecvAccount("");
    const first = pending[0];
    setQuoteId(first?.d.id || "");
    const against0 = first ? r2(Math.min(first.pending, due)) : 0;
    setAgainst(against0 ? String(against0) : "0");
    setCash("0");
    setSetoffMonth("");
    // Fill figures from this person. Do not reset while they type a payment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.id, monthly, opening]);

  const picked = pending.find((p) => p.d.id === quoteId) || pending[0];
  const pay = r2(+recvAmt || 0);
  const stillDue = r2(Math.max(0, due - pay));
  const towards = r2(+against || 0);
  const afterComm = r2(Math.max(0, due - towards));

  function setPayFull() {
    setPayKind("full");
    setRecvAmt(due > 0.5 ? String(due) : "");
  }

  function setPayPart() {
    setPayKind("part");
    if (r2(+recvAmt || 0) >= due - 0.05) setRecvAmt("");
  }

  function setPayAmount(n: number) {
    const a = r2(Math.max(0, n));
    setPayKind(due > 0.5 && a >= due - 0.05 ? "full" : "part");
    setRecvAmt(a ? String(a) : "");
  }

  async function openMonth(month1: number) {
    const dmy = monthFirstDay(year, month1);
    const name = MONTH_NAMES[month1 - 1] + " " + year;
    const status = monthRentStatus(tenant, expenses, dmy);
    if (status === "paid") return toast(name + " rent is paid");
    const row = chargeOfMonth(tenant, expenses, dmy);
    const usual = r2(+monthAmt || monthly || 0);
    const remain = row ? monthRemain(tenant, expenses, dmy) : usual;
    if (!row && usual <= 0.5) return toast("Type the usual monthly ₹ first");
    const howOpts = [
      { value: "cash", label: "Cash taken" },
      ...(pending.length ? [{ value: "commission", label: "Commission into rent" }] : []),
      ...(!row ? [{ value: "due", label: "They owe this month (no money yet)" }] : []),
    ];
    const fields: DialogField[] = [
      { name: "how", label: "How", type: "select", value: "cash", options: howOpts },
      { name: "amount", label: "Amount ₹ — full or part", type: "number", inputMode: "decimal", value: remain ? String(remain) : "" },
    ];
    if (pending.length > 1) {
      fields.push({
        name: "quote",
        label: "Quotation",
        type: "select",
        value: picked?.d.id || pending[0].d.id,
        options: pending.map((p) => ({
          value: p.d.id,
          label: "#" + (p.d.displayNumber || p.d.number) + " · ₹" + inr(p.pending),
        })),
      });
    }
    fields.push({
      name: "pay",
      label: "Cash how",
      type: "select",
      value: "cash",
      options: [
        { value: "cash", label: "Cash (Daybook)" },
        { value: "owner", label: "Cash → Owner" },
      ],
    });
    const res = await formDialog({
      title: name,
      message: row
        ? "Month ₹" + inr(+row.amount || 0)
          + (status === "part" ? " · already in ₹" + inr(monthAlloc(tenant, expenses, dmy)) + " · left ₹" + inr(remain) : " · nothing in yet")
          + ". Accept cash or commission. Part is fine."
        : "Usual ₹" + inr(usual) + " goes on the due. Then this amount is cash or commission against " + name + ".",
      fields,
      submitLabel: "Accept",
      deleteLabel: row && status === "due" ? "Remove tick" : undefined,
    });
    if (!res) return;
    if (res.__action === "delete") {
      if (!row) return;
      try {
        await unchargePlaceRent(row);
        bumpData();
        onDone();
        toast("Removed " + name);
      } catch (err) {
        toast(err instanceof Error ? err.message : "Could not remove");
      }
      return;
    }
    const how = res.how || "cash";
    try {
      let charged = row;
      if (!charged) {
        charged = await chargePlaceRent(tenant, usual, enteredBy, dmy);
      }
      if (how === "due") {
        bumpData();
        onDone();
        toast(name + " on the due · ₹" + inr(usual));
        return;
      }
      const live = await allExpenses();
      const left = monthRemain(tenant, live, dmy);
      const pay = r2(Math.min(+res.amount || 0, left));
      if (pay <= 0.5) {
        if (!row && charged) {
          bumpData();
          onDone();
          toast(name + " on the due · ₹" + inr(usual));
          return;
        }
        return toast("Enter an amount");
      }
      if (how === "commission") {
        const q = pending.find((p) => p.d.id === (res.quote || picked?.d.id)) || pending[0];
        if (!q) {
          if (!row) await unchargePlaceRent(charged);
          return toast("No pending commission");
        }
        await applyAgainstRent({
          tenant,
          quote: q.d,
          against: Math.min(pay, q.pending),
          cash: 0,
          enteredBy,
          expenses: live,
          placeRentMonth: dmy,
        });
        bumpData();
        onDone();
        toast("₹" + inr(Math.min(pay, q.pending)) + " commission → " + name);
        return;
      }
      await receivePlaceRent(tenant, pay, enteredBy, "cash", "", res.pay === "owner", "", undefined, dmy);
      bumpData();
      onDone();
      toast("₹" + inr(pay) + " cash → " + name);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save");
    }
  }

  async function doReceived() {
    const amt = r2(+recvAmt || 0);
    if (amt > due + 0.05) return toast("They only owe ₹" + inr(due));
    const mode = recvHow === "upi" ? "upi" : "cash";
    try {
      await receivePlaceRent(tenant, amt, enteredBy, mode, recvAccount, recvHow === "owner");
      bumpData();
      onDone();
      setRecvAmt("");
      setPayKind("part");
      toast("₹" + inr(amt) + " received · Receipts & Daybook");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not record");
    }
  }

  async function doMonthly() {
    await setMonthlyRent(tenant, +monthAmt || 0);
    bumpData();
    onDone();
    toast("Monthly rent saved");
  }

  async function doOpening() {
    try {
      await setRentOpening(tenant, +openAmt || 0, enteredBy);
      bumpData();
      onDone();
      toast("Old balance saved ₹" + inr(+openAmt || 0));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save old balance");
    }
  }

  async function doConvert() {
    if (!picked) return toast("No quotation with pending commission");
    try {
      await applyAgainstRent({
        tenant,
        quote: picked.d,
        against: +against || 0,
        cash: +cash || 0,
        enteredBy,
        expenses,
        placeRentMonth: setoffMonth || undefined,
      });
      bumpData();
      onDone();
      toast("Commission put towards rent");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not apply");
    }
  }

  function onQuoteChange(qid: string) {
    setQuoteId(qid);
    const row = pending.find((p) => p.d.id === qid);
    if (!row) return;
    const against0 = r2(Math.min(row.pending, due));
    setAgainst(against0 ? String(against0) : "0");
    setCash("0");
  }

  return (
    <section className="rent-section" aria-label={tenant.name + " place rent"}>
      <div className="pc-head">
        <span className="rent-sec-name">{tenant.name}</span>
        <span className="rent-sec-tools">
          <button type="button" className="rent-ico" onClick={onEdit}>
            Edit
          </button>
          <button type="button" className="rent-ico" onClick={onPull}>
            Pull
          </button>
          {dups.length > 0 && (
            <button type="button" className="rent-ico merge" onClick={onMerge} title="Same name and number — merge">
              <span className="rent-merge-ico" aria-hidden />
              Merge
            </button>
          )}
        </span>
      </div>

      <div className="rent-body">
        <div className="rent-who">
          <span className="ph">{tenant.phone || "—"}</span>
          {tenant.phone ? (
            <span className="rent-who-acts">
              <button type="button" className="btn call sm" onClick={() => dialPhone(tenant.phone)}>
                Call
              </button>
              <button
                type="button"
                className="btn wa sm"
                onClick={() => window.open(waLink(tenant.phone, "Hello " + tenant.name), "_blank")}
              >
                WhatsApp
              </button>
            </span>
          ) : null}
        </div>

        <div className="rent-due">
          <div className="rent-due-k">They owe</div>
          <div className={"rent-due-v" + (due > 0.5 ? " due" : "")}>{due > 0.5 ? "₹ " + inr(due) : "Settled"}</div>
          <div className="rent-due-s">
            {ticked} of 12 months in {year}
            {monthly > 0 ? " · usual ₹" + inr(monthly) : ""}
            {pendingSum > 0.5 ? " · we still owe them ₹" + inr(pendingSum) + " commission" : ""}
          </div>
        </div>

        <div className="rent-year">
          <div className="rent-year-bar">
            <div className="rent-year-top">
              <button type="button" className="btn sm" onClick={() => setYear((y) => y - 1)} aria-label="Previous year">
                ‹
              </button>
              <b>{year}</b>
              <button type="button" className="btn sm" onClick={() => setYear((y) => y + 1)} aria-label="Next year">
                ›
              </button>
              {year !== yearNow && (
                <button type="button" className="btn sm" onClick={() => setYear(yearNow)}>
                  Now
                </button>
              )}
            </div>
            <div className="rent-year-amt">
              <label className="modal-field">
                <span>Usual ₹</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={monthAmt}
                  onChange={(e) => setMonthAmt(e.target.value)}
                  placeholder="tick amount"
                />
              </label>
              <button className="btn sm" type="button" onClick={() => void doMonthly()}>
                Save
              </button>
            </div>
          </div>
          <div className="rent-mos" role="list">
            {MONTH_NAMES.map((name, i) => {
              const month1 = i + 1;
              const dmy = monthFirstDay(year, month1);
              const row = chargeOfMonth(tenant, expenses, dmy);
              const st = monthRentStatus(tenant, expenses, dmy);
              const on = st !== "empty";
              const now = year === yearNow && month1 === monthNow;
              const mark = st === "paid" ? "Paid" : st === "part" ? "Part" : st === "due" ? "✓" : "";
              return (
                <button
                  key={name}
                  type="button"
                  role="listitem"
                  className={"rent-mo" + (on ? " on" : "") + (st === "paid" ? " paid" : "") + (now ? " now" : "")}
                  aria-pressed={on}
                  aria-label={name + (st === "paid" ? " rent paid" : st === "part" ? " part paid" : on ? " due" : " empty")}
                  title={row ? "₹" + inr(+row.amount || 0) : undefined}
                  onClick={() => void openMonth(month1)}
                >
                  <span className="rent-mo-name">{name}</span>
                  <span className={"rent-mo-tick" + (on ? " on" : "") + (st === "paid" ? " paid" : "")} aria-hidden>
                    {mark}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className={"rent-act" + (due > 0.5 ? "" : " dim")}>
          <div className="rent-act-h">
            <span className="rent-act-n">1</span>
            <div>
              <b>They paid rent</b>
              <p>
                {due > 0.5
                  ? "Full or part. Type what they handed over, like ₹5,000 of ₹" + inr(due) + "."
                  : "Nothing due right now."}
              </p>
            </div>
          </div>
          {due > 0.5 && (
            <>
              <div className="rent-chips" role="group" aria-label="Full or part">
                <button type="button" className={"rent-chip" + (payKind === "full" ? " on" : "")} onClick={setPayFull}>
                  Full ₹{inr(due)}
                </button>
                <button type="button" className={"rent-chip" + (payKind === "part" ? " on" : "")} onClick={setPayPart}>
                  Part
                </button>
                {monthly > 0.5 && monthly < due - 0.5 && (
                  <button type="button" className="rent-chip" onClick={() => setPayAmount(monthly)}>
                    One month ₹{inr(monthly)}
                  </button>
                )}
              </div>
              <label className="modal-field">
                <span>{payKind === "full" ? "Amount (full)" : "They paid ₹"}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={recvAmt}
                  onChange={(e) => {
                    setPayKind("part");
                    setRecvAmt(e.target.value);
                  }}
                  placeholder={payKind === "part" ? "e.g. 5000" : undefined}
                />
              </label>
              <p className="rent-of">
                {pay > 0.5
                  ? "₹" + inr(pay) + " of ₹" + inr(due) + (stillDue > 0.5 ? " · ₹" + inr(stillDue) + " still due" : " · settled")
                  : "They owe ₹" + inr(due)}
              </p>
              <label className="modal-field">
                <span>How</span>
                <select className="paysel" value={recvHow} onChange={(e) => setRecvHow(e.target.value)}>
                  <option value="cash">Cash (Daybook)</option>
                  <option value="upi">UPI</option>
                  <option value="owner">Cash → Owner</option>
                </select>
              </label>
              {recvHow === "upi" && (
                <label className="modal-field">
                  <span>UPI account</span>
                  {upiAccts.length ? (
                    <select className="paysel" value={recvAccount} onChange={(e) => setRecvAccount(e.target.value)}>
                      <option value="">Choose…</option>
                      {upiAccts.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input value={recvAccount} onChange={(e) => setRecvAccount(e.target.value)} placeholder="GPay / PhonePe…" />
                  )}
                </label>
              )}
              <div className="rowbtns">
                <button className="btn primary" type="button" onClick={() => void doReceived()}>
                  Record payment
                </button>
              </div>
            </>
          )}
        </div>

        <div className={"rent-act" + (pending.length ? "" : " dim")}>
          <div className="rent-act-h">
            <span className="rent-act-n">2</span>
            <div>
              <b>Commission towards rent</b>
              <p>
                {pending.length
                  ? "We owe them commission. Put it on this rent instead of paying cash."
                  : "No pending commission on a quotation right now."}
              </p>
            </div>
          </div>
          {pending.length > 0 && picked && (
            <>
              {pending.length === 1 ? (
                <button
                  type="button"
                  className="rent-qrow"
                  onClick={() => router.push("/editor/" + picked.d.id)}
                >
                  <span>
                    #{picked.d.displayNumber || picked.d.number}
                    <small>
                      {(picked.d.commLock?.party || picked.d.customerName || "—") +
                        " · pending ₹" +
                        inr(picked.pending)}
                    </small>
                  </span>
                  <span className="rent-qgo">Open</span>
                </button>
              ) : (
                <label className="modal-field">
                  <span>Quotation</span>
                  <select className="paysel" value={picked.d.id} onChange={(e) => onQuoteChange(e.target.value)}>
                    {pending.map((p) => (
                      <option key={p.d.id} value={p.d.id}>
                        #{p.d.displayNumber || p.d.number} · pending ₹{inr(p.pending)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {unpaidChargedMonths(tenant, expenses).length > 0 && (
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
                  <input
                    type="number"
                    inputMode="decimal"
                    value={against}
                    onChange={(e) => setAgainst(e.target.value)}
                  />
                </label>
                <label className="modal-field">
                  <span>Cash to them ₹</span>
                  <input type="number" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} />
                </label>
              </div>
              <p className="rent-of">
                Pending ₹{inr(picked.pending)}. Rent due ₹{inr(due)}.
                {towards > 0.5 ? " After this they owe ₹" + inr(afterComm) + "." : ""}
              </p>
              <div className="rowbtns">
                <button className="btn primary" type="button" onClick={() => void doConvert()}>
                  Put towards rent
                </button>
              </div>
            </>
          )}
        </div>

        <details className="sqltoggle rent-hist">
          <summary>Old balance</summary>
          <div className="rent-form" style={{ marginTop: 10 }}>
            <label className="modal-field">
              <span>Old balance ₹</span>
              <input
                type="number"
                inputMode="decimal"
                value={openAmt}
                onChange={(e) => setOpenAmt(e.target.value)}
                placeholder="what they already owe"
              />
            </label>
            <p className="note" style={{ margin: "8px 0 0" }}>
              Replaces the figure. It does not add on top.
            </p>
            <div className="rowbtns">
              <button className="btn sm" type="button" onClick={() => void doOpening()}>
                Save old balance
              </button>
            </div>
          </div>
        </details>

        <details className="sqltoggle rent-hist" open>
          <summary>History</summary>
          <HistList
            items={history}
            empty="Commission towards rent, cash they paid, and monthly charges show here."
            resetKey={tenant.id + "-all-" + history.length}
            onQuote={(qid) => router.push("/editor/" + qid)}
          />
        </details>
      </div>
    </section>
  );
}
