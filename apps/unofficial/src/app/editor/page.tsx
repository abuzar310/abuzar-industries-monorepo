"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { prefGet } from "@/lib/data";
import { createQuotation } from "@/lib/create";
import { useApp } from "@/store/useApp";
import PaperScanner from "@/components/PaperScanner";
import { paperTargetQuote } from "@/lib/paper-client";
import { IMPORT_ACCEPT, importKind } from "@/lib/sheet-import";

export default function Page() {
  const { ready } = useApp();
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanFile, setScanFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  function closeScan() {
    setScanOpen(false);
    setScanFile(null);
  }

  /** The photo or file waits in memory while its quotation opens, then reads there. */
  async function openWith(file: File) {
    closeScan();
    const id = await paperTargetQuote(file);
    router.push("/editor/" + id);
  }

  /** A photo goes through the crop screen first; Excel, CSV and PDF go straight to the quotation. */
  function takeImport(file: File | undefined) {
    if (!file) return;
    if (importKind(file) === "image") {
      setScanFile(file);
      setScanOpen(true);
    } else void openWith(file);
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
        <button className="btn" onClick={() => fileRef.current?.click()}>
          Excel / PDF
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={IMPORT_ACCEPT}
        hidden
        onChange={(e) => {
          takeImport(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {scanOpen ? (
        <PaperScanner file={scanFile ?? undefined} onPhoto={(file) => void openWith(file)} onClose={closeScan} />
      ) : null}
    </div>
  );
}
