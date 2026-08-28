"use client";
// Owner-only detailed activity log: login / logout / create / update / delete.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec } from "@/lib/data";
import { inr } from "@/lib/calc";
import { useApp } from "@/store/useApp";
import Pager, { PAGE, usePager } from "@/components/Pager";
import type { Activity } from "@/lib/types";

type Act = Activity["action"];

const actionLabel = (a: Act) =>
  a === "login" ? "Login" : a === "logout" ? "Logout" : a === "create" ? "Created" : a === "update" ? "Updated" : "Deleted";

const actionTone = (a: Act) =>
  a === "login" ? "var(--green)" : a === "logout" ? "var(--ink-faint)" : a === "create" ? "var(--green)" : a === "update" ? "var(--ochre-deep, #8a5a2b)" : "var(--danger)";

function fmtWhen(iso: string): { day: string; time: string; full: string } {
  if (!iso) return { day: "—", time: "", full: "—" };
  const d = new Date(iso);
  if (isNaN(+d)) return { day: iso, time: "", full: iso };
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = pad(d.getDate()) + "-" + pad(d.getMonth() + 1) + "-" + String(d.getFullYear()).slice(2);
  const time = pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  return { day, time, full: day + " " + time };
}

export default function LogsView() {
  const { ready, dataVersion, user, cloakMoney } = useApp();
  const router = useRouter();
  const [rowsRaw, setRows] = useState<Activity[]>([]);
  const rows = cloakMoney ? [] : rowsRaw;
  const [q, setQ] = useState("");
  const [actionF, setActionF] = useState<"all" | Act>("all");
  const [whoF, setWhoF] = useState<"all" | string>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    allRec<Activity>("activity").then(setRows);
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, dataVersion, load]);

  useEffect(() => {
    if (user && user.role !== "owner") router.replace("/");
  }, [user, router]);

  const people = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) if (r.by) m.set(r.by, r.byName || r.by);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...rows]
      .filter((r) => (actionF === "all" ? true : r.action === actionF))
      .filter((r) => (whoF === "all" ? true : r.by === whoF))
      .filter((r) => {
        if (!needle) return true;
        return [r.summary, r.detail, r.byName, r.by, r.role, r.store, r.targetId, r.action, r.party, r.mode, r.date, r.amount != null ? String(r.amount) : ""]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => (b.at || b.createdAt || "").localeCompare(a.at || a.createdAt || ""));
  }, [rows, q, actionF, whoF]);

  const logPg = usePager(shown, PAGE, q + "\0" + actionF + "\0" + whoF);

  if (user && user.role !== "owner") {
    return (
      <div className="empty" style={{ padding: 24 }}>
        Logs are for the owner only.
      </div>
    );
  }

  return (
    <div>
      <div className="sectitle">
        Logs <small>— full activity trail · login, logout, create, update, delete</small>
      </div>

      <div className="rep-controls" style={{ marginBottom: 12 }}>
        <div className="rep-presets" style={{ flexWrap: "wrap" }}>
          {(["all", "login", "logout", "create", "update", "delete"] as const).map((a) => (
            <button
              key={a}
              className={"btn sm" + (actionF === a ? " primary" : "")}
              type="button"
              onClick={() => setActionF(a)}
            >
              {a === "all" ? "All (" + rows.length + ")" : actionLabel(a)}
            </button>
          ))}
        </div>
        <div className="rep-range">
          <label>
            Who
            <select value={whoF} onChange={(e) => setWhoF(e.target.value)}>
              <option value="all">Everyone</option>
              {people.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          </label>
          <label>
            Search
            <input
              type="text"
              placeholder="party / amount / note / id…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="panel-card" style={{ padding: 0, overflow: "hidden" }}>
        {shown.length ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--t-cream2, #f6f0e4)", borderBottom: "1px solid var(--line)" }}>
                  <th style={th}>When</th>
                  <th style={th}>Who</th>
                  <th style={th}>Action</th>
                  <th style={th}>What</th>
                  <th style={{ ...th, textAlign: "right" }}>Amount</th>
                  <th style={th}>Mode / date</th>
                </tr>
              </thead>
              <tbody>
                {logPg.view.map((r) => {
                  const when = fmtWhen(r.at || r.createdAt);
                  const open = openId === r.id;
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setOpenId(open ? null : r.id)}
                      style={{
                        borderBottom: "1px solid var(--line)",
                        cursor: "pointer",
                        background: open ? "rgba(0,0,0,0.03)" : "transparent",
                        verticalAlign: "top",
                      }}
                    >
                      <td style={td} colSpan={open ? 6 : 1}>
                        {!open ? (
                          <div style={{ fontFamily: "var(--mono)", fontSize: 11, whiteSpace: "nowrap" }}>
                            <div>{when.day}</div>
                            <div style={{ color: "var(--ink-faint)" }}>{when.time}</div>
                          </div>
                        ) : (
                          <div style={{ padding: "8px 4px 12px" }}>
                            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 8, alignItems: "baseline" }}>
                              <b style={{ color: actionTone(r.action) }}>{actionLabel(r.action)}</b>
                              <span>{r.summary}</span>
                              <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-faint)" }}>
                                {when.full}
                              </span>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8, marginBottom: 10, fontSize: 12 }}>
                              <Meta label="Who" value={(r.byName || r.by || "—") + (r.role ? " · " + r.role : "")} />
                              <Meta label="User id" value={r.by || "—"} />
                              <Meta label="Store" value={r.store || "—"} />
                              <Meta label="Record id" value={r.targetId || "—"} />
                              <Meta label="Party" value={r.party || "—"} />
                              <Meta label="Amount" value={r.amount != null ? "₹" + inr(r.amount) : "—"} />
                              <Meta label="Mode" value={r.mode || "—"} />
                              <Meta label="Biz date" value={r.date || "—"} />
                              <Meta label="Log id" value={r.id} />
                            </div>
                            {r.detail ? (
                              <pre
                                style={{
                                  margin: 0,
                                  padding: 12,
                                  background: "var(--t-cream2, #f6f0e4)",
                                  borderRadius: 8,
                                  whiteSpace: "pre-wrap",
                                  wordBreak: "break-word",
                                  fontFamily: "var(--mono)",
                                  fontSize: 11,
                                  lineHeight: 1.55,
                                }}
                              >
                                {r.detail}
                              </pre>
                            ) : (
                              <div className="empty-note">No extra detail on this entry.</div>
                            )}
                          </div>
                        )}
                      </td>
                      {!open && (
                        <>
                          <td style={td}>
                            <div style={{ fontWeight: 600 }}>{r.byName || r.by || "—"}</div>
                            <div style={{ fontSize: 10, color: "var(--ink-faint)", textTransform: "capitalize" }}>{r.role || "—"}</div>
                          </td>
                          <td style={td}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "1px 7px",
                                borderRadius: 999,
                                fontSize: 10,
                                fontWeight: 700,
                                letterSpacing: ".06em",
                                textTransform: "uppercase",
                                color: actionTone(r.action),
                                background: "rgba(0,0,0,0.04)",
                              }}
                            >
                              {actionLabel(r.action)}
                            </span>
                          </td>
                          <td style={td}>
                            <div style={{ fontWeight: 600 }}>{r.summary || "—"}</div>
                            {(r.party || r.store) && (
                              <div style={{ fontSize: 10, color: "var(--ink-faint)" }}>
                                {[r.party, r.store, r.targetId && ("id " + r.targetId.slice(0, 12))].filter(Boolean).join(" · ")}
                              </div>
                            )}
                            <div style={{ fontSize: 10, color: "var(--ink-faint)", marginTop: 2 }}>Tap for full detail ▾</div>
                          </td>
                          <td style={{ ...td, textAlign: "right", fontFamily: "var(--mono)", fontWeight: 700 }}>
                            {r.amount != null ? "₹" + inr(r.amount) : "—"}
                          </td>
                          <td style={{ ...td, fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-faint)" }}>
                            <div>{r.mode || "—"}</div>
                            <div>{r.date || ""}</div>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty" style={{ padding: 24 }}>
            <div className="empty-title">No log entries{q || actionF !== "all" || whoF !== "all" ? " in this filter" : " yet"}</div>
            <div className="empty-note">
              Every sign-in, sign-out, create, edit and delete is recorded with who, when, amounts and field changes.
            </div>
          </div>
        )}
      </div>
      <Pager page={logPg.page} pages={logPg.pages} total={logPg.total} onPage={logPg.setPage} />
    </div>
  );
}

const th: React.CSSProperties = {
  padding: "8px 10px",
  textAlign: "left",
  fontFamily: "var(--disp)",
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: ".09em",
  textTransform: "uppercase",
  color: "var(--ink-faint)",
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  padding: "8px 10px",
};

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--ink-faint)", fontWeight: 700 }}>{label}</div>
      <div style={{ fontFamily: "var(--mono)", fontSize: 11, wordBreak: "break-all" }}>{value}</div>
    </div>
  );
}
