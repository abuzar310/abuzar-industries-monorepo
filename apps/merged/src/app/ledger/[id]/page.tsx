"use client";
import { useParams } from "next/navigation";
import LedgerView from "@/components/views/LedgerView";

export default function Page() {
  const params = useParams<{ id: string }>();
  return <LedgerView initialLedgerId={decodeURIComponent(params.id)} />;
}
