"use client";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { inr } from "@/lib/calc";
import {
  allLedgers,
  allVouchers,
  dayBook,
  deleteVoucher,
  drCr,
  groupSummary,
  ledgerBalance,
  ledgerStatement,
  trialBalance,
  voucherTotal,
} from "@/lib/ledger";
import { editLedgerDialog } from "@/lib/ledger-form";
import { useApp } from "@/store/useApp";
import { bumpData } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import type { Ledger, Voucher, VoucherType } from "@/lib/types";
import VoucherEntry from "./VoucherEntry";

type View = "gateway" | "daybook" | "groups" | "trial" | "accounts" | "ledger" | "voucher";
const bal = (n: number) => {
  const { abs, side } = drCr(n);
  return "₹" + inr(abs) + " " + side;
};

const MENU: { key: string; label: string; view: View; note?: string }[] = [
  { key: "V", label: "Accounting Vouchers", view: "voucher", note: "F4–F9" },
  { key: "D", label: "Day Book", view: "daybook" },
  { key: "L", label: "Ledgers", view: "accounts" },
  { key: "G", label: "Group Summary", view: "groups" },
  { key: "T", label: "Trial Balance", view: "trial" },
];
const FKEYS: Record<string, VoucherType> = { F4: "Contra", F5: "Payment", F6: "Receipt", F7: "Journal", F8: "Sales", F9: "Purchase" };

