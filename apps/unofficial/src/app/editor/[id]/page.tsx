"use client";
import { useEffect, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { openTab } from "@/lib/editor-tabs";
import { useApp } from "@/store/useApp";

export default function Page() {
  const { ready } = useApp();
  const params = useParams<{ id: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const id = decodeURIComponent(params.id);
  const done = useRef(false);

  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    openTab(id, "", sp.get("action") || undefined, sp.get("pay") || undefined);
    router.replace("/editor");
  }, [ready, id, router, sp]);

  return (
    <div className="sectitle">
      {id} <small>— opening…</small>
    </div>
  );
}
