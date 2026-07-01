"use client";
import { useParams } from "next/navigation";
import CustomerDetail from "@/components/views/CustomerDetail";

export default function Page() {
  const params = useParams<{ id: string }>();
  return <CustomerDetail id={decodeURIComponent(params.id)} />;
}
