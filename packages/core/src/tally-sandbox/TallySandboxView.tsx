"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import "./tally-sandbox.css";
import {
  addVoucher as postVoucher,
  deleteLedger as dropLedger,
  saveLedger,
} from "@/lib/ledger";
import { allRec, bootData, isBooted } from "@/lib/data";
import type { Ledger, LedgerGroup, Voucher } from "@/lib/types";
import { useApp } from "@/store/useApp";
import {
  GROUPS,
  VCH_TYPES,
  balanceSheet,
  dayBook,
  fmtDate,
  fromCloudBooks,
  inr,
  ledgerBalance,
  profitAndLoss,
  statement,
  trialBalance,
  voucherTotals,
  weekday,
  type TGroup,
  type TLeg,
  type TState,
  type TVch,
} from "./tally-sandbox";

type Screen = "gateway" | "ledger" | "voucher" | "daybook" | "trial" | "pnl" | "bs" | "statement";

const MENU: { id: Screen; key: string; label: string; section: string }[] = [
  { id: "ledger", key: "A", label: "Create Ledger", section: "Masters" },
  { id: "voucher", key: "V", label: "Accounting Vouchers", section: "Transactions" },
  { id: "daybook", key: "D", label: "Day Book", section: "Display" },
  { id: "trial", key: "T", label: "Trial Balance", section: "Display" },
  { id: "pnl", key: "P", label: "Profit & Loss A/c", section: "Display" },
  { id: "bs", key: "B", label: "Balance Sheet", section: "Display" },
];

const FKEY_VCH: { f: string; type: TVch }[] = [
  { f: "F4", type: "Contra" },
  { f: "F5", type: "Payment" },
  { f: "F6", type: "Receipt" },
  { f: "F7", type: "Journal" },
  { f: "F8", type: "Sales" },
  { f: "F9", type: "Purchase" },
];

function emptyLegs(): TLeg[] {
  return [
    { ledgerId: "", dr: 0, cr: 0 },
    { ledgerId: "", dr: 0, cr: 0 },
    { ledgerId: "", dr: 0, cr: 0 },
  ];
}

function money(n: number) {
  return n ? inr(n) : "";
}

function toLedgerGroup(g: TGroup): LedgerGroup {
  if (g === "Cash-in-Hand") return "Cash-in-hand";
  if (g === "Stock-in-Hand") return "Current Assets";
  if (g === "Direct Incomes") return "Indirect Incomes";
  return g as LedgerGroup;
}

function isoToApp(iso: string) {
  const [y, m, d] = (iso || "").split("-");
  if (!y || !m || !d) return iso;
  return `${d}-${m}-${y.slice(2)}`;
}

const EMPTY: TState = {
  company: "Abuzar Industries",
  fyFrom: "2026-04-01",
  fyTo: "2027-03-31",
  date: "2026-09-05",
  ledgers: [],
  vouchers: [],
  nextId: 1,
  nextNo: { Receipt: 1, Payment: 1, Sales: 1, Purchase: 1, Journal: 1, Contra: 1 },
};

