"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { prefGet } from "@/lib/data";
import { createQuotation } from "@/lib/create";
import { useApp } from "@/store/useApp";
import PaperQuoteView from "@/components/views/PaperQuoteView";
import SheetImportView from "@/components/views/SheetImportView";

export default function Page() {
  const { ready } = useApp();
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [paperFile, setPaperFile] = useState<File | null>(null);
  const [paperOpen, setPaperOpen] = useState(false);
  const [sheetFile, setSheetFile] = useState<File | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);
  const xlsRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!ready) return;
    const last = prefGet<{ store: string; id: string } | null>("lastOpen", null);
    /* eslint-disable react-hooks/set-state-in-effect */
    if (last && last.id) router.replace("/editor/" + last.id);
    else setChecked(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [ready, router]);

  async function create() {
    const d = await createQuotation();
    router.push("/editor/" + d.id);
  }

  function take(file: File | undefined) {
    if (!file) return;
    setPaperFile(file);
    setPaperOpen(true);
  }

  if (!checked) {
    return (
      <div className="sectitle">
        Quotation <small>— loading…</small>
      </div>
    );
  }
  return (
    <div className="editor-none ph-kit">
      <div className="editor-none-title">
        No quotation open
      </div>
      <p className="note editor-none-note">
        Start a new quotation whenever you&apos;re ready.
      </p>
      <div className="rowbtns">
        <button className="btn primary" onClick={create}>
          + Create a quotation
        </button>
        <button className="btn" onClick={() => camRef.current?.click()}>
          From paper
        </button>
        <button className="btn" onClick={() => libRef.current?.click()}>
          Add image
        </button>
        <button className="btn" onClick={() => xlsRef.current?.click()}>
          Excel
        </button>
      </div>
      <input
        ref={camRef}
        type="file"
        accept="image/*,.heic,.heif"
        capture="environment"
        hidden
        onChange={(e) => {
          take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={libRef}
        type="file"
        accept="image/*,.heic,.heif"
        hidden
        onChange={(e) => {
          take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={xlsRef}
        type="file"
        accept=".xlsx,.xlsm,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setSheetFile(file);
          setSheetOpen(true);
        }}
      />
      {paperOpen ? (
        <div className="paper-quote-overlay">
          <PaperQuoteView
            initialFile={paperFile}
            onCancel={() => {
              setPaperOpen(false);
              setPaperFile(null);
            }}
          />
        </div>
      ) : null}
      {sheetOpen ? (
        <div className="paper-quote-overlay">
          <SheetImportView
            initialFile={sheetFile}
            onCancel={() => {
              setSheetOpen(false);
              setSheetFile(null);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