export default function LedgerView({ initialLedgerId }: { initialLedgerId?: string }) {
  const { dataVersion, user } = useApp();
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [view, setView] = useState<View>(initialLedgerId ? "ledger" : "gateway");
  const [openId, setOpenId] = useState(initialLedgerId || "");
  const [vType, setVType] = useState<VoucherType>("Receipt");
  const [menuIdx, setMenuIdx] = useState(0);
  const [listIdx, setListIdx] = useState(0);
  const [q, setQ] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    Promise.all([allLedgers(), allVouchers()]).then(([l, v]) => {
      setLedgers(l);
      setVouchers(v);
    });
  }, []);
  useEffect(() => {
    load();
  }, [load, dataVersion]);

  const nameOf = useMemo(() => {
    const m = new Map(ledgers.map((l) => [l.id, l.name] as const));
    return (id: string) => m.get(id) || "—";
  }, [ledgers]);
  const groups = useMemo(() => groupSummary(ledgers, vouchers), [ledgers, vouchers]);
  const tb = useMemo(() => trialBalance(ledgers, vouchers), [ledgers, vouchers]);
  const book = useMemo(() => dayBook(vouchers), [vouchers]);
  const filtered = useMemo(
    () => ledgers.filter((l) => l.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name)),
    [ledgers, q],
  );
  const openLedger = ledgers.find((l) => l.id === openId);
  const statement = useMemo(
    () => (openLedger ? ledgerStatement(openLedger, vouchers, nameOf) : null),
    [openLedger, vouchers, nameOf],
  );

  const goBack = useCallback(() => {
    setView((v) => (v === "ledger" ? "accounts" : v === "gateway" ? "gateway" : "gateway"));
  }, []);
  const openMenu = useCallback((m: (typeof MENU)[number]) => {
    if (m.view === "voucher") setVType("Receipt");
    if (m.view === "accounts") setListIdx(0);
    setView(m.view);
  }, []);
  const openLedgerById = useCallback((id: string) => {
    setOpenId(id);
    setView("ledger");
  }, []);

  // focus search when entering the Ledgers list
  useEffect(() => {
    if (view === "accounts") setTimeout(() => searchRef.current?.focus(), 30);
  }, [view]);

  // keyboard: Tally-style navigation everywhere
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (FKEYS[e.key]) {
        e.preventDefault();
        setVType(FKEYS[e.key]);
        setView("voucher");
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        goBack();
        return;
      }
      if (view === "voucher") return; // the voucher screen owns its keys
      const typing = /INPUT|SELECT|TEXTAREA/.test((e.target as HTMLElement)?.tagName || "");
      if (view === "gateway") {
        if (e.key === "ArrowDown") { e.preventDefault(); setMenuIdx((i) => (i + 1) % MENU.length); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setMenuIdx((i) => (i - 1 + MENU.length) % MENU.length); }
        else if (e.key === "Enter") { e.preventDefault(); openMenu(MENU[menuIdx]); }
        else {
          const m = MENU.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
          if (m) { e.preventDefault(); openMenu(m); }
        }
      } else if (view === "accounts") {
        if (e.key === "ArrowDown") { e.preventDefault(); setListIdx((i) => Math.min(filtered.length - 1, i + 1)); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setListIdx((i) => Math.max(0, i - 1)); }
        else if (e.key === "Enter") { e.preventDefault(); const l = filtered[Math.min(listIdx, filtered.length - 1)]; if (l) openLedgerById(l.id); }
        else if (!typing && /^[a-zA-Z0-9]$/.test(e.key)) searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, menuIdx, listIdx, filtered, goBack, openMenu, openLedgerById]);

  async function newLedger() {
    if (await editLedgerDialog()) { load(); bumpData(); }
  }
  async function removeV(v: Voucher) {
    const ok = await confirmDialog({ title: "Delete voucher?", message: v.type + " No. " + v.no + " · ₹" + inr(voucherTotal(v)), confirmLabel: "Delete", danger: true });
    if (!ok) return;
    await deleteVoucher(v.id);
    load();
    bumpData();
  }

  const enteredBy = user?.id || "system";
  const listIdxC = Math.min(listIdx, Math.max(0, filtered.length - 1));

  const title =
    view === "gateway" ? "Gateway of Tally"
    : view === "daybook" ? "Day Book"
    : view === "groups" ? "Group Summary"
    : view === "trial" ? "Trial Balance"
    : view === "accounts" ? "List of Ledgers"
    : view === "ledger" ? "Ledger : " + (openLedger?.name || "")
    : vType + " Voucher";

  return (
    <div className="tally-app" tabIndex={-1}>
      <div className="tally-strip"><span>Abuzar Industries — Books of Accounts</span><span>Ctrl+M · Ledger</span></div>
      <div className="tally-title">
        <span className="tl-left">Gateway of Tally</span>
        <span className="tl-mid">Abuzar Industries</span>
        <span className="tl-right">1-Apr-26 to 30-Jun-26</span>
      </div>

      <div className="tally-work">
        <div className="tally-report">
          <div className="tr-head">
            <span>{title}</span>
            <small>{view === "gateway" ? "↑↓ + Enter · or press the red letter" : view === "accounts" ? "type to search · ↑↓ + Enter" : "Esc: back"}</small>
          </div>
          <div className="tr-body">
            {view === "gateway" && <Gateway idx={menuIdx} onPick={openMenu} onHover={setMenuIdx} tb={tb} />}

            {view === "voucher" && (
              <VoucherEntry
                ledgers={ledgers}
                enteredBy={enteredBy}
                initialType={vType}
                onDone={() => { load(); setView("daybook"); }}
                onCancel={() => setView("gateway")}
              />
            )}

            {view === "daybook" && <DayBook book={book} nameOf={nameOf} onOpen={openLedgerById} onDelete={removeV} />}
            {view === "groups" && <Groups groups={groups} tb={tb} />}
            {view === "trial" && <Trial groups={groups} tb={tb} onOpen={openLedgerById} />}
            {view === "accounts" && (
              <Accounts list={filtered} idx={listIdxC} q={q} setQ={(s) => { setQ(s); setListIdx(0); }} searchRef={searchRef} onOpen={openLedgerById} vouchers={vouchers} />
            )}
            {view === "ledger" && statement && openLedger && (
              <Statement ledger={openLedger} st={statement} onDelete={removeV} />
            )}
            {view === "ledger" && !statement && <div className="t-empty">Ledger not found.</div>}
          </div>
        </div>

        <div className="tally-btnbar">
          {view !== "gateway" && <button className="t-btn" onClick={() => setView("gateway")}><span className="k">Esc</span>Gateway</button>}
          <button className="t-btn" onClick={() => setView("daybook")}><span className="k">D</span>Day Book</button>
          <button className="t-btn" onClick={() => { setListIdx(0); setView("accounts"); }}><span className="k">L</span>Ledgers</button>
          <button className="t-btn" onClick={() => setView("groups")}><span className="k">G</span>Groups</button>
          <button className="t-btn" onClick={() => setView("trial")}><span className="k">T</span>Trial Bal</button>
          <button className="t-btn" onClick={newLedger}><span className="k">Alt+C</span>New Ledger</button>
          {Object.entries(FKEYS).map(([k, t]) => (
            <button key={k} className={"t-btn" + (k === "F4" ? " sp" : "")} onClick={() => { setVType(t); setView("voucher"); }}>
              <span className="k">{k}</span>{t}
            </button>
          ))}
        </div>
      </div>

      <div className="tally-foot">
        <span>{ledgers.length} ledgers · {vouchers.length} vouchers</span>
        <span>{tb.balanced ? "Trial Balance: Dr = Cr ✓" : "Difference in opening ₹" + inr(Math.abs(tb.diff))}</span>
      </div>
    </div>
  );
}

