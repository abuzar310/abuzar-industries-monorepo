"use client";
import { useEffect, useRef, useState } from "react";
import "@univerjs/preset-sheets-core/lib/index.css";
import { createUniver, LocaleType, mergeLocales } from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import UniverPresetSheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import { makeDebounce, shouldAutosave, type Debounced } from "../lib/autosave";
import { shouldWriteSnap } from "../lib/persist";
import { deleteBook, getLastOpen, listBooks, loadSnapshot, saveBook, setLastOpen, stamp, type BookMeta } from "../lib/store";
import { exportXlsx, freshId, importXlsx } from "../lib/xlsx-io";
import { csvFromSheet, snapshotFromCsv } from "../lib/csv";
import type { UniSnapshot } from "../lib/xlsx-convert";

type UniverAPI = ReturnType<typeof createUniver>["univerAPI"];
type SaveState = "loading" | "saving" | "saved";

const dayText = (at: number) =>
  new Date(at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) +
  " " +
  new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** The engine under our own top bar. Every change saves to this device; Books lists what is kept. */
export default function SheetApp() {
  const frame = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const apiRef = useRef<UniverAPI | null>(null);
  const autoRef = useRef<Debounced | null>(null);
  // The open unit is tracked by id: getActiveWorkbook() can point at a stale unit for a moment.
  const unitRef = useRef<string>("");
  // Like Excel, the book's name is ours (the file's name), not a cell of the engine.
  // The store row is the truth; the engine's internal name is only mirrored best-effort.
  const nameRef = useRef("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<SaveState>("loading");
  const [books, setBooks] = useState<BookMeta[]>([]);
  const [showBooks, setShowBooks] = useState(false);

  function rename(next: string) {
    nameRef.current = next;
    setName(next);
  }

  function openWorkbook() {
    const api = apiRef.current;
    if (!api) return null;
    const active = api.getActiveWorkbook();
    const getWb = (api as { getWorkbook?: (id: string) => typeof active }).getWorkbook;
    if (unitRef.current && getWb) return getWb.call(api, unitRef.current) ?? active;
    return active;
  }

  async function persistNow() {
    const wb = openWorkbook();
    if (!wb) return;
    // Commit the in-cell editor first. save() only sees the model, so an open editor
    // used to write an empty sheet over a book that already had values.
    const ender = wb as unknown as { endEditingAsync?: (keep?: boolean) => Promise<boolean>; endEditing?: (keep?: boolean) => void };
    try {
      if (ender.endEditingAsync) await ender.endEditingAsync(true);
      else ender.endEditing?.(true);
    } catch {
      /* editor already closed */
    }
    const snap = wb.save() as unknown as Record<string, unknown>;
    const id = String(snap.id || unitRef.current);
    const prev = id ? await loadSnapshot(id) : null;
    if (!shouldWriteSnap(prev, snap)) {
      setStatus("saved");
      return;
    }
    await saveBook(
      { id, name: nameRef.current || String(snap.name || "") || "Book", savedAt: stamp() },
      snap,
    );
    setBooks(await listBooks());
    setStatus("saved");
  }

  /** Close what is open and show the given snapshot (or a fresh book). */
  async function show(snapshot: Record<string, unknown> | null, displayName?: string) {
    const api = apiRef.current;
    if (!api) return;
    autoRef.current?.flush();
    const stale = unitRef.current || api.getActiveWorkbook()?.getId() || "";
    if (stale) api.disposeUnit(stale);
    const wb = api.createWorkbook((snapshot ?? {}) as Parameters<UniverAPI["createWorkbook"]>[0]);
    unitRef.current = wb.getId();
    const display = displayName || wb.getName() || nextName(await listBooks());
    rename(display);
    try {
      if (wb.getName() !== display) wb.setName(display);
    } catch {
      /* the store row carries the name */
    }
    await persistNow();
    await setLastOpen(wb.getId());
  }

  useEffect(() => {
    // The sheet fills whatever the app chrome leaves. The top nav wraps to two rows at some
    // widths and the phone bar covers the bottom, so measure it rather than guess a height.
    const fit = () => {
      const el = frame.current;
      if (!el) return;
      const bar = document.querySelector(".phone-tabs");
      const bottom = bar ? bar.getBoundingClientRect().height : 0;
      el.style.height = Math.max(320, window.innerHeight - el.getBoundingClientRect().top - bottom) + "px";
    };
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
    };
  }, []);

  useEffect(() => {
    const outer = holder.current;
    if (!outer) return;
    let dead = false;
    // Each mount paints into its own inner div. React's dev remount then lets the deferred
    // dispose tear down only its own div, never the DOM the next mount just painted.
    const container = document.createElement("div");
    container.style.cssText = "position:absolute;inset:0";
    outer.appendChild(container);
    const { univer, univerAPI } = createUniver({
      locale: LocaleType.EN_US,
      locales: {
        [LocaleType.EN_US]: mergeLocales(UniverPresetSheetsCoreEnUS),
      },
      presets: [UniverSheetsCorePreset({ container, formulaBar: true, statusBarStatistic: true })],
    });
    apiRef.current = univerAPI;
    const auto = makeDebounce(() => {
      void persistNow();
    }, 1000);
    autoRef.current = auto;
    const heard = univerAPI.onCommandExecuted((command) => {
      if (shouldAutosave(command.id)) {
        setStatus("saving");
        auto.kick();
      }
    });
    void (async () => {
      const last = await getLastOpen();
      const rows = await listBooks();
      const snapshot = last ? await loadSnapshot(last) : null;
      if (dead) return;
      const wb = univerAPI.createWorkbook((snapshot ?? {}) as Parameters<UniverAPI["createWorkbook"]>[0]);
      unitRef.current = wb.getId();
      const row = last ? rows.find((b) => b.id === last) : undefined;
      const display = row?.name || wb.getName() || nextName(rows);
      rename(display);
      try {
        if (wb.getName() !== display) wb.setName(display);
      } catch {
        /* the store row carries the name */
      }
      await persistNow();
      await setLastOpen(wb.getId());
      if (!dead) setStatus("saved");
    })();
    exposeForChecks(univerAPI);
    return () => {
      dead = true;
      heard?.dispose();
      auto.cancel();
      apiRef.current = null;
      // Deferred: a synchronous dispose during React's own render (StrictMode remount) trips
      // "Attempted to synchronously unmount a root while React was already rendering".
      setTimeout(() => {
        univer.dispose();
        container.remove();
      }, 0);
    };
    // The engine mounts once; everything after that flows through its own events.
  }, []);

  useEffect(() => {
    // A save can be at most a second behind a closing tab; flushing here closes that gap.
    const flush = () => autoRef.current?.flush();
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, []);

  function renameOpenBook() {
    const clean = name.trim();
    if (!clean || clean === nameRef.current) {
      setName(nameRef.current);
      return;
    }
    rename(clean);
    try {
      apiRef.current?.getActiveWorkbook()?.setName(clean);
    } catch {
      /* the store row carries the name */
    }
    setStatus("saving");
    void persistNow();
  }

  async function openBook(id: string) {
    const open = apiRef.current?.getActiveWorkbook();
    if (open && open.getId() === id) {
      setShowBooks(false);
      return;
    }
    const snapshot = await loadSnapshot(id);
    if (!snapshot) return;
    await show(snapshot, books.find((b) => b.id === id)?.name);
    setShowBooks(false);
  }

  async function openPickedFile(picked: File) {
    setStatus("loading");
    try {
      let snapshot: UniSnapshot;
      if (/\.csv$/i.test(picked.name)) {
        snapshot = snapshotFromCsv(await picked.text());
        snapshot.id = freshId();
        snapshot.name = picked.name.replace(/\.[^.]+$/, "");
        if (!snapshot.sheetOrder.length) throw new Error("No rows found in that file");
      } else {
        snapshot = await importXlsx(picked);
      }
      await show(snapshot as unknown as Record<string, unknown>, snapshot.name);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Could not open that file");
      setStatus("saved");
    }
  }

  function exportNow() {
    const wb = openWorkbook();
    if (!wb) return;
    void exportXlsx(wb.save() as unknown as UniSnapshot, nameRef.current).catch((e) =>
      window.alert(e instanceof Error ? e.message : "Could not make the file"),
    );
  }

  /** The active sheet's values as a .csv file, the way Excel's own CSV save works. */
  function exportCsvNow() {
    const wb = apiRef.current?.getActiveWorkbook();
    if (!wb) return;
    const snap = wb.save() as unknown as UniSnapshot;
    const activeName = wb.getActiveSheet().getSheetName();
    const id = snap.sheetOrder.find((i) => snap.sheets[i]?.name === activeName) ?? snap.sheetOrder[0];
    const text = csvFromSheet(snap.sheets[id], snap.styles || {});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv" }));
    a.download = (nameRef.current.trim() || "Book") + ".csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  async function removeBook(book: BookMeta) {
    if (!window.confirm("Delete “" + book.name + "” from this device?")) return;
    await deleteBook(book.id);
    const open = apiRef.current?.getActiveWorkbook();
    if (open && open.getId() === book.id) await show(null);
    setBooks(await listBooks());
  }

  return (
    <div ref={frame} className="xl-frame">
      <header className="xl-bar">
        <span className="xl-mark">Excel</span>
        <input
          className="xl-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={renameOpenBook}
          onKeyDown={(e) => {
            // Keys typed here belong to the name, never to the sheet's own shortcuts.
            e.stopPropagation();
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          aria-label="Workbook name"
          spellCheck={false}
        />
        <button type="button" className="xl-btn" onClick={() => setShowBooks((v) => !v)} aria-expanded={showBooks}>
          Books
        </button>
        <button type="button" className="xl-btn" onClick={() => void show(null)}>
          New
        </button>
        <button type="button" className="xl-btn" onClick={() => fileRef.current?.click()}>
          Open
        </button>
        <button type="button" className="xl-btn" onClick={exportNow}>
          Export
        </button>
        <button type="button" className="xl-btn" onClick={exportCsvNow}>
          CSV
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.csv"
          hidden
          onChange={(e) => {
            const picked = e.target.files?.[0];
            e.target.value = "";
            if (picked) void openPickedFile(picked);
          }}
        />
        <span className="xl-hint" role="status">
          {status === "loading" ? "Opening…" : status === "saving" ? "Saving…" : "Saved on this device"}
        </span>
      </header>
      {showBooks ? (
        <div className="xl-pop">
          {books.length === 0 ? <p className="xl-empty">Nothing saved yet.</p> : null}
          {books.map((b) => (
            <div key={b.id} className="xl-row">
              <button type="button" className="xl-open" onClick={() => void openBook(b.id)}>
                <strong>{b.name}</strong>
                <em>{dayText(b.savedAt)}</em>
              </button>
              <button type="button" className="xl-x" aria-label={"Delete " + b.name} onClick={() => void removeBook(b)}>
                &times;
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div ref={holder} className="xl-holder" />
    </div>
  );
}

/** The check harness drives and reads the sheet through this handle. Dev only. */
function exposeForChecks(api: unknown) {
  if (process.env.NODE_ENV !== "production") {
    (window as unknown as { __excelAPI?: unknown }).__excelAPI = api;
  }
}

/** Book 1, Book 2, … the first name not already taken. */
function nextName(existing: BookMeta[]): string {
  const taken = new Set(existing.map((b) => b.name));
  for (let i = 1; ; i++) {
    const candidate = "Book " + i;
    if (!taken.has(candidate)) return candidate;
  }
}
