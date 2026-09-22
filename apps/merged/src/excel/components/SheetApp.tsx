"use client";
import { useEffect, useRef, useState } from "react";
import { makeDebounce, shouldAutosave, type Debounced } from "../lib/autosave";
import type { SheetEngine } from "../lib/engine";
import { DEFAULT_FOLDER_ID } from "../lib/folder";
import { phoneNow } from "../lib/phone";
import { shouldWriteSnap } from "../lib/persist";
import {
  addFolder,
  deleteBook,
  deleteFolder,
  listBooks,
  listFolders,
  loadSnapshot,
  moveBook,
  renameBook,
  renameFolder,
  saveBook,
  setLastOpen,
  stamp,
  type BookMeta,
  type FolderMeta,
} from "../lib/store";
import { exportXlsx, freshId, importXlsx } from "../lib/xlsx-io";
import { csvFromSheet, parseCsv, snapshotFromCsv } from "../lib/csv";
import { snapshotFromPreset } from "../lib/preset";
import type { UniSnapshot } from "../lib/xlsx-convert";
import { emptyYardSnapshot, yardFromGrid, yardFromSheetBytes } from "../lib/yard-format";
import ExcelHome from "./ExcelHome";

type UniverAPI = SheetEngine["univerAPI"];
type SaveState = "loading" | "saving" | "saved";
type Pending = {
  snapshot: Record<string, unknown> | null;
  name?: string;
  folderId: string;
  /** Already in the store — do not write the snapshot again on open (phone hitch). */
  keep?: boolean;
};

