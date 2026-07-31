"use client";
// Owner-only activity log: login / logout / create / delete across the app.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec } from "@/lib/data";
import { useApp } from "@/store/useApp";
import type { Activity } from "@/lib/types";

const actionLabel = (a: Activity["action"]) =>
  a === "login" ? "Login" : a === "logout" ? "Logout" : a === "create" ? "Created" : "Deleted";

const actionClass = (a: Activity["action"]) =>
  a === "login" ? "cash" : a === "logout" ? "upi" : a === "create" ? "cash" : "due";

function fmtWhen(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(+d)) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    pad(d.getDate()) +
    "-" +
    pad(d.getMonth() + 1) +
    "-" +
    String(d.getFullYear()).slice(2) +
    " " +
    pad(d.getHours()) +
    ":" +
    pad(d.getMinutes())
  );
}

export default function LogsView() {
  const { ready, dataVersion, user } = useApp();
  const router = useRouter();
  const [rows, setRows] = useState<Activity[]>([]);
  const [q, setQ] = useState("");
  const [actionF, setActionF] = useState<"all" | Activity["action"]>("all");

  const load = useCallback(() => {
    allRec<Activity>("activity").then(setRows);
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, dataVersion, load]);

  useEffect(() => {
    if (user && user.role !== "owner") router.replace("/");
  }, [user, router]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...rows]
      .filter((r) => (actionF === "all" ? true : r.action === actionF))
      .filter(
        (r) =>
          !needle ||
          [r.summary, r.byName, r.by, r.store, r.targetId, r.action]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(needle),
      )
      .sort((a, b) => (b.at || b.createdAt || "").localeCompare(a.at || a.createdAt || ""));
  }, [rows, q, actionF]);

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
        Logs <small>— login, logout, create &amp; delete</small>
      </div>

      <div className="rep-controls" style={{ marginBottom: 12 }}>
        <div className="rep-presets">
          {(["all", "login", "logout", "create", "delete"] as const).map((a) => (
            <button
              key={a}
              className={"btn sm" + (actionF === a ? " primary" : "")}
              type="button"
              onClick={() => setActionF(a)}
            >
              {a === "all" ? "All" : actionLabel(a)}
            </button>
          ))}
        </div>
        <div className="rep-range">
          <label>
            Search
            <input
              type="text"
              placeholder="who / what…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="panel-card" style={{ padding: "0 0 4px" }}>
        {shown.length ? (
          shown.map((r) => (
            <div className="stmt" key={r.id}>
              <div className={"stmt-ic " + actionClass(r.action)}>{actionLabel(r.action).slice(0, 3)}</div>
              <div className="stmt-main">
                <div className="stmt-to">{r.summary || actionLabel(r.action)}</div>
                <div className="stmt-sub">
                  {r.byName || r.by || "—"} · {fmtWhen(r.at || r.createdAt)}
                  {r.store ? " · " + r.store : ""}
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="empty">
            <div className="empty-title">No log entries{q || actionF !== "all" ? " in this filter" : " yet"}</div>
            <div className="empty-note">
              Sign-ins, sign-outs, creates and deletes show here as they happen.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
