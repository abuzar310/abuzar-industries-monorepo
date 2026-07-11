"use client";
import { useEffect, useState } from "react";
import { allRec, delRec, getRec, put } from "@/lib/data";
import { nowIso } from "@/lib/calc";
import { stockKey } from "@/lib/stock";
import { useApp } from "@/store/useApp";
import { bumpData } from "@/store/app-store";
import { confirmDialog, formDialog } from "@/store/dialog-store";
import type { Stock } from "@/lib/types";

export default function StockView() {
  const { dataVersion } = useApp();
  const [rows, setRows] = useState<Stock[]>([]);
  const [adj, setAdj] = useState<Record<string, string>>({});

  function load() {
    allRec<Stock>("stock").then((list) => {
      list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      setRows(list);
    });
  }
  useEffect(() => {
    load();
  }, [dataVersion]);

  function patchLocal(key: string, patch: Partial<Stock>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  async function commit(key: string, patch: Partial<Stock>) {
    const s = await getRec<Stock>("stock", key);
    if (!s) return;
    Object.assign(s, patch, { updatedAt: nowIso() });
    await put("stock", s);
    bumpData();
  }
  async function applyAdjust(key: string) {
    const v = +adj[key] || 0;
    if (!v) return;
    const s = await getRec<Stock>("stock", key);
    if (!s) return;
    const cft = Math.round(((+s.cft || 0) + v) * 100) / 100;
    setAdj((a) => ({ ...a, [key]: "" }));
    patchLocal(key, { cft });
    await commit(key, { cft });
  }
  async function addStock() {
    const res = await formDialog({
      title: "Add wood type",
      fields: [
        { name: "name", label: "Wood type", placeholder: "e.g. Teak", required: true },
        { name: "cft", label: "Opening stock (CFT)", type: "number", inputMode: "decimal", placeholder: "0" },
      ],
      submitLabel: "Add",
    });
    if (!res) return;
    await put("stock", {
      key: stockKey(res.name),
      name: res.name.trim(),
      cft: Math.round((+res.cft || 0) * 100) / 100,
      updatedAt: nowIso(),
    });
    load();
  }
  async function remove(key: string, name: string) {
    const ok = await confirmDialog({
      title: "Remove " + name + "?",
      message: "This removes the wood type from your stock list.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    await delRec("stock", key);
    load();
  }

  return (
    <div>
      <div className="sectitle">
        Stock <small>— timber inventory in CFT</small>
      </div>
      <div className="listwrap">
        <div
          className="stockrow"
          style={{
            fontFamily: "var(--disp)",
            textTransform: "uppercase",
            letterSpacing: ".08em",
            fontSize: "10.5px",
            color: "var(--ink-soft)",
            background: "var(--panel)",
            borderBottom: "2px solid var(--ink)",
          }}
        >
          <span>Wood type</span>
          <span>Available CFT</span>
          <span>Add / Remove</span>
          <span />
        </div>
        {rows.length ? (
          rows.map((s) => (
            <div className="stockrow" key={s.key}>
              <input
                value={s.name}
                onChange={(e) => patchLocal(s.key, { name: e.target.value })}
                onBlur={(e) => commit(s.key, { name: e.target.value })}
              />
              <input
                type="number"
                value={s.cft}
                onChange={(e) => patchLocal(s.key, { cft: +e.target.value })}
                onBlur={(e) => commit(s.key, { cft: Math.round((+e.target.value || 0) * 100) / 100 })}
              />
              <input
                type="number"
                placeholder="+/- CFT"
                value={adj[s.key] || ""}
                onChange={(e) => setAdj((a) => ({ ...a, [s.key]: e.target.value }))}
                onBlur={() => applyAdjust(s.key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
              />
              <button className="btn warn sm" onClick={() => remove(s.key, s.name)}>
                Remove
              </button>
            </div>
          ))
        ) : (
          <div className="empty">No wood types yet. Add Teak, Neem, etc.</div>
        )}
      </div>
      <div className="rowbtns">
        <button className="btn sm" onClick={addStock}>
          + Add wood type
        </button>
      </div>
      <p className="note" style={{ marginTop: 10 }}>
        When an invoice is marked <b>Paid</b>, its CFT is automatically deducted from matching stock (matched by
        wood-type name).
      </p>
    </div>
  );
}
