"use client";
import { useParams } from "next/navigation";
import CarpenterDetail from "@/components/views/CarpenterDetail";

export default function Page() {
  const params = useParams<{ id: string }>();
  return <CarpenterDetail id={decodeURIComponent(params.id)} />;
}