// ---------- Gateway of Tally ----------
function Gateway({ idx, onPick, onHover, tb }: { idx: number; onPick: (m: (typeof MENU)[number]) => void; onHover: (i: number) => void; tb: { totalDr: number } }) {
  return (
    <div className="t-gateway">
      <div className="t-gw-title">Gateway of Tally</div>
      <div className="t-gw-sec">Transactions</div>
      {MENU.slice(0, 2).map((m) => item(m))}
      <div className="t-gw-sec">Reports</div>
      {MENU.slice(2).map((m) => item(m))}
      <div style={{ padding: "10px 18px", color: "#6a5a22", fontSize: 12, borderTop: "1px solid #cbc196", marginTop: 6 }}>
        Total turnover posted: ₹{inr(tb.totalDr)}
      </div>
    </div>
  );
  function item(m: (typeof MENU)[number]) {
    const i = MENU.indexOf(m);
    return (
      <div
        key={m.key}
        className="t-menu-item"
        style={i === idx ? { background: "var(--t-sel)", color: "#fff" } : undefined}
        onMouseEnter={() => onHover(i)}
        onClick={() => onPick(m)}
      >
        <span><span className="k" style={i === idx ? { color: "#ffe08a" } : undefined}>{m.key}</span> &nbsp;{m.label}</span>
        {m.note && <small style={i === idx ? { color: "#ffe9c0" } : undefined}>{m.note}</small>}
      </div>
    );
  }
}