export default function TallySandboxView() {
  const [state, setState] = useState<TState>(EMPTY);
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<Screen>("gateway");
  const [pick, setPick] = useState(0);
  const [status, setStatus] = useState("");
  const [bad, setBad] = useState(false);
  const [stmtId, setStmtId] = useState("");

  const [lName, setLName] = useState("");
  const [lGroup, setLGroup] = useState<TGroup>("Sundry Debtors");
  const [lOpen, setLOpen] = useState("");
  const [lSide, setLSide] = useState<"dr" | "cr">("dr");

  const [vType, setVType] = useState<TVch>("Receipt");
  const [vDate, setVDate] = useState(EMPTY.date);
  const [vNarr, setVNarr] = useState("");
  const [vLegs, setVLegs] = useState<TLeg[]>(emptyLegs);
  const { ready: appReady, user, dataVersion } = useApp();

  const reload = useCallback(async () => {
    if (user && !isBooted()) await bootData().catch(() => {});
    const [ledgers, vouchers] = await Promise.all([
      allRec<Ledger>("ledgers"),
      allRec<Voucher>("vouchers"),
    ]);
    const s = fromCloudBooks(ledgers, vouchers);
    setState(s);
    return s;
  }, [user]);

  useEffect(() => {
    if (!appReady) return;
    let gone = false;
    (async () => {
      try {
        const s = await reload();
        if (gone) return;
        setVDate(s.date);
      } finally {
        if (!gone) setReady(true);
      }
    })();
    return () => { gone = true; };
  }, [appReady, user, dataVersion, reload]);

  const go = useCallback((next: Screen, type?: TVch) => {
    setStatus("");
    setBad(false);
    if (type) {
      setVType(type);
      setVLegs(emptyLegs());
      setVNarr("");
    }
    setScreen(next);
  }, []);

  const openStmt = useCallback((id: string) => {
    setStmtId(id);
    setScreen("statement");
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const typing = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
      if (e.key === "Escape") {
        e.preventDefault();
        go(screen === "statement" ? "trial" : "gateway");
        return;
      }
      if (e.key === "F2") {
        e.preventDefault();
        const el = document.getElementById("tally-sb-date") as HTMLInputElement | null;
        el?.showPicker?.();
        el?.focus();
        return;
      }
      const f = FKEY_VCH.find((x) => x.f === e.key);
      if (f) {
        e.preventDefault();
        go("voucher", f.type);
        return;
      }
      if (typing) return;
      if (screen === "gateway") {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setPick((i) => (i + 1) % MENU.length);
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setPick((i) => (i - 1 + MENU.length) % MENU.length);
        }
        if (e.key === "Enter") {
          e.preventDefault();
          go(MENU[pick].id);
        }
        const hit = MENU.find((m) => m.key === e.key.toUpperCase());
        if (hit) {
          e.preventDefault();
          go(hit.id);
        }
      }
      if (screen === "voucher" && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        document.getElementById("tally-sb-accept")?.click();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, pick, screen]);

  const tb = useMemo(() => trialBalance(state), [state]);
  const pnl = useMemo(() => profitAndLoss(state), [state]);
  const bs = useMemo(() => balanceSheet(state), [state]);
  const book = useMemo(() => dayBook(state), [state]);
  const stmt = stmtId ? statement(state, stmtId) : null;
  const vt = voucherTotals(vLegs);
  const ledgers = useMemo(
    () => [...state.ledgers].sort((a, b) => a.name.localeCompare(b.name)),
    [state.ledgers],
  );

  function flash(msg: string, isBad = false) {
    setStatus(msg);
    setBad(isBad);
  }

  async function onCreateLedger() {
    if (!lName.trim()) return flash("Ledger name is empty", true);
    const opening = (Number(lOpen) || 0) * (lSide === "cr" ? -1 : 1);
    try {
      await saveLedger({ name: lName, group: toLedgerGroup(lGroup), opening });
      await reload();
      setLName("");
      setLOpen("");
      flash(`Ledger created: ${lName.trim()}`);
    } catch (e) {
      flash(e instanceof Error ? e.message : "Could not save ledger", true);
    }
  }

  async function onAcceptVoucher() {
    const legs = vLegs.filter((l) => l.ledgerId && (l.dr || l.cr));
    if (legs.length < 2) return flash("Need at least two ledger lines", true);
    const tot = voucherTotals(legs);
    if (tot.dr !== tot.cr) {
      return flash(`Out of balance by ${inr(Math.abs(tot.dr - tot.cr))} ${tot.dr > tot.cr ? "Dr" : "Cr"}`, true);
    }
    try {
      const v = await postVoucher({
        type: vType,
        date: isoToApp(vDate),
        narration: vNarr,
        legs,
        enteredBy: user?.name || "owner",
      });
      await reload();
      setVLegs(emptyLegs());
      setVNarr("");
      flash(`Accepted ${v.type} No. ${v.no}`);
    } catch (e) {
      flash(e instanceof Error ? e.message : "Could not save voucher", true);
    }
  }

  function setLeg(i: number, patch: Partial<TLeg>) {
    setVLegs((rows) => {
      const next = rows.map((r, j) => (j === i ? { ...r, ...patch } : r));
      const last = next[next.length - 1];
      if (last.ledgerId || last.dr || last.cr) next.push({ ledgerId: "", dr: 0, cr: 0 });
      return next;
    });
  }

  async function onReset() {
    await reload();
    go("gateway");
    flash("Books reloaded");
  }

  function onDate(iso: string) {
    setVDate(iso);
    setState((s) => ({ ...s, date: iso }));
  }

  return (
    <div className="tally-sb">
      <div className="tally-sb-top">
        <span>Gateway of Tally</span>
        <small>{state.company}</small>
      </div>

      <div className="tally-sb-body">
        <div className="tally-sb-main">
          {!ready ? (
            <div className="tally-sb-menu"><h2>Loading…</h2></div>
          ) : screen === "gateway" ? (
            <>
              <div className="tally-sb-menu" role="menu">
                <h2>Gateway of Tally</h2>
                {MENU.map((m, i) => (
                  <div key={m.id}>
                    {(i === 0 || MENU[i - 1].section !== m.section) && (
                      <div className="tally-sb-sec">{m.section}</div>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      className={"tally-sb-item" + (pick === i ? " is-on" : "")}
                      onMouseEnter={() => setPick(i)}
                      onClick={() => go(m.id)}
                    >
                      <kbd>{m.key}</kbd>
                      {m.label}
                    </button>
                  </div>
                ))}
              </div>
              <div className="tally-sb-note">
                Official books on Safa. New ledgers and vouchers save to the cloud.
                <ul>
                  <li>Here: ledgers, 6 voucher types, Day Book, TB, P&amp;L, Balance Sheet</li>
                  <li>Not here: bill-wise, GST returns, inventory, payroll, Tally XML</li>
                </ul>
              </div>
            </>
          ) : (
            <div className="tally-sb-work">
              {screen === "ledger" && (
                <>
                  <h2>Ledger creation</h2>
                  <div className="tally-sb-work-in">
                    <div className="tally-sb-form">
                      <label>Name
                        <input value={lName} onChange={(e) => setLName(e.target.value)} autoFocus />
                      </label>
                      <label>Under group
                        <select value={lGroup} onChange={(e) => setLGroup(e.target.value as TGroup)}>
                          {GROUPS.map((g) => <option key={g.name} value={g.name}>{g.name}</option>)}
                        </select>
                      </label>
                      <label>Opening
                        <input value={lOpen} onChange={(e) => setLOpen(e.target.value)} inputMode="decimal" />
                      </label>
                      <label>Dr / Cr
                        <select value={lSide} onChange={(e) => setLSide(e.target.value as "dr" | "cr")}>
                          <option value="dr">Dr</option>
                          <option value="cr">Cr</option>
                        </select>
                      </label>
                    </div>
                    <div className="tally-sb-actions">
                      <button type="button" onClick={onCreateLedger}>Accept</button>
                      <button type="button" className="ghost" onClick={() => go("gateway")}>Esc · Gateway</button>
                    </div>
                    <table className="tally-sb-table">
                      <thead>
                        <tr><th>Ledger</th><th>Group</th><th className="num">Closing</th><th /></tr>
                      </thead>
                      <tbody>
                        {ledgers.map((l) => {
                          const bal = ledgerBalance(state, l.id);
                          return (
                            <tr key={l.id}>
                              <td><button type="button" className="link" onClick={() => openStmt(l.id)}>{l.name}</button></td>
                              <td>{l.group}</td>
                              <td className="num">{bal ? `${inr(Math.abs(bal))} ${bal > 0 ? "Dr" : "Cr"}` : ""}</td>
                              <td>
                                <button
                                  type="button"
                                  className="ghost"
                                  onClick={async () => {
                                    const r = await dropLedger(l.id);
                                    if (!r.ok) return flash(`In use by ${r.count} voucher(s)`, true);
                                    await reload();
                                    flash("Ledger deleted");
                                  }}
                                >Del</button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {screen === "voucher" && (
                <>
                  <h2>Accounting voucher</h2>
                  <div className="tally-sb-work-in tally-sb-vch">
                    <div className="tally-sb-vch-head">
                      <label className="tally-sb-field">Date
                        <input type="date" value={vDate} onChange={(e) => setVDate(e.target.value)} />
                      </label>
                      <div className="tally-sb-vch-type">{vType} &nbsp;No. {state.nextNo[vType]}</div>
                      <label className="tally-sb-field">Type
                        <select value={vType} onChange={(e) => setVType(e.target.value as TVch)}>
                          {VCH_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </label>
                    </div>
                    <table className="tally-sb-table">
                      <thead>
                        <tr><th>Particulars</th><th className="num">Debit</th><th className="num">Credit</th></tr>
                      </thead>
                      <tbody>
                        {vLegs.map((leg, i) => (
                          <tr key={i}>
                            <td>
                              <select value={leg.ledgerId} onChange={(e) => setLeg(i, { ledgerId: e.target.value })}>
                                <option value=""> </option>
                                {ledgers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                              </select>
                            </td>
                            <td>
                              <input
                                inputMode="decimal"
                                value={leg.dr || ""}
                                onChange={(e) => setLeg(i, { dr: Number(e.target.value) || 0, cr: 0 })}
                              />
                            </td>
                            <td>
                              <input
                                inputMode="decimal"
                                value={leg.cr || ""}
                                onChange={(e) => setLeg(i, { cr: Number(e.target.value) || 0, dr: 0 })}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td>{vt.diff ? `Difference ${inr(Math.abs(vt.diff))} ${vt.diff > 0 ? "Dr" : "Cr"}` : "Balanced"}</td>
                          <td className="num">{money(vt.dr)}</td>
                          <td className="num">{money(vt.cr)}</td>
                        </tr>
                      </tfoot>
                    </table>
                    <label className="tally-sb-field" style={{ marginTop: 10 }}>
                      Narration
                      <textarea value={vNarr} onChange={(e) => setVNarr(e.target.value)} />
                    </label>
                    <div className="tally-sb-actions">
                      <button type="button" id="tally-sb-accept" onClick={onAcceptVoucher}>Accept (Ctrl+A)</button>
                      <button type="button" className="ghost" onClick={() => go("gateway")}>Esc · Gateway</button>
                    </div>
                  </div>
                </>
              )}

              {screen === "daybook" && (
                <>
                  <h2>Day Book</h2>
                  <div className="tally-sb-work-in">
                    <ReportHead state={state} title="Day Book" />
                    <table className="tally-sb-table">
                      <thead>
                        <tr><th>Date</th><th>Type</th><th>No</th><th>Particulars</th><th className="num">Debit</th><th className="num">Credit</th></tr>
                      </thead>
                      <tbody>
                        {book.map((v) => {
                          const t = voucherTotals(v.legs);
                          return (
                            <tr key={v.id}>
                              <td>{fmtDate(v.date)}</td>
                              <td>{v.type}</td>
                              <td>{v.no}</td>
                              <td>{v.narration || v.legs.map((leg) => state.ledgers.find((l) => l.id === leg.ledgerId)?.name).filter(Boolean).join(", ")}</td>
                              <td className="num">{inr(t.dr)}</td>
                              <td className="num">{inr(t.cr)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {screen === "trial" && (
                <>
                  <h2>Trial Balance</h2>
                  <div className="tally-sb-work-in">
                    <ReportHead state={state} title="Trial Balance" />
                    <MoneyRows rows={tb.rows} onOpen={openStmt} totalDr={tb.totalDr} totalCr={tb.totalCr} />
                  </div>
                </>
              )}

              {screen === "pnl" && (
                <>
                  <h2>Profit &amp; Loss A/c</h2>
                  <div className="tally-sb-work-in">
                    <ReportHead state={state} title="Profit & Loss Account" />
                    <MoneyRows rows={pnl.expense} onOpen={openStmt} empty="No expenses" />
                    <MoneyRows rows={pnl.income} onOpen={openStmt} empty="No income" />
                    <p className="tally-sb-status is-ok">
                      {pnl.profit >= 0 ? "Net profit" : "Net loss"} {inr(Math.abs(pnl.profit))}
                    </p>
                  </div>
                </>
              )}

              {screen === "bs" && (
                <>
                  <h2>Balance Sheet</h2>
                  <div className="tally-sb-work-in">
                    <ReportHead state={state} title="Balance Sheet" />
                    <p className="tally-sb-sec" style={{ paddingLeft: 0 }}>Liabilities</p>
                    <MoneyRows rows={bs.liabilities} onOpen={(id) => { if (id !== "_pnl") openStmt(id); }} />
                    <p className="tally-sb-sec" style={{ paddingLeft: 0 }}>Assets</p>
                    <MoneyRows rows={bs.assets} onOpen={(id) => { if (id !== "_pnl") openStmt(id); }} />
                    <p className={"tally-sb-status " + (bs.balanced ? "is-ok" : "is-bad")}>
                      Assets {inr(bs.totalAssets)} · Liabilities {inr(bs.totalLiab)}
                      {bs.balanced ? " · tallies" : " · out"}
                    </p>
                  </div>
                </>
              )}

              {screen === "statement" && stmt && (
                <>
                  <h2>Ledger · {stmt.ledger.name}</h2>
                  <div className="tally-sb-work-in">
                    <ReportHead state={state} title={stmt.ledger.name} />
                    <p>Opening {stmt.opening ? `${inr(Math.abs(stmt.opening))} ${stmt.opening > 0 ? "Dr" : "Cr"}` : "nil"} · Group {stmt.ledger.group}</p>
                    <table className="tally-sb-table">
                      <thead>
                        <tr><th>Date</th><th>Vch</th><th>Particulars</th><th className="num">Debit</th><th className="num">Credit</th></tr>
                      </thead>
                      <tbody>
                        {stmt.rows.map((r) => (
                          <tr key={r.id}>
                            <td>{fmtDate(r.date)}</td>
                            <td>{r.type} {r.no}</td>
                            <td>{r.particulars}</td>
                            <td className="num">{money(r.dr)}</td>
                            <td className="num">{money(r.cr)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={3}>Closing</td>
                          <td className="num">{stmt.closing > 0 ? inr(stmt.closing) : ""}</td>
                          <td className="num">{stmt.closing < 0 ? inr(-stmt.closing) : ""}</td>
                        </tr>
                      </tfoot>
                    </table>
                    <div className="tally-sb-actions" style={{ marginTop: 10 }}>
                      <button type="button" className="ghost" onClick={() => go("trial")}>Esc · Trial Balance</button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
          {status && <p className={"tally-sb-status " + (bad ? "is-bad" : "is-ok")}>{status}</p>}
        </div>

        <aside className="tally-sb-side">
          <dl className="tally-sb-stat">
            <dt>Current period</dt>
            <dd>{fmtDate(state.fyFrom)} to {fmtDate(state.fyTo)}</dd>
          </dl>
          <dl className="tally-sb-stat">
            <dt>Current date</dt>
            <dd>
              {weekday(state.date)}, {fmtDate(state.date)}
              <label className="tally-sb-field" style={{ marginTop: 8, color: "inherit" }}>
                F2 Date
                <input id="tally-sb-date" type="date" value={state.date} onChange={(e) => onDate(e.target.value)} />
              </label>
            </dd>
          </dl>
          <dl className="tally-sb-stat">
            <dt>Current company</dt>
            <dd>{state.company}</dd>
          </dl>
          <dl className="tally-sb-stat">
            <dt>Books</dt>
            <dd>{state.ledgers.length} ledgers · {state.vouchers.length} vouchers</dd>
          </dl>
          <button type="button" className="tally-sb-btn ghost" onClick={() => void onReset()}>Reload books</button>
        </aside>
      </div>

      <div className="tally-sb-fkeys">
        <button type="button" onClick={() => document.getElementById("tally-sb-date")?.focus()}>F2 Date</button>
        {FKEY_VCH.map((k) => (
          <button
            key={k.f}
            type="button"
            className={screen === "voucher" && vType === k.type ? "is-on" : ""}
            onClick={() => go("voucher", k.type)}
          >{k.f} {k.type}</button>
        ))}
        <button type="button" onClick={() => go("gateway")}>Esc Gateway</button>
      </div>
    </div>
  );
}

function ReportHead({ state, title }: { state: TState; title: string }) {
  return (
    <div className="tally-sb-report-head">
      <strong>{state.company}</strong>
      <span>{title}</span>
      <span>{fmtDate(state.fyFrom)} to {fmtDate(state.fyTo)}</span>
    </div>
  );
}

function MoneyRows({
  rows,
  onOpen,
  totalDr,
  totalCr,
  empty,
}: {
  rows: { id: string; name: string; dr: number; cr: number }[];
  onOpen: (id: string) => void;
  totalDr?: number;
  totalCr?: number;
  empty?: string;
}) {
  const dr = totalDr ?? rows.reduce((n, r) => n + r.dr, 0);
  const cr = totalCr ?? rows.reduce((n, r) => n + r.cr, 0);
  return (
    <table className="tally-sb-table">
      <thead>
        <tr><th>Particulars</th><th className="num">Debit</th><th className="num">Credit</th></tr>
      </thead>
      <tbody>
        {rows.length === 0 && empty && (
          <tr><td colSpan={3}>{empty}</td></tr>
        )}
        {rows.map((r) => (
          <tr key={r.id}>
            <td>
              {r.id.startsWith("_") ? r.name : (
                <button type="button" className="link" onClick={() => onOpen(r.id)}>{r.name}</button>
              )}
            </td>
            <td className="num">{money(r.dr)}</td>
            <td className="num">{money(r.cr)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td></td>
          <td className="num">{dr ? inr(dr) : ""}</td>
          <td className="num">{cr ? inr(cr) : ""}</td>
        </tr>
      </tfoot>
    </table>
  );
}
