"use client";
import { useParams } from "next/navigation";
import RentDetail from "@/components/views/RentDetail";

export default function Page() {
  const params = useParams<{ id: string }>();
  return <RentDetail id={decodeURIComponent(params.id)} />;
}
