"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { prefGet } from "@/lib/data";
import { createQuotation } from "@/lib/create";
import { useApp } from "@/store/useApp";
import PaperScanner from "@/components/PaperScanner";
import { paperTargetQuote } from "@/lib/paper-client";
import SheetImportView from "@/components/views/SheetImportView";

export default function Page() {
  const { ready } = useApp();
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [sheetFile, setSheetFile] = useState<File | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
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

  async function takeScan(file: File) {
    setScanOpen(false);
    const id = await paperTargetQuote(file);
    router.push("/editor/" + id);
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
        <button className="btn" onClick={() => setScanOpen(true)}>
          Scan paper
        </button>
        <button className="btn" onClick={() => xlsRef.current?.click()}>
          Excel
        </button>
      </div>
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
      {scanOpen ? <PaperScanner onPhoto={(file) => void takeScan(file)} onClose={() => setScanOpen(false)} /> : null}
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
