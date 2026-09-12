"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { prefGet } from "@/lib/data";
import { createQuotation } from "@/lib/create";
import { useApp } from "@/store/useApp";
import PaperQuoteView from "@/components/views/PaperQuoteView";

export default function Page() {
  const { ready } = useApp();
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [paperFile, setPaperFile] = useState<File | null>(null);
  const [paperOpen, setPaperOpen] = useState(false);
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);

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
    <div style={{ textAlign: "center", padding: "54px 20px" }}>
      <div style={{ fontFamily: "var(--serif)", fontSize: 30, letterSpacing: "-.01em", color: "var(--walnut)", marginBottom: 8 }}>
        No quotation open
      </div>
      <p className="note" style={{ margin: "0 0 20px" }}>
        Start a new quotation whenever you&apos;re ready.
      </p>
      <div className="rowbtns" style={{ justifyContent: "center" }}>
        <button className="btn primary" style={{ fontSize: 16, padding: "12px 24px" }} onClick={create}>
          + Create a quotation
        </button>
        <button className="btn" style={{ fontSize: 16, padding: "12px 24px" }} onClick={() => camRef.current?.click()}>
          From paper
        </button>
        <button className="btn" style={{ fontSize: 16, padding: "12px 24px" }} onClick={() => libRef.current?.click()}>
          Add image
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
    </div>
  );
}