/** Home first. The engine only mounts when a book is opened, so Excel click is a window, not a sheet. */
export default function SheetApp() {
  const frame = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const apiRef = useRef<UniverAPI | null>(null);
  const autoRef = useRef<Debounced | null>(null);
  const unitRef = useRef<string>("");
  const nameRef = useRef("");
  const folderRef = useRef(DEFAULT_FOLDER_ID);
  const pendingRef = useRef<Pending | null>(null);
  const [view, setView] = useState<"home" | "sheet">("home");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<SaveState>("saved");
  const [books, setBooks] = useState<BookMeta[]>([]);
  const [folders, setFolders] = useState<FolderMeta[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [full, setFull] = useState(false);

  function rename(next: string) {
    nameRef.current = next;
    setName(next);
  }

  async function refreshLists() {
    const [nextBooks, nextFolders] = await Promise.all([listBooks(), listFolders()]);
    setBooks(nextBooks);
    setFolders(nextFolders);
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
      {
        id,
        name: nameRef.current || String(snap.name || "") || "Book",
        savedAt: stamp(),
        folderId: folderRef.current,
      },
      snap,
    );
    await refreshLists();
    setStatus("saved");
  }

  async function show(snapshot: Record<string, unknown> | null, displayName?: string, keep?: boolean) {
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
    if (!keep) {
      // paint first; a full snapshot write on open is what made the phone hitch
      requestAnimationFrame(() => {
        void persistNow();
      });
    }
    await setLastOpen(wb.getId());
  }

  function enterSheet(pending: Pending) {
    folderRef.current = pending.folderId;
    pendingRef.current = pending;
    setStatus("loading");
    setView("sheet");
  }

  async function goHome() {
    autoRef.current?.flush();
    await persistNow();
    const el = frame.current;
    if (el?.classList.contains("is-full")) classFull(el);
    document.body.classList.remove("xl-sheet", "xl-full");
    setView("home");
    setMoreOpen(false);
  }

  useEffect(() => {
    void refreshLists();
  }, []);

  useEffect(() => {
    let raf = 0;
    const fit = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const el = frame.current;
        if (!el) return;
        if (document.fullscreenElement === el || el.classList.contains("is-full")) {
          el.style.height = "100dvh";
          return;
        }
        const bar = document.querySelector(".phone-tabs");
        const bottom = bar ? bar.getBoundingClientRect().height : 0;
        const vv = window.visualViewport;
        const height = vv?.height ?? window.innerHeight;
        const top = el.getBoundingClientRect().top - (vv?.offsetTop ?? 0);
        el.style.height = Math.max(320, height - top - bottom) + "px";
      });
    };
    const onFull = () => {
      setFull(!!document.fullscreenElement);
      fit();
    };
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    // visualViewport.scroll fires while the URL bar hides and would reflow the
    // canvas mid-flick. Resize already covers the size change.
    window.visualViewport?.addEventListener("resize", fit);
    document.addEventListener("fullscreenchange", onFull);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
      window.visualViewport?.removeEventListener("resize", fit);
      document.removeEventListener("fullscreenchange", onFull);
    };
  }, []);

  useEffect(() => {
    if (view !== "sheet") return;
    const outer = holder.current;
    if (!outer) return;
    let dead = false;
    const container = document.createElement("div");
    container.style.cssText = "position:absolute;inset:0";
    outer.appendChild(container);
    const phone = phoneNow();
    let univer: SheetEngine["univer"] | undefined;
    let worker: Worker | undefined;
    let heard: { dispose?: () => void } | undefined;
    let auto: Debounced | undefined;
    // Files home must not pay for Univer. Load the engine only when a book opens.
    void (async () => {
      const [{ startEngine }] = await Promise.all([
        import("../lib/engine"),
        import("@univerjs/preset-sheets-core/lib/index.css"),
      ]);
      if (dead) return;
      const engine = startEngine(container, phone);
      univer = engine.univer;
      worker = engine.worker;
      apiRef.current = engine.univerAPI;
      auto = makeDebounce(() => {
        void persistNow();
      }, phone ? 1800 : 1000);
      autoRef.current = auto;
      heard = engine.univerAPI.onCommandExecuted((command) => {
        if (shouldAutosave(command.id)) {
          setStatus("saving");
          auto?.kick();
        }
      });
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (dead) return;
      await show(pending?.snapshot ?? null, pending?.name, pending?.keep);
      if (dead) return;
      setStatus("saved");
      exposeForChecks(engine.univerAPI);
      document.body.classList.add("xl-sheet");
      if (phone && frame.current && !frame.current.classList.contains("is-full")) classFull(frame.current);
    })();
    return () => {
      dead = true;
      heard?.dispose?.();
      auto?.cancel();
      apiRef.current = null;
      unitRef.current = "";
      document.body.classList.remove("xl-sheet");
      setTimeout(() => {
        univer?.dispose();
        worker?.terminate();
        container.remove();
      }, 0);
    };
  }, [view]);

  useEffect(() => {
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

  function currentFolder() {
    return folderId || folderRef.current || DEFAULT_FOLDER_ID;
  }

  function startNew() {
    const snap = emptyYardSnapshot();
    const id = currentFolder();
    folderRef.current = id;
    enterSheet({ snapshot: snap as unknown as Record<string, unknown>, name: snap.name, folderId: id });
  }

  function startPreset(presetId: string) {
    const snap = snapshotFromPreset(presetId);
    const id = currentFolder();
    folderRef.current = id;
    enterSheet({ snapshot: snap as unknown as Record<string, unknown>, name: snap.name, folderId: id });
  }

  async function openBook(id: string) {
    const snapshot = await loadSnapshot(id);
    if (!snapshot) return;
    const row = books.find((b) => b.id === id);
    folderRef.current = row?.folderId || DEFAULT_FOLDER_ID;
    enterSheet({ snapshot, name: row?.name, folderId: folderRef.current, keep: true });
  }

  async function openPickedFile(picked: File) {
    setStatus("loading");
    try {
      let snapshot: UniSnapshot;
      if (/\.csv$/i.test(picked.name)) {
        const text = await picked.text();
        snapshot = yardFromGrid(parseCsv(text)) ?? snapshotFromCsv(text);
        snapshot.id = freshId();
        snapshot.name = picked.name.replace(/\.[^.]+$/, "") || snapshot.name;
        if (!snapshot.sheetOrder.length) throw new Error("No rows found in that file");
      } else {
        const buf = new Uint8Array(await picked.arrayBuffer());
        snapshot = (await yardFromSheetBytes(picked.name, buf)) ?? (await importXlsx(picked));
        snapshot.name = picked.name.replace(/\.[^.]+$/, "") || snapshot.name;
      }
      const id = currentFolder();
      folderRef.current = id;
      enterSheet({ snapshot: snapshot as unknown as Record<string, unknown>, name: snapshot.name, folderId: id });
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

  function toggleFull() {
    const el = frame.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    if (el.requestFullscreen) {
      void el.requestFullscreen().catch(() => classFull(el));
      return;
    }
    classFull(el);
  }

  function classFull(el: HTMLDivElement) {
    const on = !el.classList.contains("is-full");
    el.classList.toggle("is-full", on);
    document.body.classList.toggle("xl-full", on);
    el.style.height = on ? "100dvh" : "";
    setFull(on);
  }

  async function editBookName(book: BookMeta) {
    const next = window.prompt("Rename file", book.name);
    if (next == null) return;
    await renameBook(book.id, next);
    await refreshLists();
  }

  async function placeBook(book: BookMeta, dest: string) {
    await moveBook(book.id, dest);
    await refreshLists();
  }

  async function removeBook(book: BookMeta) {
    if (!window.confirm("Delete “" + book.name + "”?")) return;
    await deleteBook(book.id);
    await refreshLists();
  }

  async function makeFolder() {
    const name = window.prompt("Folder name", "Folder");
    if (name == null) return;
    const folder = await addFolder(name);
    await refreshLists();
    setFolderId(folder.id);
    setMoreOpen(false);
  }

  async function editFolderName(folder: FolderMeta) {
    const name = window.prompt("Rename folder", folder.name);
    if (name == null) return;
    await renameFolder(folder.id, name);
    await refreshLists();
  }

  async function dropFolder(folder: FolderMeta) {
    if (folder.id === DEFAULT_FOLDER_ID) return;
    if (!window.confirm("Delete “" + folder.name + "”? Files move to My sheets.")) return;
    await deleteFolder(folder.id);
    setFolderId(DEFAULT_FOLDER_ID);
    await refreshLists();
  }

  return (
    <div ref={frame} className="xl-frame">
      {view === "home" ? (
        <ExcelHome
          folders={folders}
          books={books}
          folderId={folderId}
          moreOpen={moreOpen}
          onNew={startNew}
          onOpenFile={() => fileRef.current?.click()}
          onNewFolder={() => void makeFolder()}
          onOpenFolder={setFolderId}
          onOpenBook={(id) => void openBook(id)}
          onRenameBook={(b) => void editBookName(b)}
          onMoveBook={(b, dest) => void placeBook(b, dest)}
          onDeleteBook={(b) => void removeBook(b)}
          onRenameFolder={(f) => void editFolderName(f)}
          onDeleteFolder={(f) => void dropFolder(f)}
          onToggleMore={() => setMoreOpen((v) => !v)}
          onPreset={startPreset}
        />
      ) : (
        <>
          <header className="xl-bar">
            <button type="button" className="xl-btn" onClick={() => void goHome()}>
              ← Files
            </button>
            <input
              className="xl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={renameOpenBook}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              aria-label="Workbook name"
              spellCheck={false}
            />
            <details className="xl-tools">
              <summary className="xl-btn">More</summary>
              <div className="xl-tools-pop">
                <button type="button" className="xl-btn" onClick={exportNow}>
                  Export
                </button>
                <button type="button" className="xl-btn" onClick={exportCsvNow}>
                  CSV
                </button>
              </div>
            </details>
            <button type="button" className="xl-btn xl-full-btn" onClick={toggleFull} aria-pressed={full}>
              {full ? "Exit" : "Full"}
            </button>
            <span className="xl-hint" role="status">
              {status === "loading" ? "Opening…" : status === "saving" ? "Saving…" : "Saved"}
            </span>
          </header>
          <div ref={holder} className="xl-holder" />
        </>
      )}
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
    </div>
  );
}

function exposeForChecks(api: unknown) {
  if (process.env.NODE_ENV !== "production") {
    (window as unknown as { __excelAPI?: unknown }).__excelAPI = api;
  }
}

function nextName(existing: BookMeta[]): string {
  const taken = new Set(existing.map((b) => b.name));
  for (let i = 1; ; i++) {
    const candidate = "Book " + i;
    if (!taken.has(candidate)) return candidate;
  }
}
