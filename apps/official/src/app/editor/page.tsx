"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { prefGet } from "@/lib/data";
import { createQuotation } from "@/lib/create";
import { useApp } from "@/store/useApp";

export default function Page() {
  const { ready } = useApp();
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!ready) return;
    // The Quotation tab resumes quotations only — never an invoice (checked by store,
    // since invoice ids are now plain numbers with no "INV" prefix to detect them by).
    const last = prefGet<{ store: string; id: string } | null>("lastOpen", null);
    /* eslint-disable react-hooks/set-state-in-effect */
    if (last && last.id && last.store === "quotations") router.replace("/editor/" + last.id);
    else setChecked(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [ready, router]);

  async function create() {
    const d = await createQuotation();
    router.push("/editor/" + d.id);
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
      <button className="btn primary" style={{ fontSize: 16, padding: "12px 24px" }} onClick={create}>
        + Create a quotation
      </button>
    </div>
  );
}