// ---------- Day Book ----------
function DayBook({ book, nameOf, onOpen, onDelete }: { book: Voucher[]; nameOf: (id: string) => string; onOpen: (id: string) => void; onDelete: (v: Voucher) => void }) {
  if (!book.length) return <div className="t-empty">No vouchers yet. Press F6 (Receipt), F8 (Sales) … to record one.</div>;
  return (
    <table className="t-table">
      <thead><tr><th>Date</th><th>Particulars</th><th>Vch Type</th><th>Vch No</th><th className="amt">Amount</th><th /></tr></thead>
      <tbody>
        {book.map((v) => {
          const dr = v.legs.find((l) => (+l.dr || 0) > 0);
          const cr = v.legs.find((l) => (+l.cr || 0) > 0);
          const openTarget = (dr || cr)?.ledgerId || "";
          return (
            <tr key={v.id} className="click" onClick={() => openTarget && onOpen(openTarget)}>
              <td>{v.date}</td>
              <td>{nameOf(dr?.ledgerId || "")}<br /><span style={{ color: "#8a7b45" }}>To {nameOf(cr?.ledgerId || "")}</span></td>
              <td className="vch">{v.type}</td>
              <td className="vch">{v.no}</td>
              <td className="amt">{inr(voucherTotal(v))}</td>
              <td className="amt"><button className="x-row" title="Delete" onClick={(e) => { e.stopPropagation(); onDelete(v); }}>×</button></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---------- Group Summary ----------
function Groups({ groups, tb }: { groups: ReturnType<typeof groupSummary>; tb: ReturnType<typeof trialBalance> }) {
  return (
    <table className="t-table">
      <thead><tr><th>Group</th><th className="amt">Debit</th><th className="amt">Credit</th></tr></thead>
      <tbody>
        {groups.map((g) => (
          <tr key={g.group}>
            <td>{g.group} <span style={{ color: "#8a7b45" }}>· {g.lines.length}</span></td>
            <td className="amt dr">{g.total >= 0 ? inr(g.total) : ""}</td>
            <td className="amt cr">{g.total < 0 ? inr(-g.total) : ""}</td>
          </tr>
        ))}
        <tr className="tot"><td>Grand Total</td><td className="amt">{inr(tb.totalDr)}</td><td className="amt">{inr(tb.totalCr)}</td></tr>
      </tbody>
    </table>
  );
}

// ---------- Trial Balance (grouped) ----------
function Trial({ groups, tb, onOpen }: { groups: ReturnType<typeof groupSummary>; tb: ReturnType<typeof trialBalance>; onOpen: (id: string) => void }) {
  return (
    <table className="t-table">
      <thead><tr><th>Particulars</th><th className="amt">Debit</th><th className="amt">Credit</th></tr></thead>
      <tbody>
        {groups.map((g) => (
          <Fragment key={g.group}>
            <tr className="grp"><td>{g.group}</td><td className="amt" /><td className="amt" /></tr>
            {g.lines.map(({ ledger, balance }) => (
              <tr key={ledger.id} className="click" onClick={() => onOpen(ledger.id)}>
                <td>&nbsp;&nbsp;{ledger.name}</td>
                <td className="amt dr">{balance >= 0 && balance !== 0 ? inr(balance) : ""}</td>
                <td className="amt cr">{balance < 0 ? inr(-balance) : ""}</td>
              </tr>
            ))}
          </Fragment>
        ))}
        <tr className="tot"><td>Grand Total</td><td className="amt">{inr(tb.totalDr)}</td><td className="amt">{inr(tb.totalCr)}</td></tr>
      </tbody>
    </table>
  );
}

// ---------- Ledgers list ----------
function Accounts({ list, idx, q, setQ, searchRef, onOpen, vouchers }: {
  list: Ledger[]; idx: number; q: string; setQ: (s: string) => void; searchRef: React.RefObject<HTMLInputElement | null>; onOpen: (id: string) => void; vouchers: Voucher[];
}) {
  return (
    <div>
      <input ref={searchRef} className="search" placeholder="Type to find a ledger…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: "100%", marginBottom: 8 }} />
      {list.length ? (
        <table className="t-table">
          <thead><tr><th>Name of Ledger</th><th>Under</th><th className="amt">Closing Balance</th></tr></thead>
          <tbody>
            {list.map((l, i) => (
              <tr key={l.id} className="click" style={i === idx ? { background: "rgba(148,99,23,.16)" } : undefined} onClick={() => onOpen(l.id)}>
                <td>{l.name}</td>
                <td className="vch">{l.group}</td>
                <td className="amt">{bal(ledgerBalance(l, vouchers))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="t-empty">No ledger matches “{q}”. Alt+C to create one.</div>
      )}
    </div>
  );
}

// ---------- Ledger statement (Tally T-format) ----------
function Statement({ ledger, st, onDelete }: { ledger: Ledger; st: ReturnType<typeof ledgerStatement>; onDelete: (v: Voucher) => void }) {
  return (
    <div>
      <div style={{ marginBottom: 8, color: "var(--t-navy)", fontWeight: 700 }}>
        {ledger.name} <span style={{ color: "#8a7b45", fontWeight: 400 }}>· {ledger.group}{ledger.gstin ? " · " + ledger.gstin : ""}</span>
      </div>
      <table className="t-table">
        <thead><tr><th>Date</th><th>Particulars</th><th>Vch</th><th className="amt">Debit</th><th className="amt">Credit</th><th className="amt">Balance</th></tr></thead>
        <tbody>
          <tr className="op"><td /><td>Opening Balance</td><td /><td className="amt" /><td className="amt" /><td className="amt">{bal(st.opening)}</td></tr>
          {st.rows.map((r) => (
            <tr key={r.v.id} className="click" title="Tap to delete" onClick={() => onDelete(r.v)}>
              <td>{r.v.date}</td>
              <td>{r.particulars}</td>
              <td className="vch">{r.v.type} · {r.v.no}</td>
              <td className="amt dr">{r.dr ? inr(r.dr) : ""}</td>
              <td className="amt cr">{r.cr ? inr(r.cr) : ""}</td>
              <td className="amt">{bal(r.running)}</td>
            </tr>
          ))}
          <tr className="tot"><td /><td>Total</td><td /><td className="amt">{inr(st.totalDr)}</td><td className="amt">{inr(st.totalCr)}</td><td className="amt" /></tr>
          <tr className="cl"><td /><td>Closing Balance</td><td /><td className="amt" /><td className="amt" /><td className="amt">{bal(st.closing)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}
